import { cn } from "@/lib/utils";
import { singleLineFieldClassName } from "./field-styles";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(singleLineFieldClassName, className)} {...props} />;
}
