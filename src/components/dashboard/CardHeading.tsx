import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mono uppercase card header for the dashboard chart cards (h2 semantics kept).
 */
export default function CardHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}
