import { cn } from "@/lib/utils";

const ROWS = [
  { key: "pending", label: "Pending", dot: "bg-warn" },
  { key: "approved", label: "Approved", dot: "bg-good" },
  { key: "rejected", label: "Rejected", dot: "bg-critical" },
] as const;

/** Approvals mini-tile: pending / approved / rejected counts. */
export default function ApprovalsTile({
  approved,
  rejected,
  pending,
}: {
  approved: number;
  rejected: number;
  pending: number;
}) {
  const values = { approved, rejected, pending };
  return (
    <div className="divide-y divide-border font-sans">
      {ROWS.map((r) => (
        <div key={r.key} className="flex items-center justify-between py-2">
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", r.dot)}
              aria-hidden="true"
            />
            {r.label}
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
            {values[r.key]}
          </span>
        </div>
      ))}
    </div>
  );
}
