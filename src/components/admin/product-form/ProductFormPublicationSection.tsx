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
  mode: "create" | "edit";
  published: boolean;
  onPublishedChange: (value: boolean) => void;
  hotspotCount: number;
  availability: ProductAvailability;
  onAvailabilityChange: (value: ProductAvailability) => void;
}

// Whether visitors see the product, and what the site says about stock. Both change often, so they sit at the top
// of the side column, one tap away.
export function ProductFormPublicationSection({
  mode,
  published,
  onPublishedChange,
  hotspotCount,
  availability,
  onAvailabilityChange,
}: ProductFormPublicationSectionProps) {
  return (
    <>
      <div>
        <Switch
          id="published"
          name="published"
          label="Опубликован (виден на сайте)"
          description={published ? "Товар есть в каталоге и в поиске сайта." : "Черновик: на сайте товара нет."}
          checked={published}
          onChange={(event) => onPublishedChange(event.target.checked)}
        />
        {mode === "edit" && !published && hotspotCount > 0 && (
          <p role="status" className="mt-3 animate-fade-up rounded-[12px] border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
            Снятие с публикации отвяжет товар от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника».
          </p>
        )}
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
