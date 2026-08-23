"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { PRODUCT_AVAILABILITY_LABELS, PRODUCT_AVAILABILITY_OPTIONS } from "@/lib/admin/product-availability";
import {
  ADMIN_PRODUCT_LIST_RESET_EVENT,
  DEFAULT_ADMIN_PRODUCT_LIST_CONFIG,
  normalizeAdminProductListCategory,
  resolveAdminProductListConfig,
  setAdminProductListConfigParams,
  type AdminProductListConfig,
  type AdminProductListResetEventDetail,
} from "@/lib/admin/product-list-config";
import {
  clearAdminProductListConfigCookie,
  parseAdminProductListConfigDocumentCookie,
  saveAdminProductListConfigCookie,
} from "@/lib/admin/product-list-config-cookie";

interface ProductsFilterBarProps {
  categories: { slug: string; name: string }[];
  initialConfig: AdminProductListConfig;
  initialSaved: boolean;
}

export function ProductsFilterBar({ categories, initialConfig, initialSaved }: ProductsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState(initialSaved);
  const [, startTransition] = useTransition();
  const configRef = useRef(initialConfig);
  const qRef = useRef(searchParams.get("q") ?? "");
  const searchParamsRef = useRef(searchParams.toString());
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPendingSearch() {
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }

  function navigateExplicit(nextConfig: AdminProductListConfig, nextQ: string) {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    // Explicit mode makes absent values mean defaults instead of falling back
    // to the cookie. This also makes disabling persistence deterministic.
    params.set("view", "explicit");
    setAdminProductListConfigParams(params, nextConfig);
    const query = params.toString();
    searchParamsRef.current = query;
    startTransition(() => {
      router.push(`${pathname}?${query}`, { scroll: false });
    });
  }

  function navigateSearch(nextConfig: AdminProductListConfig, nextQ: string) {
    const currentParams = new URLSearchParams(searchParamsRef.current);
    if (currentParams.get("view") !== "target") {
      navigateExplicit(nextConfig, nextQ);
      return;
    }

    if (nextQ.trim()) currentParams.set("q", nextQ.trim());
    else currentParams.delete("q");
    currentParams.delete("page");
    currentParams.delete("created");
    currentParams.delete("updated");
    currentParams.delete("photoError");
    setAdminProductListConfigParams(currentParams, nextConfig);
    const query = currentParams.toString();
    searchParamsRef.current = query;
    startTransition(() => {
      router.push(`${pathname}?${query}`, { scroll: false });
    });
  }

  function changeConfig(patch: Partial<AdminProductListConfig>) {
    clearPendingSearch();
    const next = { ...configRef.current, ...patch };
    configRef.current = next;
    setConfig(next);
    if (saved) saveAdminProductListConfigCookie(next);
    navigateExplicit(next, qRef.current);
  }

  function changeSaved(nextSaved: boolean) {
    setSaved(nextSaved);
    if (nextSaved) {
      saveAdminProductListConfigCookie(configRef.current);
      return;
    }

    clearPendingSearch();
    clearAdminProductListConfigCookie();
    configRef.current = DEFAULT_ADMIN_PRODUCT_LIST_CONFIG;
    setConfig(DEFAULT_ADMIN_PRODUCT_LIST_CONFIG);
    navigateExplicit(DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, qRef.current);
  }

  useEffect(() => {
    const resetFromEmptyState = (event: Event) => {
      (event as CustomEvent<AdminProductListResetEventDetail>).detail.q = qRef.current;
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      configRef.current = DEFAULT_ADMIN_PRODUCT_LIST_CONFIG;
      const resetParams = new URLSearchParams();
      if (qRef.current.trim()) resetParams.set("q", qRef.current.trim());
      resetParams.set("view", "explicit");
      searchParamsRef.current = resetParams.toString();
      setConfig(DEFAULT_ADMIN_PRODUCT_LIST_CONFIG);
      setSaved(false);
    };
    window.addEventListener(ADMIN_PRODUCT_LIST_RESET_EVENT, resetFromEmptyState);
    return () => {
      window.removeEventListener(ADMIN_PRODUCT_LIST_RESET_EVENT, resetFromEmptyState);
      if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const syncFromBrowserHistory = () => {
      clearPendingSearch();

      const params = new URLSearchParams(window.location.search);
      const persistedConfig = parseAdminProductListConfigDocumentCookie(document.cookie);
      const resolved = resolveAdminProductListConfig(
        {
          view: params.get("view") ?? undefined,
          category: params.get("category") ?? undefined,
          status: params.get("status") ?? undefined,
          availability: params.get("availability") ?? undefined,
          sort: params.get("sort") ?? undefined,
        },
        persistedConfig,
      );
      const nextConfig = normalizeAdminProductListCategory(
        resolved.config,
        new Set(categories.map((category) => category.slug)),
      );
      const nextQ = params.get("q") ?? "";

      searchParamsRef.current = params.toString();
      qRef.current = nextQ;
      configRef.current = nextConfig;
      setQ(nextQ);
      setConfig(nextConfig);
      setSaved(persistedConfig !== null);

      if (resolved.view === "explicit" && persistedConfig !== null) {
        saveAdminProductListConfigCookie(nextConfig);
      }
    };

    window.addEventListener("popstate", syncFromBrowserHistory);
    return () => window.removeEventListener("popstate", syncFromBrowserHistory);
  }, [categories]);

  function changeSearch(nextQ: string) {
    qRef.current = nextQ;
    setQ(nextQ);
    clearPendingSearch();
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      navigateSearch(configRef.current, qRef.current);
    }, 300);
  }

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <Input
        type="search"
        name="q"
        aria-label="Поиск товаров"
        autoComplete="off"
        value={q}
        onChange={(event) => changeSearch(event.target.value)}
        placeholder="Поиск по названию или артикулу…"
        className="sm:max-w-xs"
      />
      <Select
        name="category"
        aria-label="Фильтр по категории"
        value={config.category}
        onChange={(event) => changeConfig({ category: event.target.value })}
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
        value={config.status}
        onChange={(event) => changeConfig({ status: event.target.value as AdminProductListConfig["status"] })}
        className="sm:max-w-[10rem]"
      >
        <option value="">Любая публикация</option>
        <option value="published">Опубликован</option>
        <option value="draft">Черновик</option>
      </Select>
      <Select
        name="availability"
        aria-label="Фильтр по наличию"
        value={config.availability}
        onChange={(event) => changeConfig({ availability: event.target.value as AdminProductListConfig["availability"] })}
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
        value={config.sort}
        onChange={(event) => changeConfig({ sort: event.target.value as AdminProductListConfig["sort"] })}
        className="sm:max-w-[10rem]"
      >
        <option value="order">Ручной порядок</option>
        <option value="name">По названию</option>
        <option value="updated">Сначала изменённые</option>
      </Select>
      <Checkbox
        label="Сохранить конфигурацию"
        checked={saved}
        onChange={(event) => changeSaved(event.target.checked)}
        containerClassName="min-h-11 cursor-pointer rounded-md px-2 sm:ml-1"
        className="h-5 w-5 shrink-0"
      />
    </div>
  );
}
