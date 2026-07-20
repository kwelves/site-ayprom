"use client";

import { useState } from "react";
import { createBrand, updateBrand, deleteBrand, replaceBrandLogo } from "@/lib/admin/actions";
import { describeBrandUsage } from "@/lib/admin/queries";
import { slugify } from "@/lib/admin/slugify";
import { compressImage, compressFileInput } from "@/lib/admin/compress-image";
import { BackLink } from "@/components/admin/ui/BackLink";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import type { AdminBrand } from "@/lib/admin/queries";

interface BrandFormProps {
  mode: "create" | "edit";
  brand?: AdminBrand;
}

export function BrandForm({ mode, brand }: BrandFormProps) {
  const [name, setName] = useState(brand?.name ?? "");
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logo, setLogo] = useState(brand?.logo ?? "");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  async function handleLogoReplace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !brand) return;

    setIsUploadingLogo(true);
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.set("file", compressed);
    const newUrl = await replaceBrandLogo(brand.slug, formData);
    if (newUrl) setLogo(newUrl);
    setIsUploadingLogo(false);
    event.target.value = "";
  }

  function handleDeleteBrand() {
    if (!brand) return;
    if (!confirm(`Удалить бренд «${brand.name}»?${describeBrandUsage(brand)} Это действие необратимо.`)) return;
    deleteBrand(brand.slug);
  }

  const action = mode === "create" ? createBrand : updateBrand.bind(null, brand!.slug);

  return (
    <div className="max-w-xl">
      <BackLink href="/admin/brands" label="Бренды" />

      <form action={action} className="mt-4 space-y-6">
        <h1 className="text-xl font-semibold text-foreground">
          {mode === "create" ? "Новый бренд" : `Редактировать: ${brand?.name}`}
        </h1>

        <FormField label="Название" htmlFor="name">
          <Input id="name" name="name" required value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </FormField>

        {mode === "create" ? (
          <FormField
            label="Адрес (slug)"
            htmlFor="slug"
            description="Заполняется автоматически из названия, можно изменить."
          >
            <Input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
            />
          </FormField>
        ) : (
          <FormField label="Адрес (slug)" htmlFor="slug-display" description="Нельзя изменить — используется в ссылках.">
            <Input id="slug-display" value={brand?.slug ?? ""} disabled />
          </FormField>
        )}

        <FormField label="Страна" htmlFor="country">
          <Input id="country" name="country" required defaultValue={brand?.country} />
        </FormField>

        <FormField
          label="Масштаб логотипа"
          htmlFor="logoScale"
          description="Необязательно — поправка масштаба, если у SVG много лишних полей."
        >
          <Input id="logoScale" name="logoScale" type="number" step="0.05" defaultValue={brand?.logoScale} />
        </FormField>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Логотип</h2>
          {mode === "edit" && logo && (
            <div className="mt-3 flex h-16 w-32 items-center justify-center rounded-md border border-border bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- brand logos are SVGs, possibly hosted on Supabase Storage (external host) */}
              <img src={logo} alt="" className="max-h-full max-w-full object-contain p-2" />
            </div>
          )}
          {mode === "create" ? (
            <div className="mt-3">
              <input
                type="file"
                name="logo"
                accept="image/*"
                required
                className="text-sm"
                onChange={(e) => {
                  const input = e.target;
                  void compressFileInput(input);
                }}
              />
            </div>
          ) : (
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-primary hover:text-primary">
              {isUploadingLogo ? "Загрузка..." : "Заменить логотип"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoReplace}
                disabled={isUploadingLogo}
              />
            </label>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border pt-6">
          <SubmitButton pendingLabel={mode === "create" ? "Создание..." : "Сохранение..."}>
            {mode === "create" ? "Создать бренд" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteBrand} className="text-sm text-red-600 hover:underline">
              Удалить бренд
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
