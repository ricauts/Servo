import type { ReactNode } from "react";

export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-4 py-5 md:px-8 md:py-6">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl font-sans text-[13.5px] leading-normal text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
