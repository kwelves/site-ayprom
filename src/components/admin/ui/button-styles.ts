import { cn } from "@/lib/utils";

// Buttons of the working place (design system v2, "Кнопки"). One main (gradient) button per block; the glass
// button sits next to it for the second action; ghost for quiet actions and icons; danger for removal. Text on one
// line, 13px, weight 600. Press: scale 0.97 (90ms). Hover lift only where a real pointer can hover.
export type ButtonVariant = "primary" | "glass" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-semibold transition-[scale,translate,background-color,color,box-shadow,filter,opacity] duration-fast ease-ui active:scale-[0.97] active:duration-press focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "primary-surface pointer-fine:hover:-translate-y-px pointer-fine:hover:brightness-110 active:brightness-95",
  glass:
    "glass-plate text-foreground pointer-fine:hover:bg-secondary",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  danger: "bg-danger-surface text-danger hover:bg-danger-surface-hover",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  md: "h-11 px-4 sm:h-9.5",
  lg: "h-11 px-5",
  icon: "size-9.5 px-0",
};

export function buttonClassName({
  variant = "glass",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}
