// HTML → readable text for the fetch_url tool.
//
// An agent reading a status page or a vendor doc needs the prose, not the
// markup: raw HTML wastes the context window on attributes and inline script
// and buries the sentence that answers the ticket. This keeps the structure
// that carries meaning (headings, list items, links, paragraph breaks) and
// drops everything else. Deliberately dependency-free — a full DOM parser is
// a lot of weight for "show me what this page says".

const DROPPED_ELEMENTS = /<(script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** The document title, if the page has one. */
export function htmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Flatten a page to text, keeping headings as `#`, list items as `-` and
 * links as `text (href)` so a relative reference in the answer is still
 * followable.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROPPED_ELEMENTS, " ")
    // Unclosed <script>/<style> at the end of a truncated body.
    .replace(/<(script|style)\b[^>]*>[\s\S]*$/i, " ");

  text = text.replace(
    /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _raw, dq: string, sq: string, bare: string, label: string) => {
      const href = (dq ?? sq ?? bare ?? "").trim();
      const inner = label.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) return inner;
      if (!inner) return href;
      return `${inner} (${href})`;
    },
  );

  text = text
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    // </li> is deliberately absent: the next <li> already opens a line, and
    // closing one too would leave a blank line between every bullet.
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|pre|header|footer|nav)>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
