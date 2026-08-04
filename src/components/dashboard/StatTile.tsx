import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI stat tile: mono uppercase label + large heading-face hero number.
 * `highlight` draws attention (used for pending approvals > 0).
 */
export default function StatTile({
  label,
  value,
  unit,
  highlight = false,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-2 px-5 py-4",
        highlight && "bg-warn-soft/50 ring-warn/50 dark:bg-warn/10",
      )}
    >
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-heading text-[32px] font-semibold leading-none tracking-tight text-foreground",
            highlight && "text-warn",
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
