import type { Category } from "@/types/catalog";

export const categories: Category[] = [
  {
    slug: "hydraulic-pumps",
    name: "Гидронасосы",
    description: "Гидравлические насосы для спецтехники и грузовой техники",
    icon: "hydraulic-pump",
    image: "/catalog-cards/1-gydro-pupms.jpg",
  },
  {
    slug: "pto",
    name: "Коробки отбора мощности",
    description: "КОМ для навесного и гидравлического оборудования спецтехники",
    icon: "pto",
    image: "/catalog-cards/2-pto.png",
  },
  {
    slug: "pto-shafts",
    name: "Валы отбора мощности",
    description: "Карданные валы для передачи мощности от КОМ к насосу",
    icon: "pto-shaft",
    image: "/catalog-cards/3-valves.jpg",
  },
  {
    slug: "tanks",
    name: "Гидравлические баки",
    description: "Гидравлические баки для тягачей, самосвалов и спецтехники",
    icon: "tank",
    image: "/catalog-cards/hydro-tanks.jpg",
  },
];
