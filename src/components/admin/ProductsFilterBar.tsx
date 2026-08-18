"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import { PRODUCT_AVAILABILITY_LABELS, PRODUCT_AVAILABILITY_OPTIONS } from "@/lib/admin/product-availability";

interface ProductsFilterBarProps {
  categories: { slug: string; name: string }[];
}

export function ProductsFilterBar({ categories }: ProductsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [, startTransition] = useTransition();
  const skipNextSync = useRef(true);

  function navigate(next: { q?: string; category?: string; sort?: string; status?: string; availability?: string }) {
    const params = new URLSearchParams();
    const q = next.q ?? searchParams.get("q") ?? "";
    const category = next.category ?? searchParams.get("category") ?? "";
    const sort = next.sort ?? searchParams.get("sort") ?? "";
    const status = next.status ?? searchParams.get("status") ?? "";
    const availability = next.availability ?? searchParams.get("availability") ?? "";
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (sort && sort !== "order") params.set("sort", sort);
    if (status) params.set("status", status);
    if (availability) params.set("availability", availability);
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    const timeout = setTimeout(() => navigate({ q }), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on q changes; the other filters navigate immediately via their own onChange
  }, [q]);

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Input
        type="search"
        name="q"
        aria-label="Поиск товаров"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по названию или артикулу…"
        className="sm:max-w-xs"
      />
      <Select
        name="category"
        aria-label="Фильтр по категории"
        defaultValue={searchParams.get("category") ?? ""}
        onChange={(e) => navigate({ category: e.target.value })}
        className="sm:max-w-[12rem]"
      >
        <option value="">Все категории</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.name}
          </option>
        ))}
      </Select>
      <Select
        name="status"
        aria-label="Фильтр по публикации"
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => navigate({ status: e.target.value })}
        className="sm:max-w-[10rem]"
      >
        <option value="">Любая публикация</option>
        <option value="published">Опубликован</option>
        <option value="draft">Черновик</option>
      </Select>
      <Select
        name="availability"
        aria-label="Фильтр по наличию"
        defaultValue={searchParams.get("availability") ?? ""}
        onChange={(e) => navigate({ availability: e.target.value })}
        className="sm:max-w-[10rem]"
      >
        <option value="">Любое наличие</option>
        {PRODUCT_AVAILABILITY_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {PRODUCT_AVAILABILITY_LABELS[value]}
          </option>
        ))}
      </Select>
      <Select
        name="sort"
        aria-label="Сортировка"
        defaultValue={searchParams.get("sort") ?? "order"}
        onChange={(e) => navigate({ sort: e.target.value })}
        className="sm:max-w-[10rem]"
      >
        <option value="order">Ручной порядок</option>
        <option value="name">По названию</option>
        <option value="updated">Сначала изменённые</option>
      </Select>
    </div>
  );
}
