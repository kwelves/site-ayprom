import { LayoutGrid, Truck } from "lucide-react";
import { categories } from "@/data/categories";
import { categoryIconMap } from "@/lib/category-icons";
import type { IconComponent } from "@/types/catalog";

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

export const catalogDropdown: NavDropdownItem[] = categories.map((category) => ({
  label: category.name,
  description: category.description,
  href: `/catalog/category/${category.slug}`,
  icon: categoryIconMap[category.icon],
}));

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

export const mainNav: NavItem[] = [
  { label: "Главная", href: "/" },
  { label: "Каталог", href: "/#categories", dropdown: catalogDropdown },
  { label: "Бренды", href: "/#brands", dropdown: brandsDropdown },
  { label: "О нас", href: "/#about" },
  { label: "Контакты", href: "/#contacts" },
];
