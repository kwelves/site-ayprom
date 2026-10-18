import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
  containerClassName?: string;
}

// On/off setting (design system v2, "Переключатель"): a 40×22 track, filled with the main-button gradient when on;
// the knob squeezes a little while pressed. Underneath it is a real checkbox, so the form submits it as before and
// keyboard and screen readers treat it as one.
export function Switch({ label, description, containerClassName, className, ...props }: SwitchProps) {
  return (
    <label className={cn("group/switch flex cursor-pointer items-start gap-3", containerClassName)}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className={cn("peer sr-only", className)} {...props} />
        <span
          aria-hidden="true"
          className="h-[22px] w-10 rounded-full bg-surface-strong inset-shadow-xs transition-[background-color] duration-base ease-ui peer-checked:primary-surface peer-focus-visible:ring-[3px] peer-focus-visible:ring-primary/30 peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          className="absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-primary-foreground shadow-sm transition-[translate,width] duration-base ease-spring group-active/switch:w-5 peer-checked:translate-x-[18px] peer-checked:group-active/switch:translate-x-[14px]"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
