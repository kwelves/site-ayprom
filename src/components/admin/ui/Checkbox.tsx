import { cn } from "@/lib/utils";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-card-foreground">
      <input
        type="checkbox"
        className={cn(
          "h-4 w-4 rounded border-slate-300 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className
        )}
        {...props}
      />
      {label}
    </label>
  );
}
