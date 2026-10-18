import { cn } from "@/lib/utils";
import { fieldClassName } from "./field-styles";

export function Textarea({ className, rows = 4, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(fieldClassName, "py-2.5 leading-relaxed", className)} {...props} />;
}
