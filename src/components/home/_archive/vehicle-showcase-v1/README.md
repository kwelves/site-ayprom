# Vehicle showcase v1 (archived 2026-07-30)

Прежняя реализация секции "Спецтехника" — статичная сетка карточек (`VehicleShowcaseSection` + `VehicleShowcaseCard` + `VehicleShowcaseBackground`) с ручной per-vehicle геометрией placement/shadows. Убрана с главной, чтобы реализовать интерактивную версию с нуля (hotspot-точки, привязанные к товарам).

Не импортируется нигде в проекте — безопасно удалить полностью, если восстановление не понадобится.

## Как вернуть

1. Перенести три `.tsx`-файла обратно в `src/components/home/`.
2. В `src/app/(site)/page.tsx` вернуть `import { VehicleShowcaseSection } from "@/components/home/VehicleShowcaseSection";` и `<VehicleShowcaseSection />` между `<CategorySection />` и `<BrandSection />`.
