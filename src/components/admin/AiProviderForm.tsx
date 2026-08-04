"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import Spinner from "@/components/legacy/Spinner";

export interface AiSettingsView {
  provider: string; // "anthropic" | "mock"
  baseUrl: string;
  model: string;
  autoTriage: boolean;
  qaEnabled: boolean;
  apiKeySet: boolean;
  keySource: "env" | "db" | "none";
}

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "mock", label: "Mock (offline)" },
];

export default function AiProviderForm({ initial }: { initial: AiSettingsView }) {
  const [provider, setProvider] = useState(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [autoTriage, setAutoTriage] = useState(initial.autoTriage);
  const [qaEnabled, setQaEnabled] = useState(initial.qaEnabled);
  const [apiKeySet, setApiKeySet] = useState(initial.apiKeySet);
  const [keySource, setKeySource] = useState(initial.keySource);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra?: { apiKey: string }) {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      provider,
      baseUrl,
      model,
      autoTriage,
      qaEnabled,
    };
    if (extra) {
      body.apiKey = extra.apiKey;
    } else if (apiKey.trim() !== "") {
      body.apiKey = apiKey.trim();
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        apiKeySet?: boolean;
        keySource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.apiKeySet === "boolean") setApiKeySet(data.apiKeySet);
      if (data.keySource) setKeySource(data.keySource);
      setApiKey("");
      toast("Settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setSaving(false);
    }
  }

  const keyDescription =
    keySource === "env"
      ? "A key is set via the ANTHROPIC_API_KEY environment variable — it takes precedence over any key saved here."
      : keySource === "db"
        ? "A key is stored in Settings."
        : "No key configured — Servo runs with the deterministic mock provider.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4 font-sans"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-provider" className="font-heading">
            Provider
          </Label>
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value)}
            disabled={saving}
          >
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-model" className="font-heading">
            Model
          </Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="claude-opus-5"
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-api-key" className="font-heading">
          API key
        </Label>
        <Input
          id="ai-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={apiKeySet ? "•••••••• (key configured)" : "sk-ant-…"}
          disabled={saving}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{keyDescription}</p>
        {keySource === "db" && (
          <button
            type="button"
            onClick={() => void save({ apiKey: "" })}
            disabled={saving}
            className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Clear stored key
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-base-url" className="font-heading">
          Base URL{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="ai-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.anthropic.com"
          disabled={saving}
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="ai-auto-triage"
            checked={autoTriage}
            onCheckedChange={(checked) => setAutoTriage(checked)}
            disabled={saving}
          />
          <Label htmlFor="ai-auto-triage" className="font-heading">
            Auto-triage new tickets
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="ai-qa-enabled"
            checked={qaEnabled}
            onCheckedChange={(checked) => setQaEnabled(checked)}
            disabled={saving}
          />
          <Label htmlFor="ai-qa-enabled" className="font-heading">
            QA review after risky runs
          </Label>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="font-heading">
          {saving && <Spinner size={14} className="text-primary-foreground" />}
          Save settings
        </Button>
      </div>

      <Separator />
      <p className="font-body text-sm text-muted-foreground">
        Mock mode needs no key: a deterministic offline provider drives triage
        and resolution so the whole demo works without network access. Add an
        Anthropic API key and switch the provider to enable real model calls.
      </p>
    </form>
  );
}
