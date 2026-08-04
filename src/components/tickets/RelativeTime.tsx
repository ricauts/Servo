// Renders an ISO timestamp as a compact relative time inside a <time>
// element. Works in server and client components; suppressHydrationWarning
// covers the (rare) case where the boundary shifts between SSR and hydration.

import { formatRelative } from "@/components/tickets/format";

export default function RelativeTime({
  value,
  className,
}: {
  value: Date | string;
  className?: string;
}) {
  const date = typeof value === "string" ? new Date(value) : value;
  const iso = date.toISOString();
  return (
    <time
      dateTime={iso}
      title={iso}
      className={className}
      suppressHydrationWarning
    >
      {formatRelative(date)}
    </time>
  );
}
