// Identity & access tools. reset_password stays simulated on purpose — the
// pattern being demonstrated is the MEDIUM-risk policy around it; a real
// deployment would swap in its IdP's admin API here.

import { str, type ToolDef } from "./types";

export const identityTools: Record<string, ToolDef> = {
  reset_password: {
    name: "reset_password",
    description:
      "Reset a user's password in the identity provider and send them a recovery link (simulated).",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The account email to reset." },
      },
      required: ["email"],
    },
    async execute(input) {
      const email = str(input.email).trim();
      if (!email) return "Error: email is required.";
      return `Password reset for ${email}. Recovery link sent to the recovery address on file (expires in 60 minutes).`;
    },
  },
};
