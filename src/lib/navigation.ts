import { LayoutGrid, Truck } from "lucide-react";
import type { Brand, IconComponent } from "@/types/catalog";

export interface NavDropdownItem {
  label: string;
  description: string;
  href: string;
  /** Icon-based row (categories, curated brand shortcuts). */
  icon?: IconComponent;
  /** Photo-based row (real brand logo) — takes priority over `icon` when present. */
  logo?: string;
}

export interface NavItem {
  label: string;
  href: string;
  dropdown?: NavDropdownItem[];
}

export const brandsDropdown: NavDropdownItem[] = [
  { label: "HOWO", description: "Марка спецтехники, Китай", href: "/catalog/brand/howo", icon: Truck },
  { label: "Shacman", description: "Марка спецтехники, Китай", href: "/catalog/brand/shacman", icon: Truck },
  { label: "FAW", description: "Марка спецтехники, Китай", href: "/catalog/brand/faw", icon: Truck },
  {
    label: "Другие бренды",
    description: "Полный список марок техники",
    href: "/catalog",
    icon: LayoutGrid,
  },
];

// Takes brands as a parameter (fetched once, server-side, in the root
// layout) instead of importing the data module directly — this is what lets
// Header/Footer stay client components without each doing their own fetch.
export function buildMainNav(brands: Brand[]): NavItem[] {
  // Real, unfiltered brand list — grows as brands are added in the admin,
  // unlike the curated `brandsDropdown` shortcut above.
  const allBrandsDropdown: NavDropdownItem[] = brands.map((brand) => ({
    label: brand.name,
    description: brand.country,
    href: `/catalog/brand/${brand.slug}`,
    logo: brand.logo,
  }));

  return [
    { label: "Главная", href: "/" },
    { label: "Спецтехника", href: "/#vehicle-showcase" },
    { label: "Каталог", href: "/#categories", dropdown: allBrandsDropdown },
    { label: "Бренды", href: "/#brands", dropdown: brandsDropdown },
    { label: "О нас", href: "/#about" },
  ];
}
