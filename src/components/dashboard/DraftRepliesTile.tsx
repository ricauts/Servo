import { cn } from "@/lib/utils";

/**
 * AI reply drafts mini-tile: how often the AI's draft was good enough to send
 * untouched. The acceptance rate counts sent-as-is over all decided drafts —
 * the number that tells you whether drafting is actually saving agent time.
 */
export default function DraftRepliesTile({
  pending,
  sentAsIs,
  edited,
  discarded,
}: {
  pending: number;
  sentAsIs: number;
  edited: number;
  discarded: number;
}) {
  const decided = sentAsIs + edited + discarded;
  const acceptance = decided === 0 ? null : Math.round((sentAsIs / decided) * 100);

  const rows = [
    { label: "Sent as-is", value: sentAsIs, dot: "bg-good" },
    { label: "Edited & sent", value: edited, dot: "bg-warn" },
    { label: "Discarded", value: discarded, dot: "bg-critical" },
    { label: "Awaiting review", value: pending, dot: "bg-muted-foreground/50" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
          {acceptance === null ? "—" : `${acceptance}%`}
        </span>
        <span className="text-xs text-muted-foreground">accepted as-is</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between py-1.5">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", r.dot)} aria-hidden="true" />
              {r.label}
            </span>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
