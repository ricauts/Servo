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

/** Create a branch on owner/repo from the tip of a base branch. */
export async function createBranch(
  config: GithubConfig,
  input: { repo: string; branch: string; from?: string },
): Promise<string> {
  const owner = config.owner;
  if (!owner) {
    return "GitHub error: set the default owner in Settings before creating branches.";
  }
  const base = input.from ?? "main";
  const ref = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${input.repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  if (ref.status !== 200) {
    return `GitHub error ${ref.status}: base branch "${base}" not found on ${owner}/${input.repo}.`;
  }
  const sha = String((ref.body.object as Record<string, unknown> | undefined)?.sha ?? "");
  if (!sha) return "GitHub error: could not resolve the base branch commit.";
  const result = await githubRequest(config, "POST", `/repos/${owner}/${input.repo}/git/refs`, {
    ref: `refs/heads/${input.branch}`,
    sha,
  });
  if (result.status === 201) {
    return `Branch created: ${owner}/${input.repo}@${input.branch} (from ${base} @ ${sha.slice(0, 7)}) — https://github.com/${owner}/${input.repo}/tree/${input.branch}`;
  }
  if (result.status === 422) {
    return `GitHub error: branch "${input.branch}" already exists on ${owner}/${input.repo}.`;
  }
  return `GitHub error ${result.status}: ${String(result.body.message ?? "request failed")}`;
}

const FILE_READ_LIMIT = 60_000; // characters returned to the model
const REPO_CACHE_KEY = "integration.github.repoCache";
const REPO_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Repositories the token can reach, cached in Settings so repeated agent runs
 * do not re-list them (and stay inside GitHub's rate limits).
 */
export async function listRepos(
  config: GithubConfig,
  opts: { refresh?: boolean } = {},
): Promise<string> {
  if (!opts.refresh) {
    const cached = await db.setting.findUnique({ where: { key: REPO_CACHE_KEY } });
    if (cached?.value) {
      try {
        const parsed = JSON.parse(cached.value) as { at: number; repos: string[] };
        if (Date.now() - parsed.at < REPO_CACHE_TTL_MS) {
          return `${parsed.repos.length} repositories (cached):\n${parsed.repos.join("\n")}`;
        }
      } catch {
        /* fall through and refetch */
      }
    }
  }
  const result = await githubRequest(config, "GET", "/user/repos?per_page=100&sort=updated");
  if (result.status !== 200 || !Array.isArray(result.body)) {
    return `GitHub error ${result.status}: ${String((result.body as Record<string, unknown>).message ?? "could not list repositories")}`;
  }
  const repos = (result.body as unknown as Record<string, unknown>[]).map((r) => {
    const name = String(r.full_name ?? r.name ?? "");
    const description = String(r.description ?? "").slice(0, 90);
    const visibility = r.private ? "private" : "public";
    return `- ${name} (${visibility}, default ${String(r.default_branch ?? "main")})${description ? ` — ${description}` : ""}`;
  });
  await db.setting.upsert({
    where: { key: REPO_CACHE_KEY },
    create: { key: REPO_CACHE_KEY, value: JSON.stringify({ at: Date.now(), repos }) },
    update: { value: JSON.stringify({ at: Date.now(), repos }) },
  });
  return `${repos.length} repositories:\n${repos.join("\n")}`;
}

/** Read a file from owner/repo at a ref. Returns content plus its blob sha. */
export async function readFile(
  config: GithubConfig,
  input: { repo: string; path: string; ref?: string },
): Promise<{ ok: true; content: string; sha: string; truncated: boolean } | { ok: false; error: string }> {
  const owner = config.owner;
  if (!owner) return { ok: false, error: "GitHub error: set the default owner in Settings first." };
  const query = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const result = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${input.repo}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}${query}`,
  );
  if (result.status !== 200) {
    return {
      ok: false,
      error: `GitHub error ${result.status}: ${String(result.body.message ?? "file not found")}`,
    };
  }
  if (result.body.type !== "file" || typeof result.body.content !== "string") {
    return { ok: false, error: "GitHub error: that path is not a file." };
  }
  const decoded = Buffer.from(result.body.content, "base64").toString("utf8");
  return {
    ok: true,
    content: decoded.slice(0, FILE_READ_LIMIT),
    sha: String(result.body.sha ?? ""),
    truncated: decoded.length > FILE_READ_LIMIT,
  };
}

/**
 * Apply a surgical find/replace to a file on a branch and commit it.
 *
 * Deliberately not a "write the whole file" API: the model supplies only the
 * snippet to change, the server verifies it appears exactly once, and commits
 * the result. That keeps the approval card readable (a human sees the precise
 * before/after), makes ambiguous edits fail loudly instead of silently
 * rewriting a file, and costs a fraction of the tokens.
 */
export async function editFile(
  config: GithubConfig,
  input: {
    repo: string;
    branch: string;
    path: string;
    find: string;
    replace: string;
    message: string;
  },
): Promise<string> {
  const owner = config.owner;
  if (!owner) return "GitHub error: set the default owner in Settings before committing.";

  const file = await readFile(config, { repo: input.repo, path: input.path, ref: input.branch });
  if (!file.ok) return file.error;
  if (file.truncated) {
    return "GitHub error: the file is too large for a safe edit through this tool.";
  }

  const occurrences = file.content.split(input.find).length - 1;
  if (occurrences === 0) {
    return `Error: the snippet to replace was not found in ${input.path}. Read the file again and match it exactly, including whitespace.`;
  }
  if (occurrences > 1) {
    return `Error: the snippet appears ${occurrences} times in ${input.path} — include more surrounding context so the edit is unambiguous.`;
  }

  const updated = file.content.replace(input.find, input.replace);
  const result = await githubRequest(
    config,
    "PUT",
    `/repos/${owner}/${input.repo}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}`,
    {
      message: input.message,
      content: Buffer.from(updated, "utf8").toString("base64"),
      sha: file.sha,
      branch: input.branch,
    },
  );
  if (result.status === 200 || result.status === 201) {
    const commit = result.body.commit as Record<string, unknown> | undefined;
    const sha = String(commit?.sha ?? "").slice(0, 7);
    return `Committed to ${owner}/${input.repo}@${input.branch} (${sha}): ${input.message} — ${input.path} updated.`;
  }
  return `GitHub error ${result.status}: ${String(result.body.message ?? "commit failed")}`;
}

/** Merge an open pull request (squash by default). */
export async function mergePr(
  config: GithubConfig,
  input: { repo: string; number: number; method?: string },
): Promise<string> {
  const owner = config.owner;
  if (!owner) return "GitHub error: set the default owner in Settings before merging.";
  const result = await githubRequest(
    config,
    "PUT",
    `/repos/${owner}/${input.repo}/pulls/${input.number}/merge`,
    { merge_method: input.method ?? "squash" },
  );
  if (result.status === 200) {
    return `Pull request #${input.number} merged into ${owner}/${input.repo} (${String(result.body.sha ?? "").slice(0, 7)}). Deployment workflows on the base branch will pick it up.`;
  }
  if (result.status === 405) {
    return `GitHub error: pull request #${input.number} is not mergeable (${String(result.body.message ?? "")}).`;
  }
  if (result.status === 409) {
    return `GitHub error: merge conflict on pull request #${input.number}.`;
  }
  return `GitHub error ${result.status}: ${String(result.body.message ?? "merge failed")}`;
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
