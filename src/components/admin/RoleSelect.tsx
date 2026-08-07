"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLES = ["ADMIN", "AGENT", "REQUESTER"];

/** Inline role editor for the Team list (admins; not yourself, not AI). */
export default function RoleSelect({
  userId,
  role,
}: {
  userId: string;
  role: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(data.error ?? "Role change failed");
        setValue(role);
        return;
      }
      toast("Role updated");
      router.refresh();
    } catch {
      toast("Network error");
      setValue(role);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Select value={value} disabled={busy} onValueChange={(v) => void change(v)}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
