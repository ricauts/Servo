import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAiSettings } from "@/lib/ai/settings";
import type { RiskLevel } from "@/lib/types";
import PageHeader from "@/components/shell/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import Avatar from "@/components/legacy/Avatar";
import Badge from "@/components/legacy/Badge";
import EmptyState from "@/components/legacy/EmptyState";
import type { BadgeTone } from "@/lib/labels";
import AiProviderForm, {
  type AiSettingsView,
} from "@/components/admin/AiProviderForm";
import ToolPolicyTable, {
  type ToolPolicyView,
} from "@/components/admin/ToolPolicyTable";
import CustomToolsManager, {
  type CustomToolView,
} from "@/components/admin/CustomToolsManager";
import SmtpForm, { type SmtpSettingsView } from "@/components/admin/SmtpForm";
import GithubForm, { type GithubSettingsView } from "@/components/admin/GithubForm";
import AzureForm, { type AzureSettingsView } from "@/components/admin/AzureForm";
import InboundEmailForm, {
  type InboundSettingsView,
} from "@/components/admin/InboundEmailForm";
import { getSmtpConfig } from "@/lib/notify";
import { getInboundConfig } from "@/lib/inbound-email";
import { ensureSlaPolicies } from "@/lib/sla";
import SlaPolicyTable, {
  type SlaPolicyView,
} from "@/components/admin/SlaPolicyTable";
import { PRIORITIES } from "@/lib/types";
import { getGithubConfig } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig } from "@/lib/integrations/azure";

export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, BadgeTone> = {
  ADMIN: "brand",
  AGENT: "good",
  REQUESTER: "neutral",
  AI_AGENT: "violet",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (user.role !== "ADMIN") {
    return (
      <>
        <PageHeader
          title="Settings"
          description="AI provider, tool permissions and team."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Admin access required"
            hint="Settings can only be managed by administrators. Use the user switcher at the bottom of the sidebar to switch to an admin account."
          />
        </div>
      </>
    );
  }

  await ensureSlaPolicies();
  const [ai, smtp, inbound, github, azure, toolPolicies, customTools, users, slaPolicies] =
    await Promise.all([
    getAiSettings(),
    getSmtpConfig(),
    getInboundConfig(),
    getGithubConfig(),
    getAzureConfig(),
      db.toolPolicy.findMany({ orderBy: { toolName: "asc" } }),
      db.customTool.findMany({ orderBy: { createdAt: "asc" } }),
      db.user.findMany({ orderBy: { createdAt: "asc" } }),
      db.slaPolicy.findMany(),
    ]);

  const slaByPriority = new Map(slaPolicies.map((p) => [p.priority, p]));
  const slaViews: SlaPolicyView[] = PRIORITIES.flatMap((priority) => {
    const policy = slaByPriority.get(priority);
    return policy
      ? [
          {
            priority,
            responseMinutes: policy.responseMinutes,
            resolutionMinutes: policy.resolutionMinutes,
            escalateOnBreach: policy.escalateOnBreach,
          },
        ]
      : [];
  });

  const inboundSettings: InboundSettingsView = {
    enabled: inbound.enabled,
    secretSet: inbound.secret.length > 0,
    secretSource: inbound.secretSource,
  };

  const azureSettings: AzureSettingsView = {
    tenantId: azure.tenantId,
    clientId: azure.clientId,
    subscriptionId: azure.subscriptionId,
    secretSet: azure.clientSecret.length > 0,
    secretSource: azure.secretSource,
    configured: azureConfigured(azure),
  };

  const githubSettings: GithubSettingsView = {
    owner: github.owner,
    tokenSet: github.token.length > 0,
    tokenSource: github.tokenSource,
  };

  const smtpSettings: SmtpSettingsView = {
    enabled: smtp.enabled,
    from: smtp.from,
    urlSet: smtp.url.length > 0,
    urlSource: smtp.urlSource,
  };

  const aiSettings: AiSettingsView = {
    provider: ai.configuredProvider,
    baseUrl: ai.baseUrl ?? "",
    model: ai.model,
    autoTriage: ai.autoTriage,
    qaEnabled: ai.qaEnabled,
    apiKeySet: ai.apiKey.length > 0,
    keySource: ai.keySource,
    fallingBackToMock: ai.configuredProvider !== "mock" && ai.provider === "mock",
  };

  const policyViews: ToolPolicyView[] = toolPolicies.map((p) => ({
    toolName: p.toolName,
    description: p.description,
    riskLevel: p.riskLevel as RiskLevel,
    enabled: p.enabled,
    requiresApproval: p.requiresApproval,
  }));

  const policyByName = new Map(toolPolicies.map((p) => [p.toolName, p]));
  const customToolViews: CustomToolView[] = customTools.map((t) => {
    const policy = policyByName.get(t.name);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      method: t.method,
      url: t.url,
      headers: t.headers,
      bodyTemplate: t.bodyTemplate,
      secretSet: t.secret.length > 0,
      riskLevel: (policy?.riskLevel ?? "MEDIUM") as RiskLevel,
      requiresApproval: policy?.requiresApproval ?? true,
    };
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure the AI provider (bring your own key), tool permissions, integrations and review your team."
      />
      {/* Tabs keep each concern on one screen instead of one long scroll. */}
      <Tabs defaultValue="ai" className="max-w-4xl gap-4 p-4 md:p-8">
        <TabsList>
          <TabsTrigger value="ai">AI provider</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="sla">SLA</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle>AI provider (BYOK)</CardTitle>
            </CardHeader>
            <CardContent>
              <AiProviderForm initial={aiSettings} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tool permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <ToolPolicyTable initialPolicies={policyViews} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom tools & integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomToolsManager tools={customToolViews} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla">
          <Card>
            <CardHeader>
              <CardTitle>SLA targets & auto-escalation</CardTitle>
            </CardHeader>
            <CardContent>
              <SlaPolicyTable initialPolicies={slaViews} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email notifications (SMTP)</CardTitle>
            </CardHeader>
            <CardContent>
              <SmtpForm initial={smtpSettings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inbound email (tickets from a mailbox)</CardTitle>
            </CardHeader>
            <CardContent>
              <InboundEmailForm initial={inboundSettings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>GitHub integration</CardTitle>
            </CardHeader>
            <CardContent>
              <GithubForm initial={githubSettings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Azure integration (read-only)</CardTitle>
            </CardHeader>
            <CardContent>
              <AzureForm initial={azureSettings} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 font-sans">
            <ul className="flex flex-col">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 rounded-md px-1 py-2"
                >
                  <Avatar
                    name={u.name}
                    color={u.color}
                    size={28}
                    isAi={u.role === "AI_AGENT"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {u.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.email}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>
                      {u.role.replace("_", " ")}
                    </Badge>
                    {u.role === "AI_AGENT" && u.aiKind && (
                      <Badge tone="neutral">{u.aiKind}</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Separator />
            <p className="font-body text-sm text-muted-foreground">
              Read-only in this POC — users are seeded for the demo.
            </p>
          </CardContent>
        </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
