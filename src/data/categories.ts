import type { Category } from "@/types/catalog";

export const categories: Category[] = [
  {
    slug: "gear-pumps",
    name: "Шестерёнчатые насосы",
    description: "Гидравлические насосы шестерённого типа для спецтехники и грузовой техники",
    icon: "gear-pump",
    image: "/catalog-cards/1-gear-pump-card-photo.png",
  },
  {
    slug: "piston-pumps",
    name: "Поршневые насосы",
    description: "Аксиально- и радиально-поршневые насосы высокого давления",
    icon: "piston-pump",
    image: "/catalog-cards/2-piston-pump-card-photo.png",
  },
  {
    slug: "pto",
    name: "Коробки отбора мощности PTO",
    description: "КОМ для навесного и гидравлического оборудования спецтехники",
    icon: "pto",
    image: "/catalog-cards/3-pto-card-photo.png",
  },
  {
    slug: "valves-distributors",
    name: "Клапаны и гидрораспределители",
    description: "Гидравлические клапаны, гидрораспределители и предохранительная арматура",
    icon: "valve",
    image: "/catalog-cards/4-valve-card-photo.png",
  },
  {
    slug: "pneumatic-control",
    name: "Пневматическое управление",
    description: "Пневмоклапаны, пневмоцилиндры и элементы управления сжатым воздухом",
    icon: "pneumatic",
    image: "/catalog-cards/5-pneumatic-valves-card-photo.png",
  },
  {
    slug: "tanks-filters-cooling",
    name: "Баки, фильтры и охлаждение",
    description: "Гидробаки, масляные фильтры и радиаторы охлаждения гидросистем",
    icon: "tank-cooling",
    image: "/catalog-cards/6-oil-tank-card-photo.png",
  },
  {
    slug: "fittings-adapters-hoses",
    name: "Фитинги, переходники и шланги",
    description: "Резьбовые фитинги, переходники и рукава высокого давления",
    icon: "fitting",
    image: "/catalog-cards/7-adapter-card-photo.png",
  },
  {
    slug: "accessories-components",
    name: "Аксессуары и комплектующие",
    description: "Уплотнения, крепёж и прочие комплектующие для гидрооборудования",
    icon: "accessory",
    image: "/catalog-cards/8-others-card-photo.png",
  },
];
