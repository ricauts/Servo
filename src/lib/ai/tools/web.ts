// Web tools — what an agent needs to *see* a page, not just reason about it.
// A screenshot is attached to the ticket so a human reviews the visual result
// of a proposed change before approving it.

import { db } from "@/lib/db";
import { capture } from "@/lib/screenshot";
import { errorMessage, str, type ToolDef } from "./types";

export const webTools: Record<string, ToolDef> = {
  take_screenshot: {
    name: "take_screenshot",
    description:
      "Render a web page in a real browser and attach the screenshot to this ticket, so a human can see it. Use it to show the current state of a UI problem and, after committing a change to a branch, to show the result — the raw file of a branch works as a URL (https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) URL to render." },
        caption: {
          type: "string",
          description: "Short label shown next to the image, e.g. 'Before — nav button'.",
        },
        width: { type: "number", description: "Viewport width in px (default 1280)." },
        height: { type: "number", description: "Viewport height in px (default 800)." },
        fullPage: { type: "boolean", description: "Capture the whole page instead of the viewport." },
      },
      required: ["url"],
    },
    async execute(input, ctx) {
      const url = str(input.url).trim();
      if (!url) return "Error: url is required.";
      try {
        const png = await capture({
          url,
          width: Number(input.width) || undefined,
          height: Number(input.height) || undefined,
          fullPage: input.fullPage === true,
        });
        const caption = str(input.caption).trim();
        const attachment = await db.attachment.create({
          data: {
            ticketId: ctx.ticketId,
            name: `screenshot-${Date.now()}.png`,
            contentType: "image/png",
            // Prisma's Bytes maps to Uint8Array; Buffer's ArrayBufferLike is
            // not assignable to it under strict TS.
            data: new Uint8Array(png),
            caption: caption || url,
          },
        });
        return `Screenshot captured and attached to the ticket (${Math.round(png.length / 1024)} KB): /api/attachments/${attachment.id}${caption ? ` — ${caption}` : ""}. The reviewer can see it on the ticket.`;
      } catch (err) {
        return `Screenshot failed: ${errorMessage(err)}`;
      }
    },
  },
};
