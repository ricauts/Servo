"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import Badge from "@/components/legacy/Badge";
import EmptyState from "@/components/legacy/EmptyState";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";

export interface AgentProfileView {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: string[];
  tools: string[];
  markdown: string;
  enabled: boolean;
  runCount: number;
}

const NEW_AGENT_TEMPLATE = `---
name: My Specialist Agent
description: One line on what this specialist owns.
categories: [OTHER]
tools: []
---

You are Servo's **specialist** for … Describe how this agent should work:
what to check first, what to be careful with, and when to hand off to a
human instead of acting.
`;

async function api(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
  } catch {
    return { ok: false, error: "Network error — nothing was changed." };
  }
}

function EditorDialog({
  title,
  description,
  initial,
  open,
  onOpenChange,
  onSave,
}: {
  title: string;
  description: string;
  initial: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (markdown: string) => Promise<string | null>;
}) {
  const [markdown, setMarkdown] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the buffer each time the dialog opens with fresh content.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setMarkdown(initial);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const err = await onSave(markdown);
    setBusy(false);
    if (err) setError(err);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={18}
          spellCheck={false}
          className="font-mono text-[12.5px] leading-relaxed"
        />
        {error && <p className="text-[13px] text-critical">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={busy || !markdown.trim()}>
            Save agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentCard({
  profile,
  canManage,
}: {
  profile: AgentProfileView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/agents/${profile.id}`, "PATCH", { enabled });
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/agents/${profile.id}`, "DELETE");
    if (!res.ok) {
      setError(res.error ?? null);
      setBusy(false);
    } else {
      router.refresh();
    }
  }

  return (
    <Card size="sm" className={profile.enabled ? "" : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot size={16} className="text-primary-strong" />
          {profile.name}
        </CardTitle>
        <CardDescription>{profile.description}</CardDescription>
        {canManage && (
          <CardAction>
            <Switch
              checked={profile.enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggleEnabled(v)}
              aria-label={`${profile.name} enabled`}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-sans">
        <div className="flex flex-wrap items-center gap-1.5">
          {profile.categories.map((c) => (
            <Badge key={c} tone="brand">
              {CATEGORY_LABEL[c as Category] ?? c}
            </Badge>
          ))}
          <span className="font-mono text-[11px] text-muted-foreground">
            {profile.runCount} run{profile.runCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(profile.tools.length > 0 ? profile.tools : ["all enabled tools"]).map(
            (t) => (
              <span
                key={t}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
              >
                {t}
              </span>
            ),
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} />
              Edit .md
            </Button>
            {confirmDelete ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} />
                Delete
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-critical">{error}</p>}
      </CardContent>

      <EditorDialog
        title={`Edit ${profile.name}`}
        description="Markdown with YAML frontmatter: name, description, categories, tools. The body is the agent's system prompt."
        initial={profile.markdown}
        open={editing}
        onOpenChange={setEditing}
        onSave={async (markdown) => {
          const res = await api(`/api/agents/${profile.id}`, "PATCH", { markdown });
          if (res.ok) router.refresh();
          return res.ok ? null : (res.error ?? "Save failed.");
        }}
      />
    </Card>
  );
}

export default function AgentsManager({
  profiles,
  canManage,
}: {
  profiles: AgentProfileView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} />
            New agent
          </Button>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No specialized agents yet"
          hint={
            canManage
              ? "Create one from a .md template, or drop files into the repo's agents/ directory and reseed."
              : "An admin can create specialized agents from .md definitions."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((p) => (
            <AgentCard key={p.id} profile={p} canManage={canManage} />
          ))}
        </div>
      )}

      <EditorDialog
        title="New specialized agent"
        description="Markdown with YAML frontmatter: name, description, categories, tools. The body is the agent's system prompt."
        initial={NEW_AGENT_TEMPLATE}
        open={creating}
        onOpenChange={setCreating}
        onSave={async (markdown) => {
          const res = await api("/api/agents", "POST", { markdown });
          if (res.ok) router.refresh();
          return res.ok ? null : (res.error ?? "Save failed.");
        }}
      />
    </div>
  );
}
