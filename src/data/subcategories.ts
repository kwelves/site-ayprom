export interface Subcategory {
  slug: string;
  name: string;
  image: string;
}

export const subcategoriesByCategory: Record<string, Subcategory[]> = {
  "hydraulic-pumps": [
    {
      slug: "gear-pumps",
      name: "Шестеренчатые насосы",
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
};
