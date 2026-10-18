import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { singleLineFieldClassName } from "./field-styles";

// Native <select> (keyboard, phone pickers and form submission stay the browser's), drawn as a field of the
// system with its own chevron.
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(singleLineFieldClassName, "cursor-pointer appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
