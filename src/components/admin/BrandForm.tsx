"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { createBrand, updateBrand, deleteBrand, replaceBrandLogo } from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { describeBrandUsage } from "@/lib/admin/usage-descriptions";
import { slugify } from "@/lib/admin/slugify";
import { compressFileInput } from "@/lib/admin/compress-image";
import { useImageReplace } from "@/lib/admin/use-image-replace";
import { MAX_VISUAL_SCALE, MIN_VISUAL_SCALE, VISUAL_SCALE_STEP } from "@/lib/admin/visual-scale";
import { BackLink } from "@/components/admin/ui/BackLink";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
import { FormSection } from "@/components/admin/ui/FormSection";
import { StickyFormActions } from "@/components/admin/ui/StickyFormActions";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import type { AdminBrand } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface BrandFormProps {
  mode: "create" | "edit";
  brand?: AdminBrand;
}

export function BrandForm({ mode, brand }: BrandFormProps) {
  const [name, setName] = useState(brand?.name ?? "");
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logo, setLogo] = useState(brand?.logo ?? "");
  const [scale, setScale] = useState(brand?.logoScale === undefined ? "" : String(brand.logoScale));
  const [dismissedError, setDismissedError] = useState<FormActionState>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { isUploading: isUploadingLogo, handleReplace: handleLogoReplace } = useImageReplace(
    (formData) => replaceBrandLogo(brand!.slug, formData),
    setLogo,
    "Логотип бренда обновлён",
  );

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function confirmDeleteBrand() {
    if (!brand) return;
    setIsDeleteDialogOpen(false);
    deleteBrand(brand.slug);
  }

  const boundAction = mode === "create" ? createBrand : updateBrand.bind(null, brand!.slug);
  const [formState, formAction] = useActionState(boundAction, null);
  const actionError = formState !== dismissedError ? (formState?.error ?? null) : null;

  const scaleNumber = Number(scale);
  const previewScale = scale.trim() && Number.isFinite(scaleNumber) && scaleNumber > 0 ? scaleNumber : 1;
  const [pickedLogo, setPickedLogo] = useState<string | null>(null);
  const shownLogo = pickedLogo ?? (mode === "edit" ? logo : null);

  return (
    <div className="pb-4">
      <BackLink href="/admin/brands" label="Бренды" />

      <form action={formAction} className="mt-3">
        <AdminPageHeader
          title={mode === "create" ? "Новый бренд" : (brand?.name ?? "Бренд")}
          description={mode === "create" ? "Название, страна и логотип. Адрес подставится сам." : brand?.country}
        />

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-stretch">
          <FormSection id="brand-data" title="О бренде" className="xl:flex-1">
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
              <FormField label="Название" htmlFor="name" required className="sm:col-span-2">
                <Input
                  id="name"
                  name="name"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="font-medium sm:h-11 sm:text-[15px]"
                />
              </FormField>

              {mode === "create" ? (
                <FormField
                  label="Адрес (slug)"
                  htmlFor="slug"
                  description="Заполняется из названия, можно изменить. Латиница, цифры и дефисы."
                >
                  <Input
                    id="slug"
                    name="slug"
                    value={slug}
                    spellCheck={false}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugTouched(true);
                    }}
                  />
                </FormField>
              ) : (
                <FormField label="Адрес (slug)" htmlFor="slug-display" description="Не меняется: на этот адрес ведут ссылки.">
                  <Input id="slug-display" value={brand?.slug ?? ""} disabled />
                </FormField>
              )}

              <FormField label="Страна" htmlFor="country" required>
                <Input id="country" name="country" required defaultValue={brand?.country} />
              </FormField>
            </div>
          </FormSection>

          <FormSection id="brand-logo" title="Логотип" description="Так он выглядит на сайте. Масштаб меняет размер логотипа в плитке." className="xl:flex-1">
            <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded-[14px] bg-logo-plate">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host)
                <img
                  src={shownLogo}
                  alt={brand?.name ? `Логотип ${brand.name}` : "Выбранный логотип"}
                  className="max-h-[70%] max-w-[70%] object-contain transition-[scale] duration-base ease-ui"
                  style={{ scale: previewScale }}
                />
              ) : (
                <span className="flex flex-col items-center gap-2 text-sm text-logo-plate-foreground">
                  <ImagePlus aria-hidden="true" className="size-6" />
                  Логотип появится здесь
                </span>
              )}
            </div>

            <FormField
              label="Масштаб логотипа"
              htmlFor="logoScale"
              description="Необязательно. Поправка, если у SVG много пустых полей."
            >
              <Input
                id="logoScale"
                name="logoScale"
                type="number"
                step={VISUAL_SCALE_STEP}
                min={MIN_VISUAL_SCALE}
                max={MAX_VISUAL_SCALE}
                value={scale}
                placeholder="1"
                onChange={(e) => setScale(e.target.value)}
                className="tabular-nums"
              />
            </FormField>

            {mode === "create" ? (
              <div>
                <label htmlFor="logo" className="block text-[13px] font-medium text-foreground">
                  Файл логотипа <span className="text-danger" aria-hidden="true">*</span>
                </label>
                <input
                  id="logo"
                  type="file"
                  name="logo"
                  accept="image/*"
                  required
                  className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:h-10 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-accent-strong file:px-4 file:text-[13px] file:font-semibold file:text-accent-foreground"
                  onChange={(e) => {
                    const input = e.target;
                    const file = input.files?.[0];
                    setPickedLogo(file ? URL.createObjectURL(file) : null);
                    void compressFileInput(input);
                  }}
                />
              </div>
            ) : (
              <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-input px-4 py-3 text-sm font-semibold text-foreground transition-[border-color,background-color,color] duration-fast ease-ui hover:border-primary hover:bg-accent hover:text-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30">
                {isUploadingLogo ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ImagePlus aria-hidden="true" className="size-4" />}
                {isUploadingLogo ? "Загрузка…" : "Заменить логотип"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleLogoReplace}
                  disabled={isUploadingLogo}
                />
              </label>
            )}
          </FormSection>
        </div>

        <StickyFormActions>
          {mode === "edit" && (
            <button
              type="button"
              onClick={() => setIsDeleteDialogOpen(true)}
              className={buttonClassName({ variant: "ghost", className: "text-danger hover:bg-danger-surface hover:text-danger" })}
            >
              <Trash2 aria-hidden="true" />
              <span className="max-sm:sr-only">Удалить бренд</span>
            </button>
          )}
          <Link href="/admin/brands" className={buttonClassName({ variant: "glass", className: "ml-auto max-sm:hidden" })}>
            Отмена
          </Link>
          <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"} className="max-sm:ml-auto max-sm:flex-1">
            {mode === "create" ? "Создать бренд" : "Сохранить"}
          </SubmitButton>
        </StickyFormActions>
      </form>
      <AdminActionFeedback message={actionError} onDismiss={() => setDismissedError(formState)} />
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Удалить бренд «${brand?.name}»?`}
        description={brand ? `${describeBrandUsage(brand)} Это действие необратимо.` : null}
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteBrand}
      />
    </div>
  );
}
