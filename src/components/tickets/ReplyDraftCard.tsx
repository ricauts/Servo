"use client";

// The human-in-the-loop reply box: the AI drafted an answer for the
// requester; the agent reviews it (editing in place if needed) and either
// approves — Servo posts it as a comment and emails the requester — or
// rejects it. With no pending draft the card collapses to a single
// "Draft reply with AI" action.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import RelativeTime from "@/components/tickets/RelativeTime";

export default function ReplyDraftCard({
  ticketId,
  draft,
  requesterName,
  emailConfigured,
}: {
  ticketId: string;
  draft: { id: string; body: string; agentName: string; createdAt: Date } | null;
  requesterName: string;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState(draft?.body ?? "");
  const [busy, setBusy] = useState<"generate" | "approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/draft`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: { body: string };
      };
      if (!res.ok) {
        setError(data.error ?? `Draft generation failed (${res.status}).`);
      } else {
        if (data.draft) setBody(data.draft.body);
        router.refresh();
      }
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!draft) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, body: body.trim() } : { action },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: { emailed: boolean };
      };
      if (!res.ok) {
        setError(data.error ?? `Decision failed (${res.status}).`);
      } else {
        if (action === "approve") {
          toast(
            data.draft?.emailed
              ? `Reply sent to ${requesterName} by email`
              : "Reply posted (email notifications are off)",
          );
        }
        router.refresh();
      }
    } catch {
      setError("Network error — the decision was not recorded.");
    } finally {
      setBusy(null);
    }
  }

  if (!draft) {
    return (
      <Button
        variant="outline"
        onClick={() => void generate()}
        disabled={busy !== null}
        className="font-heading"
      >
        {busy === "generate" ? <Loader2 className="animate-spin" /> : <Sparkles size={15} />}
        {busy === "generate" ? "Drafting…" : "Draft reply with AI"}
      </Button>
    );
  }

  const edited = body.trim() !== draft.body.trim();

  return (
    <Card className="bg-primary/5 ring-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine size={17} className="text-primary-strong" />
          AI reply draft — review before sending
        </CardTitle>
        <CardDescription>
          Drafted by {draft.agentName} <RelativeTime value={draft.createdAt} />
          {edited && " · edited by you"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy !== null}
          rows={Math.min(14, Math.max(6, body.split("\n").length + 1))}
          className="bg-background/70 font-sans text-sm leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">
          Approving posts this as a public comment
          {emailConfigured
            ? ` and emails it to ${requesterName}. Their reply threads back onto this ticket.`
            : `. Email notifications are off, so ${requesterName} will only see it here.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void decide("approve")}
            disabled={busy !== null || body.trim() === ""}
            className="font-heading"
          >
            {busy === "approve" ? <Loader2 className="animate-spin" /> : <MailCheck size={15} />}
            {busy === "approve" ? "Sending…" : "Approve & send"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void generate()}
            disabled={busy !== null}
            className="font-heading"
          >
            {busy === "generate" ? <Loader2 className="animate-spin" /> : <RefreshCw size={15} />}
            Regenerate
          </Button>
          <Button
            variant="ghost"
            onClick={() => void decide("reject")}
            disabled={busy !== null}
            className="font-heading text-muted-foreground"
          >
            {busy === "reject" && <Loader2 className="animate-spin" />}
            Discard
          </Button>
        </div>
        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>
    </Card>
  );
}
