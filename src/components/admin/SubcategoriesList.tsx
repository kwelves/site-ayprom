"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { reorderSubcategories, deleteSubcategory } from "@/lib/admin/actions";
import type { AdminSubcategory } from "@/lib/admin/queries";

export function SubcategoriesList({
  categorySlug,
  subcategories: initialSubcategories,
}: {
  categorySlug: string;
  subcategories: AdminSubcategory[];
}) {
  const [subcategories, setSubcategories] = useState(initialSubcategories);
  const [, startTransition] = useTransition();

  function handleReorder(newSubcategories: AdminSubcategory[]) {
    setSubcategories(newSubcategories);
    startTransition(() => {
      reorderSubcategories(categorySlug, newSubcategories.map((sub) => sub.id));
    });
  }

  function handleDelete(subcategory: AdminSubcategory) {
    if (subcategory.productCount > 0) {
      alert(
        `Нельзя удалить «${subcategory.name}» — в ней ${subcategory.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить подкатегорию «${subcategory.name}»? Это действие необратимо.`)) return;

    setSubcategories((prev) => prev.filter((s) => s.id !== subcategory.id));
    startTransition(() => {
      deleteSubcategory(subcategory.id);
    });
  }

  return (
    <SortableList
      className="mt-6"
      items={subcategories}
      getId={(sub) => sub.id}
      onReorder={handleReorder}
      renderItem={(sub) => (
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- possibly hosted on Supabase Storage (external host) */}
            <img src={sub.image} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-card-foreground">{sub.name}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{sub.productCount} тов.</span>
          <Link
            href={`/admin/categories/${categorySlug}/subcategories/${sub.slug}/edit`}
            className="shrink-0 text-sm text-primary hover:underline"
          >
            Редактировать
          </Link>
          <button
            type="button"
            onClick={() => handleDelete(sub)}
            className="shrink-0 text-sm text-red-600 hover:underline"
          >
            Удалить
          </button>
        </div>
      )}
    />
  );
}
