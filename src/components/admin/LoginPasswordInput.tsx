"use client";

import { singleLineFieldClassName } from "@/components/admin/ui/field-styles";

// React Server Action forms do not reliably perform implicit submission from
// this password field in every browser. requestSubmit() keeps native form
// validation and invokes the same submit button/action as a pointer click.
export function LoginPasswordInput({ invalid = false }: { invalid?: boolean }) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      (event.key === "Enter" || event.key === "NumpadEnter") &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <input
      type="password"
      name="password"
      required
      autoFocus
      autoComplete="current-password"
      enterKeyHint="go"
      aria-invalid={invalid || undefined}
      aria-describedby="login-status"
      onKeyDown={handleKeyDown}
      className={`${singleLineFieldClassName} mt-2 sm:h-11`}
    />
  );
}
