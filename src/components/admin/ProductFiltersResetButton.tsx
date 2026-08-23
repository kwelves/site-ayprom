"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PRODUCT_LIST_RESET_EVENT,
  type AdminProductListResetEventDetail,
} from "@/lib/admin/product-list-config";
import { clearAdminProductListConfigCookie } from "@/lib/admin/product-list-config-cookie";

export function ProductFiltersResetButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function resetFilters() {
    clearAdminProductListConfigCookie();
    const resetEvent = new CustomEvent<AdminProductListResetEventDetail>(ADMIN_PRODUCT_LIST_RESET_EVENT, {
      detail: {},
    });
    window.dispatchEvent(resetEvent);
    const params = new URLSearchParams();
    const q = (resetEvent.detail.q ?? searchParams.get("q"))?.trim();
    if (q) params.set("q", q);
    params.set("view", "explicit");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={resetFilters}
      className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[background-color,scale] duration-fast ease-ui hover:scale-[1.02] hover:bg-primary-hover active:scale-[0.98]"
    >
      Сбросить фильтры
    </button>
  );
}
