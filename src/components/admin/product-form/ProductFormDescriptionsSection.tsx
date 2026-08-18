import { FormField } from "@/components/admin/ui/FormField";
import { Textarea } from "@/components/admin/ui/Textarea";
import type { AdminProduct } from "@/lib/admin/queries";

interface ProductFormDescriptionsSectionProps {
  product?: AdminProduct;
}

// Both fields are uncontrolled (defaultValue) — they're only read at submit
// time, same as article/SEO, so no lifted state needed in the orchestrator.
export function ProductFormDescriptionsSection({ product }: ProductFormDescriptionsSectionProps) {
  return (
    <>
      <FormField
        label="Краткое описание"
        htmlFor="shortDescription"
        description="Необязательно. Показывается в карточке товара."
      >
        <Textarea id="shortDescription" name="shortDescription" rows={2} defaultValue={product?.shortDescription} />
      </FormField>

      <FormField label="Полное описание" htmlFor="description">
        <Textarea id="description" name="description" rows={5} defaultValue={product?.description} />
      </FormField>
    </>
  );
}
