import { Select } from "@/components/admin/ui/Select";
import { cn } from "@/lib/utils";
import type { ProductPhotoMode } from "@/lib/admin/product-photo-mode";

interface ProductPhotoModeOption {
  value: ProductPhotoMode;
  label: string;
  description: string;
  toneClassName: string;
}

const OPTIONS: ProductPhotoModeOption[] = [
  {
    value: "normal",
    label: "Обычная загрузка",
    description: "Как сейчас: фото сжимается в браузере и сохраняется как есть.",
    toneClassName: "border-input bg-background text-foreground",
  },
  {
    value: "webp",
    label: "Обычная + WebP",
    description: "То же сжатие, но результат сохраняется в формате WebP вместо JPEG.",
    toneClassName: "border-success-border bg-success-surface text-success",
  },
  {
    value: "script",
    label: "Через скрипт обработки",
    description:
      "Сервер обрезает фото по границам детали, выравнивает свет и накладывает водяной знак — как enhance-product-photos.mjs.",
    toneClassName: "border-warning-border bg-warning-surface text-warning",
  },
  {
    value: "script-webp",
    label: "Скрипт + WebP",
    description: "Та же обработка, но итоговый файл сохраняется в WebP.",
    toneClassName: "border-border-accent bg-accent text-accent-foreground",
  },
];

interface ProductPhotoModeSelectProps {
  value: ProductPhotoMode;
  onChange: (mode: ProductPhotoMode) => void;
}

/** Colored mode picker for the product create form's photo pipeline — see
 * ProductForm.tsx for how the choice is persisted and acted on. */
export function ProductPhotoModeSelect({ value, onChange }: ProductPhotoModeSelectProps) {
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  return (
    <div>
      <label htmlFor="photoMode" className="block text-sm font-medium text-foreground">
        Режим добавления фото
      </label>
      <Select
        id="photoMode"
        value={value}
        onChange={(event) => onChange(event.target.value as ProductPhotoMode)}
        className={cn("mt-1.5 font-medium", selected.toneClassName)}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <p className="mt-1.5 text-xs text-muted-foreground">{selected.description}</p>
    </div>
  );
}
