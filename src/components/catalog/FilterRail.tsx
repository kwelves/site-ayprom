import Link from "next/link";
import { FilterChipGroup } from "@/components/catalog/FilterChipGroup";
import { catalogHref, hasActiveFacets, toggleFilterHref, type CatalogFilterParams } from "@/lib/catalog-filters";
import { cn } from "@/lib/utils";
import type { Brand, Category, VehicleType } from "@/types/catalog";

interface FilterRailProps {
  current: CatalogFilterParams;
  categories: Category[];
  brands: Brand[];
  vehicleTypes: VehicleType[];
  className?: string;
}

function buildFacetGroups(props: Omit<FilterRailProps, "className">) {
  const { current, categories, brands, vehicleTypes } = props;
  return [
    {
      label: "Категория",
      chips: categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        active: current.category === category.slug,
        href: toggleFilterHref(current, "category", category.slug),
      })),
    },
    {
      label: "Бренд",
      chips: brands.map((brand) => ({
        slug: brand.slug,
        name: brand.name,
        active: current.brand === brand.slug,
        href: toggleFilterHref(current, "brand", brand.slug),
      })),
    },
    {
      label: "Тип техники",
      chips: vehicleTypes.map((vehicleType) => ({
        slug: vehicleType.slug,
        name: vehicleType.name,
        active: current.vehicleType === vehicleType.slug,
        href: toggleFilterHref(current, "vehicleType", vehicleType.slug),
      })),
    },
  ];
}

export { buildFacetGroups };

export function FilterRail({ className, ...rest }: FilterRailProps) {
  const groups = buildFacetGroups(rest);

  return (
    <aside className={cn("space-y-6 border-r border-hairline pr-6", className)}>
      {hasActiveFacets(rest.current) && (
        <Link href={catalogHref(rest.current, { category: undefined, brand: undefined, vehicleType: undefined })} className="text-sm font-medium text-primary hover:underline">
          Сбросить фильтры
        </Link>
      )}
      {groups.map((group) => (
        <FilterChipGroup key={group.label} label={group.label} chips={group.chips} />
      ))}
    </aside>
  );
}
