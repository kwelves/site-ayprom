import type { Metadata } from "next";
import { PasswordChangeForm } from "@/components/admin/PasswordChangeForm";

export const metadata: Metadata = {
  title: "Смена пароля — Админка AYPROM",
};

export default function AdminSecurityPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Смена пароля</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обновите общий пароль доступа к административной панели.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <PasswordChangeForm />
      </section>
    </div>
  );
}
