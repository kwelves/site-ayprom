"use client";

import { useActionState, type KeyboardEvent } from "react";
import { LogOut } from "lucide-react";
import { changeAdminPassword, type PasswordChangeState } from "@/lib/admin/actions";
import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH } from "@/lib/admin/password-credential";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";

export function PasswordChangeForm() {
  const [state, formAction] = useActionState<PasswordChangeState, FormData>(changeAdminPassword, null);

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (
      (event.key === "Enter" || event.key === "NumpadEnter") &&
      !event.nativeEvent.isComposing &&
      event.target instanceof HTMLInputElement
    ) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form action={formAction} onKeyDown={handleKeyDown} className="glass-panel max-w-xl space-y-5 rounded-[18px] p-[18px] sm:p-6">
      <FormField label="Текущий пароль" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </FormField>

      <FormField
        label="Новый пароль"
        htmlFor="newPassword"
        description={`От ${ADMIN_PASSWORD_MIN_LENGTH} до ${ADMIN_PASSWORD_MAX_LENGTH} символов.`}
      >
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={ADMIN_PASSWORD_MIN_LENGTH}
          maxLength={ADMIN_PASSWORD_MAX_LENGTH}
          required
        />
      </FormField>

      <FormField label="Повторите новый пароль" htmlFor="confirmPassword">
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={ADMIN_PASSWORD_MIN_LENGTH}
          maxLength={ADMIN_PASSWORD_MAX_LENGTH}
          required
        />
      </FormField>

      {state?.error && (
        <p role="alert" className="rounded-[12px] border border-danger-border bg-danger-surface px-3 py-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}

      <p className="flex items-start gap-2.5 rounded-[12px] bg-info-surface px-3 py-2.5 text-[13px] leading-snug text-info">
        <LogOut aria-hidden="true" className="mt-px size-4 shrink-0" />
        После смены пароля все активные сессии завершатся, на всех устройствах. Войдите заново с новым паролем.
      </p>

      <SubmitButton pendingLabel="Меняем пароль…" size="lg" className="w-full sm:w-auto">
        Изменить пароль
      </SubmitButton>
    </form>
  );
}
