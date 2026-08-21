import { cn } from "@/lib/utils";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  containerClassName?: string;
}

export function Checkbox({ className, containerClassName, label, ...props }: CheckboxProps) {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-card-foreground", containerClassName)}>
      <input
        type="checkbox"
        className={cn(
          "h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className
        )}
        {...props}
      />
      {label}
    </label>
  );
}
