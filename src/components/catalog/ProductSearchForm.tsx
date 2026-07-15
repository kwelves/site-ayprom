import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ProductSearchFormProps {
  action: string;
  defaultValue?: string;
  placeholder: string;
}

// Plain GET form, mirroring Hero's search bar exactly — submit-based (Enter
// or the button), no client JS. `action` points back at the current page so
// resubmitting a new query keeps you on the same scoped page.
export function ProductSearchForm({ action, defaultValue, placeholder }: ProductSearchFormProps) {
  return (
    <form
      action={action}
      method="GET"
      className="mx-auto flex w-full max-w-lg items-center gap-2 rounded-lg border border-slate-300 bg-card p-1.5 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
    >
      <Search className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-10 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-slate-400"
      />
      <Button type="submit" className="shrink-0">
        Найти
      </Button>
    </form>
  );
}
