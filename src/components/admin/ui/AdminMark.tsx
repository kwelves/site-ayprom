import { cn } from "@/lib/utils";

// The AYPROM sign in the admin, from the brand files the public site already uses (vector, crisp at any size).
// "logo": the blue plate with the truck and the AYPROM wordmark, set no lower than 40px so the letters read
// clearly — for the sidebar, the phone menu and the login card. "icon": the truck alone, for squares too small
// for letters (folded sidebar, phone top bar). Both sit on the glass with a thin dark edge so the plate keeps
// its outline in the dark theme too.
export function AdminMark({
  variant = "logo",
  size = "md",
  className,
  decorative = true,
}: {
  variant?: "logo" | "icon";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Next to a visible "AYPROM" label the sign adds nothing for screen readers. */
  decorative?: boolean;
}) {
  const height = { sm: "h-8", md: "h-10", lg: "h-14" }[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand file, the same in the Next and SPA builds
    <img
      src={variant === "logo" ? "/brand/ayprom-logo.svg" : "/brand/ayprom-icon.svg"}
      alt={decorative ? "" : "AYPROM"}
      aria-hidden={decorative || undefined}
      draggable={false}
      width={variant === "logo" ? 378 : 102}
      height={90}
      className={cn(
        "w-auto shrink-0 rounded-[10px] shadow-[0_0_0_1px_var(--color-glass-edge),0_6px_16px_-8px_var(--color-primary-shadow)] select-none",
        height,
        className,
      )}
    />
  );
}
