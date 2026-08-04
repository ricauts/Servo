"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function RunResolverCard({
  ticketId,
  hasActiveRun,
}: {
  ticketId: string;
  hasActiveRun: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Run failed (${res.status}).`);
      }
      router.refresh();
    } catch {
      setError("Network error — could not start the run.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>AI resolver</CardTitle>
        <CardDescription className="font-sans text-xs">
          Hand this ticket to the Servo resolver agent. It works the ticket
          with tools and pauses for human approval on risky actions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <Button
          onClick={run}
          disabled={pending}
          className="w-full font-heading"
        >
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {pending ? "Running agent…" : "Run AI resolver"}
        </Button>
        {hasActiveRun && !pending && !error && (
          <p className="text-xs text-muted-foreground/80">
            A run is already in flight for this ticket.
          </p>
        )}
        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>
    </Card>
  );
}
