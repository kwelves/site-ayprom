# Category section v1 (archived 2026-08-15)

Прежняя реализация секции "Каталог по типу оборудования" на главной — сетка
`CategoryCard` (фото + подпись, hover через `-translate-y-1`/`scale`/смену
цвета рамки). Убрана с главной, чтобы пересобрать карточки по компоненту
["Hover Effect"](https://21st.dev/@serafimcloud/components/hover-effect) —
подсветка, "гуляющая" между наведёнными карточками (framer-motion
`layoutId`), вместо индивидуального подъёма/скейла на каждой.

`CategoryCard.tsx` **не архивирован** — он общий и всё ещё используется на
страницах каталога (`/catalog/category/[slug]`, `/catalog/brand/[slug]`,
`/catalog/brand/[slug]/category/[categorySlug]`). Новая версия для главной
живёт в отдельном компоненте `CategoryHoverGrid.tsx`, чтобы не задевать эти
страницы.

Не импортируется нигде в проекте — безопасно удалить полностью, если
восстановление не понадобится.

## Как вернуть

1. Перенести `CategorySection.tsx` обратно в `src/components/home/`
   (перезаписав новую версию).
2. Убедиться, что импорт `CategoryCard` в нём снова указывает на
   `@/components/home/CategoryCard` (общий компонент, он не менялся).
3. Если `CategoryHoverGrid.tsx` больше не нужен — удалить его.
