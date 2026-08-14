// Web tools — what an agent needs to *read* and to *see* a page, not just
// reason about it. A screenshot is attached to the ticket so a human reviews
// the visual result of a proposed change before approving it.
//
// Both tools open a URL the model chose, and on this desk that URL usually
// came out of an email a stranger sent. Every request therefore goes through
// the egress guard in src/lib/egress.ts, which refuses internal addresses and
// re-checks each redirect. They read and never write, so they are LOW risk
// and need no approval — the gate they must not slip is the network one.

import { db } from "@/lib/db";
import {
  EGRESS_TIMEOUT_MS,
  EgressBlockedError,
  checkEgress,
  getEgressConfig,
  safeFetch,
} from "@/lib/egress";
import { htmlTitle, htmlToText } from "@/lib/html-text";
import { capture } from "@/lib/screenshot";
import { RESULT_LIMIT, errorMessage, str, type ToolDef } from "./types";

/** Bodies larger than this are refused before they are read into memory. */
const MAX_BODY_BYTES = 5_000_000;

/** Content types worth flattening to text; anything else is described, not dumped. */
function textualKind(contentType: string): "html" | "text" | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type.startsWith("text/")) return "text";
  if (/^application\/(json|.*\+json|xml|.*\+xml|yaml|x-yaml|javascript)$/.test(type)) return "text";
  if (!type) return "text"; // no header: assume text and let the cap protect us
  return null;
}

export const webTools: Record<string, ToolDef> = {
  fetch_url: {
    name: "fetch_url",
    description:
      "Open an http(s) URL and read it back as text (HTML is flattened to readable text with its headings, list items and links). Use it for the page a requester linked to, a vendor status page, release notes or public API documentation — anything where the answer is on a page rather than in your own knowledge. Read-only: it never signs in, submits a form or sends data. Internal and private addresses are refused unless an administrator has allowlisted them.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) URL to read." },
      },
      required: ["url"],
    },
    async execute(input) {
      const url = str(input.url).trim();
      if (!url) return "Error: url is required.";
      const config = await getEgressConfig();
      try {
        const res = await safeFetch(
          url,
          {
            headers: {
              accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
              "user-agent": "Servo-Agent/1.0 (+https://github.com/ricauts/Servo)",
            },
            signal: AbortSignal.timeout(EGRESS_TIMEOUT_MS),
          },
          config,
        );

        const contentType = res.headers.get("content-type") ?? "";
        const header = `GET ${url} — HTTP ${res.status} ${res.statusText}${contentType ? ` (${contentType})` : ""}`;
        const declaredLength = Number(res.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_BODY_BYTES) {
          return `${header}\nBody not read: ${declaredLength} bytes exceeds the ${MAX_BODY_BYTES}-byte limit.`;
        }
        const kind = textualKind(contentType);
        if (!kind) {
          return `${header}\nNot a text document, so there is nothing to read. Use take_screenshot if you need to see it.`;
        }

        const body = (await res.text()).slice(0, MAX_BODY_BYTES);
        const title = kind === "html" ? htmlTitle(body) : "";
        const content = kind === "html" ? htmlToText(body) : body.trim();
        const shown = content.slice(0, RESULT_LIMIT);
        const truncated =
          content.length > shown.length
            ? `\n\n[Truncated: showing the first ${shown.length} of ${content.length} characters.]`
            : "";
        const parts = [header];
        if (title) parts.push(`Title: ${title}`);
        parts.push("", shown || "(the page has no readable text)");
        return `${parts.join("\n")}${truncated}`;
      } catch (err) {
        if (err instanceof EgressBlockedError) return err.message;
        return `Could not read ${url}: ${errorMessage(err)}`;
      }
    },
  },
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
      // The browser does its own navigating, so this covers the URL the agent
      // chose, not any redirect Chromium then follows on its own.
      const decision = await checkEgress(url, await getEgressConfig());
      if (!decision.ok) return decision.reason;
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
