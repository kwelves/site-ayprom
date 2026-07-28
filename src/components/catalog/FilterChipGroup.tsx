import Link from "next/link";
import { cn } from "@/lib/utils";

interface Chip {
  slug: string;
  name: string;
  active: boolean;
  href: string;
}

interface FilterChipGroupProps {
  label: string;
  chips: Chip[];
}

// Chips are links to query-param variants of /catalog (backed by the
// existing search_catalog_products RPC), not a client-side checkbox
// multiselect — see docs/design-orchestration/06-council-result.md §7.
export function FilterChipGroup({ label, chips }: FilterChipGroupProps) {
  if (chips.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.slug}>
            <Link
              href={chip.href}
              aria-current={chip.active ? "true" : undefined}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                chip.active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-foreground hover:bg-accent",
              )}
            >
              {chip.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
