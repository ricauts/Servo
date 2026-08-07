"use client";

// Global ⌘K / Ctrl+K palette: jump to any page or find a ticket by number,
// title, or text. Ticket search hits /api/tickets?q= (debounced) so results
// stay fresh without shipping the queue to the client.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Inbox,
  LayoutDashboard,
  Plus,
  Settings2,
  ShieldCheck,
  Ticket,
  Users2,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import Badge from "@/components/legacy/Badge";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/labels";
import type { TicketStatus } from "@/lib/types";

interface TicketHit {
  id: string;
  number: number;
  title: string;
  status: string;
}

const PAGES = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tickets", label: "Tickets", icon: Inbox },
  { href: "/tickets/new", label: "New ticket", icon: Plus },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/groups", label: "Groups", icon: Users2 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TicketHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      fetch(`/api/tickets?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((data: { tickets?: TicketHit[] }) => {
          setHits((data.tickets ?? []).slice(0, 8));
        })
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 200);
  }, [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page or search tickets"
    >
      {/* Ticket search is server-side; cmdk must not re-filter those hits away. */}
      <Command shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tickets or jump to a page…"
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching…" : "No results found."}
        </CommandEmpty>

        {hits.length > 0 && (
          <>
            <CommandGroup heading="Tickets">
              {hits.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`ticket-${t.id}`}
                  onSelect={() => go(`/tickets/${t.id}`)}
                >
                  <Ticket size={15} className="text-primary-strong" />
                  <span className="font-mono text-xs text-muted-foreground">
                    #{t.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <Badge tone={STATUS_TONE[t.status as TicketStatus] ?? "neutral"}>
                    {STATUS_LABEL[t.status as TicketStatus] ?? t.status}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Go to">
          {PAGES.filter(
            (page) =>
              query.trim() === "" ||
              page.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((page) => (
            <CommandItem
              key={page.href}
              value={page.href}
              onSelect={() => go(page.href)}
            >
              <page.icon size={15} />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
