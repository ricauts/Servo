"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function CommentComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!body.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Comment failed (${res.status}).`);
      } else {
        setBody("");
        router.refresh();
      }
    } catch {
      setError("Network error — the comment was not posted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2 font-sans">
        <Textarea
          aria-label="Add a comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p className="text-[13px] text-critical">{error}</p>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="font-heading"
          >
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "Posting…" : "Comment"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
