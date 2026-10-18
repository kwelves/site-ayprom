"use client";

import { SegmentedControl } from "@/components/admin/ui/SegmentedControl";
import { Switch } from "@/components/admin/ui/Switch";
import {
  PRODUCT_AVAILABILITY_LABELS,
  PRODUCT_AVAILABILITY_OPTIONS,
  type ProductAvailability,
} from "@/lib/admin/product-availability";

const AVAILABILITY_TONE: Record<ProductAvailability, string> = {
  in_stock: "bg-success-surface text-success",
  out_of_stock: "bg-danger-surface text-danger",
  unclear: "bg-warning-surface text-warning",
};

const AVAILABILITY_OPTIONS = PRODUCT_AVAILABILITY_OPTIONS.map((value) => ({
  value,
  label: PRODUCT_AVAILABILITY_LABELS[value],
  activeClassName: AVAILABILITY_TONE[value],
}));

interface ProductFormPublicationSectionProps {
  /** "section": the stacked block of narrow screens. "bar": one row inside the pinned action bar of a laptop. */
  variant?: "section" | "bar";
  mode: "create" | "edit";
  published: boolean;
  onPublishedChange: (value: boolean) => void;
  hotspotCount: number;
  availability: ProductAvailability;
  onAvailabilityChange: (value: ProductAvailability) => void;
}

// Whether visitors see the product, and what the site says about stock. Both change often. On a laptop they sit in
// the pinned bar next to Save, so one glance and one tap covers "publish and save"; on narrow screens they stay a
// block of the form. The form renders exactly one of the two variants, because both hold real form fields.
export function ProductFormPublicationSection({
  variant = "section",
  mode,
  published,
  onPublishedChange,
  hotspotCount,
  availability,
  onAvailabilityChange,
}: ProductFormPublicationSectionProps) {
  const bar = variant === "bar";
  const publishedHint = published ? "Товар есть в каталоге и в поиске сайта." : "Черновик: на сайте товара нет.";
  const hotspotWarning =
    mode === "edit" && !published && hotspotCount > 0 ? (
      <p
        role="status"
        className={
          bar
            ? "absolute bottom-full left-0 mb-2 max-w-[28rem] animate-fade-up rounded-[12px] border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning shadow-sm"
            : "mt-3 animate-fade-up rounded-[12px] border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning"
        }
      >
        Снятие с публикации отвяжет товар от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника».
      </p>
    ) : null;

  if (bar) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <div title={publishedHint}>
          <Switch
            id="published"
            name="published"
            label={published ? "Опубликован" : "Черновик"}
            checked={published}
            onChange={(event) => onPublishedChange(event.target.checked)}
            containerClassName="items-center [&>span:first-child]:mt-0"
          />
        </div>
        {hotspotWarning}
        <div className="flex items-center gap-2.5">
          <span id="availability-label" className="text-[13px] font-medium text-muted-foreground">
            Наличие
          </span>
          <SegmentedControl
            aria-label="Статус наличия"
            options={AVAILABILITY_OPTIONS}
            value={availability}
            onChange={onAvailabilityChange}
          />
          <input type="hidden" name="availability" value={availability} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <Switch
          id="published"
          name="published"
          label="Опубликован (виден на сайте)"
          description={publishedHint}
          checked={published}
          onChange={(event) => onPublishedChange(event.target.checked)}
        />
        {hotspotWarning}
      </div>

      <div>
        <span id="availability-label" className="block text-[13px] font-medium text-foreground">
          Наличие
        </span>
        <div className="mt-2">
          <SegmentedControl
            aria-label="Статус наличия"
            options={AVAILABILITY_OPTIONS}
            value={availability}
            onChange={onAvailabilityChange}
            stretch
            className="flex w-full"
          />
          <input type="hidden" name="availability" value={availability} />
        </div>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          Метка для покупателя. Товар остаётся в каталоге и в поиске при любом значении.
        </p>
      </div>
    </>
  );
}
