"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

// Must be a descendant of the <form> it reports on — useFormStatus reads
// the nearest parent <form>'s pending state, so this can't live in the same
// component that renders the <form> itself.
export function SubmitButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
