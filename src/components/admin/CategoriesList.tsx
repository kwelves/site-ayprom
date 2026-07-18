"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SortableList } from "@/components/admin/SortableList";
import { reorderCategories, deleteCategory } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/queries";
import { cn } from "@/lib/utils";
import type { AdminCategory } from "@/lib/admin/queries";

export function CategoriesList({ categories: initialCategories }: { categories: AdminCategory[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [, startTransition] = useTransition();

  function handleReorder(newCategories: AdminCategory[]) {
    setCategories(newCategories);
    startTransition(() => {
      reorderCategories(newCategories.map((category) => category.slug));
    });
  }

  function handleDelete(category: AdminCategory) {
    if (category.productCount > 0) {
      alert(
        `Нельзя удалить «${category.name}» — в категории ${category.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить категорию «${category.name}»?${describeCategoryUsage(category)} Это действие необратимо.`)) {
      return;
    }

    setCategories((prev) => prev.filter((c) => c.slug !== category.slug));
    startTransition(() => {
      deleteCategory(category.slug);
    });
  }

  return (
    <SortableList
      className="mt-6"
      items={categories}
      getId={(category) => category.slug}
      onReorder={handleReorder}
      renderItem={(category) => (
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- possibly hosted on Supabase Storage (external host) */}
            <img src={category.image} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-card-foreground">{category.name}</p>
            <p className="text-xs text-muted-foreground">{category.description}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              category.type === "brand" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
            )}
          >
            {category.type === "brand" ? "По брендам" : "По подкатегориям"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{category.productCount} тов.</span>
          <Link href={`/admin/categories/${category.slug}/edit`} className="shrink-0 text-sm text-primary hover:underline">
            Редактировать
          </Link>
          <button
            type="button"
            onClick={() => handleDelete(category)}
            className="shrink-0 text-sm text-red-600 hover:underline"
          >
            Удалить
          </button>
        </div>
      )}
    />
  );
}
