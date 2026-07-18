interface FormFieldProps {
  label: string;
  htmlFor: string;
  description?: string;
  children: React.ReactNode;
}

export function FormField({ label, htmlFor, description, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-card-foreground">
        {label}
      </label>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
