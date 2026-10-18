"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonClassName, type ButtonSize } from "./button-styles";
import { cn } from "@/lib/utils";

// Must be a descendant of the <form> it reports on — useFormStatus reads
// the nearest parent <form>'s pending state, so this can't live in the same
// component that renders the <form> itself.
//
// While saving (design system v2): the label stays in place, slightly blurred, a 14px spinner sits on the left,
// and the button keeps its width, so nothing around it jumps.
export function SubmitButton({
  children,
  pendingLabel,
  size = "md",
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClassName({ variant: "primary", size, className: cn("disabled:opacity-100", className) })}
    >
      <span className="grid place-items-center">
        <span
          aria-hidden={pending}
          className={cn(
            "col-start-1 row-start-1 transition-[opacity,filter] duration-base ease-ui",
            pending && "opacity-0 blur-[2px]",
          )}
        >
          {children}
        </span>
        <span
          aria-hidden={!pending}
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-2 transition-[opacity,filter] duration-base ease-ui",
            !pending && "opacity-0 blur-[2px]",
          )}
        >
          <Loader2 aria-hidden="true" className="!size-3.5 animate-spin" />
          {pendingLabel}
        </span>
      </span>
    </button>
  );
}
