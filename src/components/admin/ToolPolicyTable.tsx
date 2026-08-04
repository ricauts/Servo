"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RISK_LABEL } from "@/lib/labels";
import type { RiskLevel } from "@/lib/types";

export type ToolPolicyView = {
  toolName: string;
  description: string;
  riskLevel: RiskLevel;
  enabled: boolean;
  requiresApproval: boolean;
};

const RISK_LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

export default function ToolPolicyTable({
  initialPolicies,
}: {
  initialPolicies: ToolPolicyView[];
}) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [savingTool, setSavingTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(
    toolName: string,
    patch: Partial<Pick<ToolPolicyView, "enabled" | "requiresApproval" | "riskLevel">>,
  ) {
    const previous = policies;
    // Optimistic update; row is disabled while the request is in flight.
    setPolicies((rows) =>
      rows.map((r) => (r.toolName === toolName ? { ...r, ...patch } : r)),
    );
    setSavingTool(toolName);
    setError(null);
    try {
      const res = await fetch("/api/settings/tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, ...patch }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Update failed (${res.status}).`);
        setPolicies(previous);
      }
    } catch {
      setError("Network error — change was not saved.");
      setPolicies(previous);
    } finally {
      setSavingTool(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-heading">Tool</TableHead>
              <TableHead className="w-[150px] font-heading">Risk</TableHead>
              <TableHead className="w-[100px] font-heading">Enabled</TableHead>
              <TableHead className="w-[100px] font-heading">Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((p) => (
              <TableRow key={p.toolName}>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={
                        p.enabled
                          ? "font-mono text-xs text-foreground"
                          : "font-mono text-xs text-muted-foreground"
                      }
                    >
                      {p.toolName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.description}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={p.riskLevel}
                    onValueChange={(value) =>
                      void update(p.toolName, { riskLevel: value as RiskLevel })
                    }
                    disabled={savingTool === p.toolName}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full"
                      aria-label={`Risk level for ${p.toolName}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RISK_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {RISK_LABEL[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch
                    size="sm"
                    checked={p.enabled}
                    onCheckedChange={(checked) =>
                      void update(p.toolName, { enabled: checked })
                    }
                    disabled={savingTool === p.toolName}
                    aria-label={`Enable ${p.toolName}`}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    size="sm"
                    checked={p.requiresApproval}
                    onCheckedChange={(checked) =>
                      void update(p.toolName, { requiresApproval: checked })
                    }
                    disabled={savingTool === p.toolName}
                    aria-label={`Require approval for ${p.toolName}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Separator />
      <p className="font-body text-sm text-muted-foreground">
        Tools with &quot;Approval&quot; on pause the agent until a human
        decides. HIGH-risk approvals can only be decided by admins.
      </p>
    </div>
  );
}
