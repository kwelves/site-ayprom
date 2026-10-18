import { cn } from "@/lib/utils";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  containerClassName?: string;
}

export function Checkbox({ className, containerClassName, label, ...props }: CheckboxProps) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5 text-sm text-card-foreground", containerClassName)}>
      <input
        type="checkbox"
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded-[5px] accent-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25",
          className
        )}
        {...props}
      />
      {label}
    </label>
  );
}
