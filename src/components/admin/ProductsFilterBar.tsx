"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";

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

  function navigate(nextQ: string, nextCategory: string) {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextCategory) params.set("category", nextCategory);
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
    const timeout = setTimeout(() => navigate(q, searchParams.get("category") ?? ""), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on q changes; category changes navigate immediately via handleCategoryChange
  }, [q]);

  function handleCategoryChange(nextCategory: string) {
    navigate(q, nextCategory);
  }

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по названию или артикулу..."
        className="sm:max-w-xs"
      />
      <Select
        defaultValue={searchParams.get("category") ?? ""}
        onChange={(e) => handleCategoryChange(e.target.value)}
        className="sm:max-w-xs"
      >
        <option value="">Все категории</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
