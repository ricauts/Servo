import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/authjs";
import SetupWizard from "@/components/admin/SetupWizard";

export const dynamic = "force-dynamic";

/** First-run environment setup for fresh self-hosted installs. */
export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/dashboard");

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-sidebar p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="font-heading text-[34px] font-black leading-none tracking-tight text-sidebar-foreground">
            Servo<span className="text-primary">.</span>
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
            First-run setup
          </p>
        </div>
        <SetupWizard />
      </div>
    </div>
  );
}
