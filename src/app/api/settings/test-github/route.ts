import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { getGithubConfig, githubRequest } from "@/lib/integrations/github";

export const dynamic = "force-dynamic";

const testSchema = z.object({
  // Optional overrides so the form can test unsaved values.
  token: z.string().optional(),
  apiUrl: z.string().optional(),
});

/** POST /api/settings/test-github — verify the token with GET /user. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = testSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid test payload." }, { status: 400 });
  }

  const stored = await getGithubConfig();
  const config = {
    ...stored,
    token: parsed.data.token || stored.token,
    apiUrl: (parsed.data.apiUrl || stored.apiUrl).replace(/\/+$/, ""),
  };
  if (!config.token) {
    return Response.json(
      { error: "No GitHub token configured. Set GITHUB_TOKEN or save one in Settings." },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const result = await githubRequest(config, "GET", "/user");
    if (result.status !== 200) {
      return Response.json(
        {
          error: `GitHub returned ${result.status}: ${String(result.body.message ?? "request failed")}`,
          latencyMs: Date.now() - started,
        },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      login: String(result.body.login ?? "unknown"),
    });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message.slice(0, 400) : "Connection failed.",
        latencyMs: Date.now() - started,
      },
      { status: 502 },
    );
  }
}
