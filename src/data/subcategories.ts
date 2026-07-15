export interface Subcategory {
  slug: string;
  name: string;
  image: string;
}

export const subcategoriesByCategory: Record<string, Subcategory[]> = {
  "hydraulic-pumps": [
    {
      slug: "gear-pumps",
      name: "Шестерённые насосы",
      image: "/category-hydraulic-pumps/1-gear-pumps.jpg",
    },
    {
      slug: "axial-piston-pumps",
      name: "Аксиально поршневые насосы",
      image: "/category-hydraulic-pumps/2-axial-piston-pumps.jpg",
    },
    {
      slug: "inline-piston-pumps",
      name: "Прямые поршневые насосы",
      image: "/category-hydraulic-pumps/3-inline-piston-pumps.jpg",
    },
  ],
  tanks: [
    {
      slug: "side-tanks",
      name: "Боковые",
      image: "/categoty-hydro-tanks/1-side-tanks.jpg",
    },
    {
      slug: "behind-cab-tanks",
      name: "За кабину",
      image: "/categoty-hydro-tanks/2-behind-cab-tanks.jpg",
    },
  ],
};
