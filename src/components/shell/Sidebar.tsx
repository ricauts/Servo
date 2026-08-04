import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import SidebarNav from "@/components/shell/SidebarNav";
import UserSwitcher from "@/components/shell/UserSwitcher";
import ThemeToggle from "@/components/shell/ThemeToggle";
import MobileTopbar from "@/components/shell/MobileTopbar";

export default async function Sidebar() {
  const user = await getCurrentUser();
  const [pendingApprovals, openTickets, users] = await Promise.all([
    db.approval.count({ where: { status: "PENDING" } }),
    db.ticket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    db.user.findMany({
      where: { role: { not: "AI_AGENT" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, color: true },
    }),
  ]);

  return (
    <>
      <MobileTopbar
        counts={{ tickets: openTickets, approvals: pendingApprovals }}
        showTeamNav={can(user, "group.view")}
        users={users}
        currentUserId={user.id}
      />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-start justify-between px-5 pb-6 pt-6">
        <div>
          <div className="font-heading text-[26px] font-black leading-none tracking-tight">
            Servo<span className="text-primary">.</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
            AI service desk
          </div>
        </div>
        <ThemeToggle />
      </div>

      <SidebarNav
        counts={{ tickets: openTickets, approvals: pendingApprovals }}
        showTeamNav={can(user, "group.view")}
      />

        <div className="mt-auto border-t border-sidebar-border p-3">
          <UserSwitcher users={users} currentUserId={user.id} />
        </div>
      </aside>
    </>
  );
}
