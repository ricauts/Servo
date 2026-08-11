// Agents write markdown — bold, inline code, lists, links — so ticket
// comments, run summaries and QA notes render it instead of showing the
// syntax raw. react-markdown never emits raw HTML, so agent-authored text
// cannot inject markup.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown stripped to readable text — for clamped previews. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Markdown({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`space-y-2 text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary-strong underline underline-offset-2 hover:no-underline"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          h1: ({ children }) => (
            <h4 className="font-heading text-sm font-semibold text-foreground">{children}</h4>
          ),
          h2: ({ children }) => (
            <h4 className="font-heading text-sm font-semibold text-foreground">{children}</h4>
          ),
          h3: ({ children }) => (
            <h4 className="font-heading text-sm font-semibold text-foreground">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border pb-1 pr-4 font-heading font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 py-1 pr-4">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
