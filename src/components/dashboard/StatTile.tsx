import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI stat tile: mono uppercase label + large heading-face hero number.
 * `highlight` draws attention; `tone` picks how urgent that attention is
 * (amber for something waiting, red for something already missed).
 */
export default function StatTile({
  label,
  value,
  unit,
  highlight = false,
  tone = "warn",
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
  tone?: "warn" | "critical";
}) {
  const critical = tone === "critical";
  return (
    <Card
      className={cn(
        "gap-1.5 px-5 py-3",
        highlight &&
          (critical
            ? "bg-critical-soft/50 ring-critical/50 dark:bg-critical/10"
            : "bg-warn-soft/50 ring-warn/50 dark:bg-warn/10"),
      )}
    >
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-heading text-[28px] font-semibold leading-none tracking-tight text-foreground",
            highlight && (critical ? "text-critical" : "text-warn"),
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="font-sans text-sm font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </Card>
  );
}
