import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import type { AdminProduct } from "@/lib/admin/queries";

interface ProductFormSeoSectionProps {
  product?: AdminProduct;
}

// Minimal scope (PROJECT_BRIEF): meta title + meta description only, no
// OG image (reuses the product's cover photo) or canonical override.
export function ProductFormSeoSection({ product }: ProductFormSeoSectionProps) {
  return (
    <>
      <FormField
        label="Meta title"
        htmlFor="metaTitle"
        description="Необязательно. Если пусто, поисковики используют название товара."
      >
        <Input id="metaTitle" name="metaTitle" defaultValue={product?.metaTitle} maxLength={70} />
      </FormField>

      <FormField
        label="Meta description"
        htmlFor="metaDescription"
        description="Необязательно. Если пусто, поисковики используют краткое описание."
      >
        <Textarea id="metaDescription" name="metaDescription" rows={2} maxLength={160} defaultValue={product?.metaDescription} />
      </FormField>
    </>
  );
}
