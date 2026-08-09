// GitHub tools: real API when a token is configured (env or Settings),
// simulated otherwise so the offline demo keeps working.

import { createBranch, createRepo, getGithubConfig, openPr } from "@/lib/integrations/github";
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
