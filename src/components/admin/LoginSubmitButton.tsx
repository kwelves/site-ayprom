"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

// Lives inside the login <form>: useFormStatus reacts to both a button click
// and the form's native Enter-key submission, so both paths get the same
// immediate feedback while the Server Action checks the password.
export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <div className="mt-6">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-75 sm:py-2"
      >
        {pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
        {pending ? "Проверяем доступ…" : "Войти"}
      </button>

      <p className="mt-2 min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {pending ? "Проверяем пароль. Это может занять несколько секунд." : ""}
      </p>
    </div>
  );
}
