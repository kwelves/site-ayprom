"use client";

import { useActionState, type KeyboardEvent } from "react";
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
    <form action={formAction} onKeyDown={handleKeyDown} className="space-y-5">
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
        <p role="alert" className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="border-t border-border pt-5">
        <SubmitButton pendingLabel="Меняем пароль…">Изменить пароль</SubmitButton>
        <p className="mt-2 text-xs text-muted-foreground">
          После сохранения все активные сессии завершатся. Войдите заново с новым паролем.
        </p>
      </div>
    </form>
  );
}
