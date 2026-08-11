// GitHub tools: real API when a token is configured (env or Settings),
// simulated otherwise so the offline demo keeps working.

import {
  createBranch,
  createRepo,
  editFile,
  getGithubConfig,
  listRepos,
  mergePr,
  openPr,
  readFile,
} from "@/lib/integrations/github";
import { errorMessage, str, type ToolDef } from "./types";

export const githubTools: Record<string, ToolDef> = {
  github_create_repo: {
    name: "github_create_repo",
    description:
      "Create a new GitHub repository (real API when a token is configured in Settings; simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name (kebab-case)." },
        description: { type: "string", description: "Optional repository description." },
        private: { type: "boolean", description: "Whether the repository is private." },
      },
      required: ["name"],
    },
    async execute(input) {
      const name = str(input.name).trim();
      if (!name) return "Error: name is required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Repository acme/${name} created with default branch protection and CI template.`;
      }
      try {
        return await createRepo(config, {
          name,
          description: str(input.description),
          private: input.private !== false,
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_create_branch: {
    name: "github_create_branch",
    description:
      "Create a feature branch on an existing repository — the first step when a ticket asks for a code change or a new feature to try (real API when a token is configured in Settings; simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        branch: {
          type: "string",
          description: "New branch name, e.g. feature/dark-mode (kebab-case, no spaces).",
        },
        from: { type: "string", description: "Base branch to fork from (default main)." },
      },
      required: ["repo", "branch"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const branch = str(input.branch).trim();
      if (!repo || !branch) return "Error: repo and branch are required.";
      if (/[\s~^:?*[\\\]]/.test(branch)) {
        return "Error: branch contains characters git refs do not allow.";
      }
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Branch created: acme/${repo}@${branch} (from ${str(input.from) || "main"}).`;
      }
      try {
        return await createBranch(config, {
          repo,
          branch,
          from: str(input.from) || undefined,
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_list_repos: {
    name: "github_list_repos",
    description:
      "List the GitHub repositories this install can reach, with their default branch. Use it when a ticket names a project but not the exact repository. Results are cached for a few minutes.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: { type: "boolean", description: "Bypass the cache and re-query GitHub." },
      },
    },
    async execute(input) {
      const config = await getGithubConfig();
      if (!config.token) {
        return "[simulated — no GitHub token configured] acme/website (public, default main)";
      }
      try {
        return await listRepos(config, { refresh: input.refresh === true });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_read_file: {
    name: "github_read_file",
    description:
      "Read a file from a GitHub repository so you can inspect the code before proposing a change. Use this before github_edit_file to copy the exact snippet you intend to replace.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        path: { type: "string", description: "File path in the repository, e.g. index.html." },
        ref: { type: "string", description: "Branch or commit to read from (default the default branch)." },
      },
      required: ["repo", "path"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const path = str(input.path).trim();
      if (!repo || !path) return "Error: repo and path are required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Contents of ${repo}/${path}.`;
      }
      try {
        const file = await readFile(config, { repo, path, ref: str(input.ref) || undefined });
        if (!file.ok) return file.error;
        return `${path}${file.truncated ? " (truncated)" : ""}:\n\n${file.content}`;
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_edit_file: {
    name: "github_edit_file",
    description:
      "Commit a precise change to a file on a branch: give the exact snippet to find and what to replace it with. The snippet must appear exactly once — include surrounding context if needed. Never use this on the default branch; create a feature branch first and open a pull request afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        branch: { type: "string", description: "Feature branch to commit to (never the default branch)." },
        path: { type: "string", description: "File path in the repository." },
        find: {
          type: "string",
          description: "Exact snippet to replace, copied verbatim from the file (whitespace included).",
        },
        replace: { type: "string", description: "Replacement snippet." },
        message: { type: "string", description: "Commit message." },
      },
      required: ["repo", "branch", "path", "find", "replace", "message"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const branch = str(input.branch).trim();
      const path = str(input.path).trim();
      const find = str(input.find);
      if (!repo || !branch || !path || !find) {
        return "Error: repo, branch, path and find are required.";
      }
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Committed a change to ${repo}@${branch}:${path}.`;
      }
      try {
        return await editFile(config, {
          repo,
          branch,
          path,
          find,
          replace: str(input.replace),
          message: str(input.message) || "Update via Servo",
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_merge_pr: {
    name: "github_merge_pr",
    description:
      "Merge an open pull request into its base branch — the step that ships the change and triggers any deployment workflow. Only after a human has reviewed it.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        number: { type: "number", description: "Pull request number." },
        method: {
          type: "string",
          description: "merge | squash | rebase (default squash).",
        },
      },
      required: ["repo", "number"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const number = Number(input.number);
      if (!repo || !Number.isFinite(number)) return "Error: repo and a numeric number are required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Pull request #${number} merged into ${repo}.`;
      }
      try {
        return await mergePr(config, { repo, number, method: str(input.method) || undefined });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_open_pr: {
    name: "github_open_pr",
    description:
      "Open a pull request with proposed changes (real API when a token is configured in Settings; simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        title: { type: "string", description: "Pull request title." },
        description: { type: "string", description: "Optional pull request body." },
        head: { type: "string", description: "Source branch (default servo/proposed-changes)." },
        base: { type: "string", description: "Target branch (default main)." },
      },
      required: ["repo", "title"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const title = str(input.title).trim();
      if (!repo || !title) return "Error: repo and title are required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Pull request opened: https://github.com/acme/${repo}/pull/42 — "${title}".`;
      }
      try {
        return await openPr(config, {
          repo,
          title,
          description: str(input.description),
          head: str(input.head) || undefined,
          base: str(input.base) || undefined,
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },
};
