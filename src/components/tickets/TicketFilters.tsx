"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, TICKET_STATUSES } from "@/lib/types";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/lib/labels";

// Radix Select items cannot carry an empty-string value, so "all" (cleared
// filter) is a sentinel that maps back to "" in the URL params.
const ALL = "ALL";

export default function TicketFilters({
  status,
  category,
  q,
}: {
  status: string;
  category: string;
  q: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);

  function apply(next: { status?: string; category?: string; q?: string }) {
    const merged = { status, category, q, ...next };
    const params = new URLSearchParams();
    if (merged.status) params.set("status", merged.status);
    if (merged.category) params.set("category", merged.category);
    if (merged.q) params.set("q", merged.q);
    const qs = params.toString();
    router.push(qs ? `/tickets?${qs}` : "/tickets");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 font-sans">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search tickets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ q: query.trim() });
          }}
          placeholder="Search tickets…"
          className="w-64 pl-8"
        />
      </div>

      <Select
        value={status || ALL}
        onValueChange={(value) => apply({ status: value === ALL ? "" : value })}
      >
        <SelectTrigger aria-label="Filter by status" className="w-44">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          <SelectItem value="OPEN_ALL">Open (any)</SelectItem>
          <SelectSeparator />
          {TICKET_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={category || ALL}
        onValueChange={(value) =>
          apply({ category: value === ALL ? "" : value })
        }
      >
        <SelectTrigger aria-label="Filter by category" className="w-44">
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          <SelectSeparator />
          {CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
