import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAuthConfig } from "@/lib/authjs";
import PageHeader from "@/components/shell/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/legacy/EmptyState";
import SmtpForm, { type SmtpSettingsView } from "@/components/admin/SmtpForm";
import GithubForm, { type GithubSettingsView } from "@/components/admin/GithubForm";
import AzureForm, { type AzureSettingsView } from "@/components/admin/AzureForm";
import InboundEmailForm, {
  type InboundSettingsView,
} from "@/components/admin/InboundEmailForm";
import WebhooksManager, {
  type WebhookView,
} from "@/components/admin/WebhooksManager";
import AuthTenantForm, {
  type AuthTenantView,
} from "@/components/admin/AuthTenantForm";
import McpForm, { type McpSettingsView } from "@/components/admin/McpForm";
import { getMcpConfig } from "@/lib/mcp";
import { getSmtpConfig } from "@/lib/notify";
import { getInboundConfig } from "@/lib/inbound-email";
import { getGithubConfig } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig } from "@/lib/integrations/azure";

export const dynamic = "force-dynamic";

/**
 * Integrations get their own surface: this list grows with every release
 * (SSO, email in/out, GitHub, Azure, webhooks…) and would drown Settings.
 */
export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return (
      <>
        <PageHeader
          title="Integrations"
          description="Connect Servo to your identity provider and systems."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Admin access required"
            hint="Integrations can only be managed by administrators."
          />
        </div>
      </>
    );
  }

  const [authConfig, smtp, inbound, github, azure, mcp, webhookRows] = await Promise.all([
    getAuthConfig(),
    getSmtpConfig(),
    getInboundConfig(),
    getGithubConfig(),
    getAzureConfig(),
    getMcpConfig(),
    db.webhook.findMany({
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const authView: AuthTenantView = {
    mode: authConfig.mode,
    issuer: authConfig.issuer,
    clientId: authConfig.clientId,
    providerName: authConfig.providerName,
    adminEmails: authConfig.adminEmails.join(", "),
    secretSet: authConfig.clientSecret.length > 0,
    secretSource: authConfig.secretSource,
  };
  const smtpSettings: SmtpSettingsView = {
    enabled: smtp.enabled,
    from: smtp.from,
    urlSet: smtp.url.length > 0,
    urlSource: smtp.urlSource,
  };
  const inboundSettings: InboundSettingsView = {
    enabled: inbound.enabled,
    secretSet: inbound.secret.length > 0,
    secretSource: inbound.secretSource,
  };
  const githubSettings: GithubSettingsView = {
    owner: github.owner,
    tokenSet: github.token.length > 0,
    tokenSource: github.tokenSource,
  };
  const azureSettings: AzureSettingsView = {
    tenantId: azure.tenantId,
    clientId: azure.clientId,
    subscriptionId: azure.subscriptionId,
    secretSet: azure.clientSecret.length > 0,
    secretSource: azure.secretSource,
    configured: azureConfigured(azure),
  };
  const mcpView: McpSettingsView = {
    tokenSet: mcp.token.length > 0,
    tokenSource: mcp.tokenSource,
  };
  const webhookViews: WebhookView[] = webhookRows.map((hook) => ({
    id: hook.id,
    url: hook.url,
    events: JSON.parse(hook.events) as string[],
    enabled: hook.enabled,
    deliveries: hook.deliveries.map((d) => ({
      id: d.id,
      event: d.event,
      ok: d.ok,
      statusCode: d.statusCode,
      error: d.error,
      durationMs: d.durationMs,
    })),
  }));

  const sections: { title: string; body: React.ReactNode }[] = [
    { title: "Single sign-on (OIDC)", body: <AuthTenantForm initial={authView} /> },
    { title: "Email notifications (SMTP)", body: <SmtpForm initial={smtpSettings} /> },
    {
      title: "Inbound email (tickets from a mailbox)",
      body: <InboundEmailForm initial={inboundSettings} />,
    },
    { title: "GitHub", body: <GithubForm initial={githubSettings} /> },
    { title: "Azure (read-only)", body: <AzureForm initial={azureSettings} /> },
    { title: "Outbound webhooks", body: <WebhooksManager webhooks={webhookViews} /> },
    { title: "MCP server (tools for external agents)", body: <McpForm initial={mcpView} /> },
  ];

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect Servo to your identity provider, mail, code and cloud — every credential stays server-side and is never returned by the API."
      />
      <div className="max-w-4xl space-y-4 p-4 md:p-8">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>{section.body}</CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
