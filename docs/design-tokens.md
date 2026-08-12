# Дизайн-токены

Цвет в приложении задаётся **только** семантическими токенами. Прямые палитровые
классы Tailwind (`bg-blue-600`, `text-slate-600`), утилиты `-white`/`-black` и
захардкоженные значения (`bg-[#084bb9]`) запрещены и отклоняются проверкой
`npm run check:colors` — она входит в `npm run check`, а значит и в CI.

Токены объявлены в одном месте: `src/app/globals.css`, блок `@theme inline`.
Tailwind v4 генерирует из них обычные утилиты (`bg-primary`, `text-danger`,
`border-input`), включая модификаторы прозрачности (`bg-inverse/90`).

## Текст на светлом фоне

| Класс | Значение | Когда использовать |
|---|---|---|
| `text-foreground` | slate-900 | заголовки, основной текст |
| `text-muted-foreground` | slate-600 | вторичный текст: описания, подписи, хлебные крошки |
| `text-faint-foreground` | slate-400 | плейсхолдеры, декоративные иконки, drag-handle |

## Светлые поверхности

| Класс | Значение | Когда использовать |
|---|---|---|
| `bg-background` | #ffffff | фон страницы |
| `bg-card` / `text-card-foreground` | white / slate-900 | карточки, выпадающие панели |
| `bg-secondary` / `text-secondary-foreground` | white / slate-900 | вторичная кнопка |
| `bg-muted` | slate-50 | мягкая заливка, hover вторичной кнопки |
| `bg-surface-subtle` | slate-100 | нейтральные плашки, светлые части скелетона |
| `bg-surface-strong` | slate-200 | основные блоки скелетона |

## Основное действие

| Класс | Значение | Когда использовать |
|---|---|---|
| `bg-primary` / `text-primary-foreground` | blue-600 / white | основная кнопка, активный элемент |
| `text-primary` | blue-600 | ссылка, активный пункт навигации |
| `hover:bg-primary-hover` | blue-700 | hover основной кнопки |
| `hover:bg-primary-soft` | blue-300 | hover мелких индикаторов (точки галереи) |
| `bg-brand` | blue-600 | фирменные плашки под логотип |

## Акцент — мягкие синие заливки

| Класс | Значение | Когда использовать |
|---|---|---|
| `bg-accent` | blue-50 | подсветка блока, hover строки списка |
| `bg-accent-strong` | blue-100 | заливка бейджа |
| `text-accent-foreground` | blue-600 | текст и иконки на `accent` |

## Линии

| Класс | Значение | Когда использовать |
|---|---|---|
| `border-border` | slate-200 | обычная рамка, разделитель |
| `border-input` | slate-300 | рамка поля ввода и контрола |
| `border-border-accent` | blue-100 | рамки и разделители внутри акцентных блоков |
| `hover:border-border-interactive` | blue-200 | hover-рамка кликабельной карточки или строки |
| `ring-ring` | blue-500 | кольцо фокуса, `focus-within` |

## Тёмные («инверсные») поверхности

Подвал, оверлей на фотографии в Hero, `SectionHeading tone="inverse"`.

| Класс | Значение | Когда использовать |
|---|---|---|
| `bg-inverse` | slate-900 | тёмная подложка, градиенты (`from-inverse/90`) |
| `text-inverse-foreground` | white | заголовки и активный текст на тёмном |
| `text-inverse-foreground-muted` | slate-300 | основной текст на тёмном |
| `text-inverse-foreground-subtle` | slate-400 | подписи и разделители на тёмном |
| `border-inverse-border` | slate-800 | разделители на тёмном |
| `text-inverse-accent` | blue-400 | ссылки и иконки на тёмном |

Обычные `text-muted-foreground` и `text-faint-foreground` на тёмном фоне
использовать нельзя — они рассчитаны на белый фон и не дают контраста.

## Статусы

Один и тот же шаблон из четырёх слотов: текст, заливка, заливка при наведении, рамка.

| Статус | Текст | Заливка | Заливка hover | Рамка |
|---|---|---|---|---|
| Ошибка, удаление | `text-danger` (red-600) | `bg-danger-surface` (red-50) | `hover:bg-danger-surface-hover` (red-100) | `border-danger-border` (red-200) |
| Успех, «опубликован» | `text-success` (green-700) | `bg-success-surface` (green-100) | `hover:bg-success-surface-hover` (green-200) | `border-success-border` (green-200) |
| Предупреждение, «черновик» | `text-warning` (amber-700) | `bg-warning-surface` (amber-100) | `hover:bg-warning-surface-hover` (amber-200) | `border-warning-border` (amber-200) |

## Если нужного цвета нет

Не пишите прямой класс — добавьте токен.

1. Проверьте, что задача не решается существующим токеном: почти всё покрывается
   парами «поверхность + текст на ней».
2. Добавьте переменную в `@theme inline` в `src/app/globals.css`, ссылаясь на
   палитру Tailwind (`--color-новый: var(--color-slate-700)`), и назовите её по
   роли, а не по цвету: `input`, `danger-surface`, а не `gray-line`, `red-bg`.
3. Добавьте строку в таблицу выше.
4. По желанию добавьте подсказку «на что менять» в `SUGGESTIONS` в
   `scripts/check-color-tokens.mjs` — она выводится в сообщении об ошибке.

## Исключения из проверки

Список в `scripts/check-color-tokens.mjs` (константа `ALLOWLIST`), каждое — с причиной:

- `src/app/globals.css` — здесь палитра и токены определяются;
- `src/components/home/vehicle-showcase/**` и `VehicleShowcaseSection.tsx` —
  декоративная 3D-сцена: оттенки свечения подобраны под сцену, а не под палитру интерфейса;
- `src/components/home/_archive/**` — архив прошлой версии витрины.

Кроме того, проверка не считает нарушением `rgba` внутри `shadow-[…]` и
`drop-shadow-[…]`: это параметр эффекта, а не цвет палитры.

Список исключений не должен расти без обсуждения.
