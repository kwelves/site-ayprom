"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, ImagePlus, Layers, Loader2, Package, Tags, Trash2 } from "lucide-react";
import { createCategory, updateCategory, deleteCategory, replaceCategoryImage } from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/usage-descriptions";
import { formatRussianCount } from "@/lib/russian-plural";
import { slugify } from "@/lib/admin/slugify";
import { compressFileInput } from "@/lib/admin/compress-image";
import { useImageReplace } from "@/lib/admin/use-image-replace";
import { BackLink } from "@/components/admin/ui/BackLink";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
import { FormSection } from "@/components/admin/ui/FormSection";
import { StickyFormActions } from "@/components/admin/ui/StickyFormActions";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import { Select } from "@/components/admin/ui/Select";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import type { AdminCategory } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface CategoryFormProps {
  mode: "create" | "edit";
  category?: AdminCategory;
}

export function CategoryForm({ mode, category }: CategoryFormProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [image, setImage] = useState(category?.image ?? "");
  const [dismissedError, setDismissedError] = useState<FormActionState>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { isUploading: isUploadingImage, handleReplace: handleImageReplace } = useImageReplace(
    (formData) => replaceCategoryImage(category!.slug, formData),
    setImage,
    "Изображение категории обновлено",
  );

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleDeleteCategory() {
    if (!category) return;
    if (category.productCount > 0) {
      alert(
        `Нельзя удалить «${category.name}»: в категории ${formatRussianCount(category.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    setIsDeleteDialogOpen(true);
  }

  function confirmDeleteCategory() {
    if (!category) return;
    setIsDeleteDialogOpen(false);
    deleteCategory(category.slug);
  }

  const boundAction = mode === "create" ? createCategory : updateCategory.bind(null, category!.slug);
  const [formState, formAction] = useActionState(boundAction, null);
  const actionError = formState !== dismissedError ? (formState?.error ?? null) : null;

  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const shownImage = pickedImage ?? (mode === "edit" && image ? image : null);
  const typeLabel = category?.type === "brand" ? "По брендам" : category?.type === "subcategory" ? "По подкатегориям" : "Напрямую";

  // Save and delete live in the side column and stay in view while the long form scrolls; below xl, where the
  // columns stack, the same actions float at the bottom of the screen instead.
  const actions = (
    <>
      <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"} size="lg" className="flex-1">
        {mode === "create" ? "Создать категорию" : "Сохранить"}
      </SubmitButton>
      <Link href="/admin/categories" className={buttonClassName({ variant: "glass", size: "lg" })}>
        Отмена
      </Link>
      {mode === "edit" && (
        <button
          type="button"
          onClick={handleDeleteCategory}
          aria-label="Удалить категорию"
          title="Удалить категорию"
          className={buttonClassName({ variant: "ghost", size: "icon", className: "size-11 text-danger hover:bg-danger-surface hover:text-danger" })}
        >
          <Trash2 aria-hidden="true" />
        </button>
      )}
    </>
  );

  return (
    <div className="pb-4">
      <BackLink href="/admin/categories" label="Категории" />

      <form action={formAction} className="mt-3">
        <AdminPageHeader
          title={mode === "create" ? "Новая категория" : (category?.name ?? "Категория")}
          description={mode === "create" ? "Название, тип, описание и картинка. Адрес подставится сам." : `${typeLabel} · ${formatRussianCount(category?.productCount ?? 0, ["товар", "товара", "товаров"])}`}
        />

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] xl:items-start">
          <FormSection id="category-data" title="О категории">
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
                  description="Заполняется из названия, можно изменить."
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
                  <Input id="slug-display" value={category?.slug ?? ""} disabled />
                </FormField>
              )}

              {mode === "create" ? (
                <FormField
                  label="Тип категории"
                  htmlFor="type"
                  required
                  description="После создания тип не меняется: от него зависит страница категории."
                >
                  <Select id="type" name="type" required defaultValue="">
                    <option value="" disabled>
                      Выберите тип
                    </option>
                    <option value="subcategory">По подкатегориям</option>
                    <option value="brand">По брендам</option>
                    <option value="direct">Напрямую (без группировки)</option>
                  </Select>
                </FormField>
              ) : (
                <FormField label="Тип категории" htmlFor="type-display" description="Не меняется: от него зависит устройство страницы категории.">
                  <Input id="type-display" value={typeLabel} disabled />
                </FormField>
              )}

              {mode === "create" && (
                <p className="rounded-[12px] bg-info-surface px-3 py-2.5 text-[13px] leading-snug text-info sm:col-span-2">
                  «По подкатегориям»: товары делятся на подразделы, как гидронасосы. «По брендам»: товары сразу по маркам техники,
                  как КОМ и ВОМ. «Напрямую»: без группировки, одним списком.
                </p>
              )}

              <FormField
                label="Описание для меню и SEO"
                htmlFor="description"
                className="sm:col-span-2"
                description="Необязательно. Если оставить пустым, дополнительный текст в меню и SEO-описание не выводятся."
              >
                <Textarea id="description" name="description" rows={2} defaultValue={category?.description} />
              </FormField>

              <FormField
                label="Вступление"
                htmlFor="intro"
                className="sm:col-span-2"
                description="Необязательно. Короткий текст над товарами на странице категории, чаще всего для категорий «по брендам»."
              >
                <Textarea id="intro" name="intro" rows={4} defaultValue={category?.intro} />
              </FormField>
            </div>
          </FormSection>

          <div className="flex flex-col gap-5 xl:sticky xl:top-3">
            <FormSection id="category-image" title="Изображение" description="Плитка категории на сайте.">
              <div className="relative grid aspect-[16/10] place-items-center overflow-hidden rounded-[14px] bg-surface-subtle [@media(max-height:760px)]:aspect-[16/7]">
                {shownImage ? (
                  <Image
                    src={shownImage}
                    alt=""
                    fill
                    sizes="400px"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <ImagePlus aria-hidden="true" className="size-6" />
                    Изображение появится здесь
                  </span>
                )}
              </div>
              {mode === "create" ? (
                <div>
                  <label htmlFor="image" className="block text-[13px] font-medium text-foreground">
                    Файл изображения <span className="text-danger" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="image"
                    type="file"
                    name="image"
                    accept="image/*"
                    required
                    className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:h-10 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-accent-strong file:px-4 file:text-[13px] file:font-semibold file:text-accent-foreground"
                    onChange={(e) => {
                      const input = e.target;
                      const file = input.files?.[0];
                      setPickedImage(file ? URL.createObjectURL(file) : null);
                      void compressFileInput(input);
                    }}
                  />
                </div>
              ) : (
                <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-input px-4 py-3 text-sm font-semibold text-foreground transition-[border-color,background-color,color] duration-fast ease-ui hover:border-primary hover:bg-accent hover:text-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30">
                  {isUploadingImage ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ImagePlus aria-hidden="true" className="size-4" />}
                  {isUploadingImage ? "Загрузка…" : "Заменить изображение"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleImageReplace}
                    disabled={isUploadingImage}
                  />
                </label>
              )}
            </FormSection>

            {mode === "edit" && category && category.type !== null && (
              <FormSection id="category-links" title="Что внутри">
                <div className="-my-1 flex flex-col gap-1.5">
                  <Link
                    href={category.type === "brand" ? `/admin/categories/${category.slug}/category-brands` : `/admin/categories/${category.slug}/subcategories`}
                    className="glass-plate group/link flex min-h-12 items-center gap-3 rounded-[12px] px-3 transition-colors duration-fast ease-ui hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-strong text-accent-foreground">
                      {category.type === "brand" ? <Tags className="size-4" /> : <Layers className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {category.type === "brand" ? "Бренды категории" : "Подкатегории"}
                      </span>
                      {category.type === "subcategory" && (
                        <span className="block text-xs text-muted-foreground">
                          Без подкатегории: {formatRussianCount(category.directProductCount, ["товар", "товара", "товаров"])}
                        </span>
                      )}
                    </span>
                    <span className="rounded-full bg-neutral-surface px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                      {category.type === "brand" ? category.categoryBrandCount : category.subcategoryCount}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-[translate] duration-fast ease-ui group-hover/link:translate-x-0.5" />
                  </Link>
                  <Link
                    href={`/admin/products?category=${encodeURIComponent(category.slug)}`}
                    className="glass-plate group/link flex min-h-12 items-center gap-3 rounded-[12px] px-3 transition-colors duration-fast ease-ui hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-strong text-accent-foreground">
                      <Package className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">Товары категории</span>
                    <span className="rounded-full bg-neutral-surface px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                      {category.productCount}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-[translate] duration-fast ease-ui group-hover/link:translate-x-0.5" />
                  </Link>
                </div>
              </FormSection>
            )}

            <div className="glass-panel hidden items-center gap-2 rounded-[18px] p-3 xl:flex">{actions}</div>
          </div>
        </div>

        <StickyFormActions className="xl:hidden">{actions}</StickyFormActions>
      </form>
      <AdminActionFeedback message={actionError} onDismiss={() => setDismissedError(formState)} />
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Удалить категорию «${category?.name}»?`}
        description={category ? `${describeCategoryUsage(category)} Это действие необратимо.` : null}
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteCategory}
      />
    </div>
  );
}
