import { categoryIconMap } from "@/lib/category-icons";
import type { Brand, Category, IconComponent } from "@/types/catalog";

export interface NavDropdownItem {
  label: string;
  description: string;
  href: string;
  /** Icon-based row (categories). */
  icon?: IconComponent;
  /** Photo-based row (real brand logo) — takes priority over `icon` when present. */
  logo?: string;
}

export interface NavItem {
  label: string;
  href: string;
  dropdown?: NavDropdownItem[];
}

// Takes categories/brands as parameters (fetched once, server-side, in the
// root layout) instead of importing the data modules directly — this is
// what lets Header/Footer stay client components without each doing their
// own fetch.
export function buildMainNav(categories: Category[], brands: Brand[]): NavItem[] {
  const catalogDropdown: NavDropdownItem[] = categories.map((category) => ({
    label: category.name,
    description: category.description,
    href: `/catalog/category/${category.slug}`,
    icon: categoryIconMap[category.icon],
  }));

  // Real, unfiltered brand list — grows as brands are added in the admin.
  const brandsDropdown: NavDropdownItem[] = brands.map((brand) => ({
    label: brand.name,
    description: brand.country,
    href: `/catalog/brand/${brand.slug}`,
    logo: brand.logo,
  }));

  return [
    { label: "Главная", href: "/" },
    { label: "Спецтехника", href: "/#vehicle-showcase" },
    { label: "Каталог", href: "/#categories", dropdown: catalogDropdown },
    { label: "Бренды", href: "/#brands", dropdown: brandsDropdown },
    { label: "О нас", href: "/#about" },
  ];
}
