// GitHub integration: real REST calls when a token is configured, otherwise
// the tools fall back to their simulated responses so the offline demo keeps
// working. Config follows the BYOK pattern — GITHUB_TOKEN env wins over the
// token stored in Settings, and the token is never returned by any API.

import { db } from "@/lib/db";

export const GITHUB_SETTING_KEYS = {
  token: "integration.github.token", // never returned by the API
  owner: "integration.github.owner", // default owner (user/org) for new repos
  apiUrl: "integration.github.apiUrl", // override for GH Enterprise / testing
} as const;

export interface GithubConfig {
  token: string;
  owner: string;
  apiUrl: string;
  tokenSource: "env" | "db" | "none";
}

export async function getGithubConfig(): Promise<GithubConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(GITHUB_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const envToken = process.env.GITHUB_TOKEN ?? "";
  const dbToken = map.get(GITHUB_SETTING_KEYS.token) ?? "";
  const token = envToken || dbToken;
  return {
    token,
    owner: map.get(GITHUB_SETTING_KEYS.owner) ?? "",
    apiUrl: (map.get(GITHUB_SETTING_KEYS.apiUrl) || "https://api.github.com").replace(/\/+$/, ""),
    tokenSource: envToken ? "env" : dbToken ? "db" : "none",
  };
}

interface GithubResult {
  status: number;
  body: Record<string, unknown>;
}

export async function githubRequest(
  config: GithubConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<GithubResult> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: parsed };
}

/** Create a repository for the configured owner (or the token's user). */
export async function createRepo(
  config: GithubConfig,
  input: { name: string; description?: string; private?: boolean },
): Promise<string> {
  const payload = {
    name: input.name,
    description: input.description ?? "",
    private: input.private ?? true,
    auto_init: true,
  };
  // If an owner is configured, target the org endpoint; otherwise the
  // token's own user namespace.
  const path = config.owner ? `/orgs/${config.owner}/repos` : "/user/repos";
  let result = await githubRequest(config, "POST", path, payload);
  if (result.status === 404 && config.owner) {
    // Owner is a user (not an org) — fall back to the user endpoint.
    result = await githubRequest(config, "POST", "/user/repos", payload);
  }
  if (result.status === 201) {
    return `Repository created: ${String(result.body.html_url ?? input.name)} (private: ${payload.private}).`;
  }
  return `GitHub error ${result.status}: ${String(result.body.message ?? "request failed")}`;
}

/** Open a pull request on owner/repo. */
export async function openPr(
  config: GithubConfig,
  input: { repo: string; title: string; description?: string; head?: string; base?: string },
): Promise<string> {
  const owner = config.owner;
  if (!owner) {
    return "GitHub error: set the default owner in Settings before opening pull requests.";
  }
  const result = await githubRequest(config, "POST", `/repos/${owner}/${input.repo}/pulls`, {
    title: input.title,
    body: input.description ?? "",
    head: input.head ?? "servo/proposed-changes",
    base: input.base ?? "main",
  });
  if (result.status === 201) {
    return `Pull request opened: ${String(result.body.html_url ?? "")} — "${input.title}".`;
  }
  return `GitHub error ${result.status}: ${String(result.body.message ?? "request failed")}`;
}
