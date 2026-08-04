"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shell/PageHeader";

export default function NewTicketPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Title and description are both required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ticket?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.ticket) {
        setError(data.error ?? `Could not create the ticket (${res.status}).`);
        setPending(false);
        return;
      }
      router.push(`/tickets/${data.ticket.id}`);
    } catch {
      setError("Network error — the ticket was not created.");
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New ticket"
        description="Describe the problem; Servo can triage and route it automatically."
      />

      <div className="p-4 md:p-8">
        <Card className="max-w-2xl">
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5 font-sans">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ticket-title" className="font-heading">
                  Title
                </Label>
                <Input
                  id="ticket-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                  placeholder="e.g. Locked out after MFA reset"
                  disabled={pending}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="ticket-description" className="font-heading">
                  Description
                </Label>
                <p className="text-xs text-muted-foreground">
                  If auto-triage is enabled, an AI agent will categorize and
                  prioritize this ticket right after it is created.
                </p>
                <Textarea
                  id="ticket-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? Include asset tags, error messages, repo names — anything the agent can act on."
                  rows={7}
                  disabled={pending}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTitle>The ticket was not created</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={pending}
                  className="font-heading"
                >
                  {pending && <Loader2 className="animate-spin" />}
                  {pending ? "Creating…" : "Create ticket"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  asChild
                  className="font-heading"
                >
                  <Link href="/tickets">Cancel</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
