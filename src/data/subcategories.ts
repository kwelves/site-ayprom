export interface Subcategory {
  slug: string;
  name: string;
  image: string;
  /** Short (2-3 sentence) explainer shown at the top of the subcategory's
   * product-grid page — what this specific product type is and when it's
   * used, not marketing copy. Optional so a new subcategory can ship without
   * it and just omit the paragraph. */
  intro?: string;
}

export const subcategoriesByCategory: Record<string, Subcategory[]> = {
  "hydraulic-pumps": [
    {
      slug: "gear-pumps",
      name: "Шестерённые насосы",
      image: "/category-hydraulic-pumps/1-gear-pumps.jpg",
      intro:
        "Шестерённый насос — самый распространённый тип гидронасоса для навесного оборудования спецтехники. Жидкость перемещается за счёт вращения двух сцепленных шестерён — конструкция простая, недорогая и устойчивая к постоянным нагрузкам, поэтому хорошо подходит для большинства самосвалов и другой техники со средним рабочим давлением.",
    },
    {
      slug: "axial-piston-pumps",
      name: "Аксиально поршневые насосы",
      image: "/category-hydraulic-pumps/2-axial-piston-pumps.jpg",
      intro:
        "Аксиально-поршневой насос устроен сложнее шестерённого, но выдерживает более высокое рабочее давление и обеспечивает точную, регулируемую подачу жидкости. Поршни расположены параллельно оси вращения блока цилиндров — такая конструкция хорошо переносит интенсивные и переменные нагрузки.",
    },
    {
      slug: "inline-piston-pumps",
      name: "Прямые поршневые насосы",
      image: "/category-hydraulic-pumps/3-inline-piston-pumps.jpg",
      intro:
        "Прямой поршневой насос — конструкция с поршнями, расположенными вдоль оси вращения. Обеспечивает стабильную подачу жидкости при высоком давлении и применяется там, где важны надёжность и длительный срок службы при интенсивной работе.",
    },
  ],
  tanks: [
    {
      slug: "side-tanks",
      name: "Боковые",
      image: "/categoty-hydro-tanks/1-side-tanks.jpg",
      intro:
        "Боковой гидравлический бак крепится сбоку рамы тягача или прицепа и не занимает место за кабиной. Такое расположение удобно для техники, где пространство за кабиной уже занято другим оборудованием.",
    },
    {
      slug: "behind-cab-tanks",
      name: "За кабину",
      image: "/categoty-hydro-tanks/2-behind-cab-tanks.jpg",
      intro:
        "Гидравлический бак за кабиной устанавливается в пространстве между кабиной и рамой. Это стандартное решение для большинства тягачей и самосвалов, где сбоку рамы недостаточно свободного места.",
    },
  ],
};
