// Visual evidence for frontend pull requests.
//
// A reviewer approving a UI change should not have to read a CSS diff and
// imagine the result. When a branch changes a page that a browser can render
// on its own, Servo captures it before/after and attaches both to the ticket —
// structurally, on every pull request, rather than hoping the model remembers
// to ask for a screenshot.
//
// Scope is deliberate: raw files render without a build step, so static pages
// are covered automatically. Framework apps need a deploy preview — pass its
// URL as `previewUrl` and it is captured the same way.

import { db } from "@/lib/db";
import { capture } from "@/lib/screenshot";
import {
  changedFiles,
  rawFileUrl,
  type GithubConfig,
} from "@/lib/integrations/github";

/** Extensions a browser renders directly from a raw file URL. */
const RENDERABLE = /\.html?$/i;

export interface PreviewResult {
  /** Markdown appended to the pull request body. */
  note: string;
  captured: number;
}

async function attach(
  ticketId: string,
  url: string,
  caption: string,
): Promise<boolean> {
  try {
    // Full page, not just the viewport: a CSS diff can land anywhere on the
    // page (a footer, a section far below the fold), and a preview that
    // crops out the change is worse than no preview.
    const png = await capture({ url, width: 1280, height: 900, fullPage: true });
    await db.attachment.create({
      data: {
        ticketId,
        name: `pr-preview-${Date.now()}.png`,
        contentType: "image/png",
        data: new Uint8Array(png),
        caption,
      },
    });
    return true;
  } catch {
    return false; // best effort: a missing preview never blocks the PR
  }
}

/**
 * Capture before/after images for a branch and attach them to the ticket.
 * Never throws — returns a note for the pull request body describing what
 * was (or could not be) captured.
 */
export async function capturePrPreview(
  config: GithubConfig,
  input: {
    ticketId: string;
    repo: string;
    base: string;
    head: string;
    /** Deploy-preview URL for apps that need a build to render. */
    previewUrl?: string;
  },
): Promise<PreviewResult> {
  if (input.previewUrl) {
    const ok = await attach(input.ticketId, input.previewUrl, `Preview — ${input.previewUrl}`);
    return {
      captured: ok ? 1 : 0,
      note: ok
        ? `\n\n---\n**Visual check:** a screenshot of ${input.previewUrl} is attached to the Servo ticket for the approver.`
        : "",
    };
  }

  let files: string[] = [];
  try {
    files = await changedFiles(config, { repo: input.repo, base: input.base, head: input.head });
  } catch {
    return { captured: 0, note: "" };
  }
  const page = files.find((f) => RENDERABLE.test(f));
  if (!page) {
    return {
      captured: 0,
      note: files.length
        ? "\n\n---\n**Visual check:** no directly renderable page in this diff — attach a deploy preview if the change is visual."
        : "",
    };
  }

  const [before, after] = await Promise.all([
    attach(
      input.ticketId,
      rawFileUrl(config, { repo: input.repo, ref: input.base, path: page }),
      `Before — ${page} on ${input.base}`,
    ),
    attach(
      input.ticketId,
      rawFileUrl(config, { repo: input.repo, ref: input.head, path: page }),
      `After — ${page} on ${input.head}`,
    ),
  ]);

  const captured = (before ? 1 : 0) + (after ? 1 : 0);
  if (captured === 0) {
    return {
      captured,
      note: "\n\n---\n**Visual check:** could not render this branch (no browser available on the Servo host).",
    };
  }
  return {
    captured,
    note: `\n\n---\n**Visual check:** ${before && after ? "before/after screenshots" : "a screenshot"} of \`${page}\` rendered from this branch ${before && after ? "are" : "is"} attached to the Servo ticket, so the approver sees the change without reading the diff.`,
  };
}
