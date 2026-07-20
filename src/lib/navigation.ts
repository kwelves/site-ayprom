import { LayoutGrid, Truck } from "lucide-react";
import { categoryIconMap } from "@/lib/category-icons";
import type { Category, IconComponent, VehicleType } from "@/types/catalog";

export interface NavDropdownItem {
  label: string;
  description: string;
  href: string;
  icon: IconComponent;
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

// Takes categories/vehicleTypes as parameters (fetched once, server-side, in
// the root layout) instead of importing the data modules directly — this is
// what lets Header/Footer stay client components without each doing their
// own fetch.
export function buildMainNav(categories: Category[], vehicleTypes: VehicleType[]): NavItem[] {
  const catalogDropdown: NavDropdownItem[] = categories.map((category) => ({
    label: category.name,
    description: category.description,
    href: `/catalog/category/${category.slug}`,
    icon: categoryIconMap[category.icon],
  }));

  // Built from real data (like catalogDropdown), not curated like
  // brandsDropdown — vehicle types have no description/icon of their own,
  // so every item shares one generic description and the same icon.
  const vehicleTypeDropdown: NavDropdownItem[] = vehicleTypes.map((vehicleType) => ({
    label: vehicleType.name,
    description: "Запчасти для этого типа техники",
    href: `/catalog/vehicle-type/${vehicleType.slug}`,
    icon: Truck,
  }));

  return [
    { label: "Главная", href: "/" },
    { label: "Каталог", href: "/#categories", dropdown: catalogDropdown },
    { label: "Бренды", href: "/#brands", dropdown: brandsDropdown },
    // No homepage section for vehicle types yet, so the parent link goes to
    // the general catalog instead of a "/#..." anchor — replace with an
    // anchor once that section exists.
    { label: "Спецтехника", href: "/catalog", dropdown: vehicleTypeDropdown },
    { label: "О нас", href: "/#about" },
    { label: "Контакты", href: "/#contacts" },
  ];
}
