import type { Metadata } from "next";
import { PasswordChangeForm } from "@/components/admin/PasswordChangeForm";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";

export const metadata: Metadata = {
  title: "Смена пароля — Админка AYPROM",
};

// Opened from the settings menu at the bottom of the sidebar. One glass panel, no card inside a card.
export default function AdminSecurityPage() {
  return (
    <div className="max-w-xl">
      <AdminPageHeader title="Смена пароля" description="Один общий пароль для входа в админку." />
      <div className="mt-5">
        <PasswordChangeForm />
      </div>
    </div>
  );
}
