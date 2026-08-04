// Mono <pre> block for tool payloads: pretty-printed JSON on a muted
// surface with a bounded height. Shared by the timeline and approval card.

import { cn } from "@/lib/utils";
import { prettyJson } from "@/components/tickets/format";

export default function JsonBlock({
  raw,
  className,
}: {
  raw: string;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground",
        className,
      )}
    >
      {prettyJson(raw)}
    </pre>
  );
}
