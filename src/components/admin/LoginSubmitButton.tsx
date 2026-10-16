"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";

// Lives inside the login <form>: useFormStatus reacts to both a button click
// and the form's native Enter-key submission, so both paths get the same
// immediate feedback while the Server Action checks the password.
export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <div className="mt-5">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={buttonClassName({ variant: "primary", size: "lg", className: "w-full disabled:cursor-wait disabled:opacity-100" })}
      >
        <Loader2 aria-hidden="true" className={cn("!size-3.5 animate-spin", !pending && "hidden")} />
        {pending ? "Проверяем доступ…" : "Войти"}
      </button>

      <p className="mt-2 min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {pending ? "Проверяем пароль. Это может занять несколько секунд." : ""}
      </p>
    </div>
  );
}
