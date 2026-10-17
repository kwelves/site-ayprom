import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  description?: string;
  /** Marks a field the form cannot be saved without. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

// Label above the field, help under it (design system v2, "Поля"). The help sits below the field so the label and
// the field stay together, and it reads after the value it explains.
export function FormField({ label, htmlFor, description, required, className, children }: FormFieldProps) {
  return (
    <div className={className}>
      {/* The required mark is drawn by CSS, so it never becomes part of the label text. */}
      <label
        htmlFor={htmlFor}
        className={cn("block text-[13px] font-medium text-foreground", required && "after:ml-0.5 after:text-danger after:content-['*']")}
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {description && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{description}</p>}
    </div>
  );
}
