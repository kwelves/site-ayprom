/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsFilterBar } from "@/components/admin/ProductsFilterBar";
import { ProductFiltersResetButton } from "@/components/admin/ProductFiltersResetButton";
import { DEFAULT_ADMIN_PRODUCT_LIST_CONFIG } from "@/lib/admin/product-list-config";
import {
  clearAdminProductListConfigCookie,
  parseAdminProductListConfigDocumentCookie,
  saveAdminProductListConfigCookie,
} from "@/lib/admin/product-list-config-cookie";

const navigation = vi.hoisted(() => ({
  pathname: "/admin/products",
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.searchParams,
}));

beforeEach(() => {
  navigation.push.mockReset();
  navigation.searchParams = new URLSearchParams("q=pump");
  window.history.replaceState(null, "", "/admin/products?q=pump");
  clearAdminProductListConfigCookie();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

async function moveThroughHistory(direction: "back" | "forward") {
  await act(async () => {
    const popped = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    window.history[direction]();
    await popped;
  });
}

describe("ProductsFilterBar", () => {
  it("saves the current config, updates it live, then deletes and resets it while preserving search", async () => {
    const user = userEvent.setup();
    const cookieSetter = vi.spyOn(document, "cookie", "set");

    render(
      <ProductsFilterBar
        categories={[{ slug: "parts", name: "Запчасти" }]}
        initialConfig={{
          category: "parts",
          status: "draft",
          availability: "unclear",
          sort: "updated",
        }}
        initialSaved={false}
      />,
    );

    const saveCheckbox = screen.getByRole("checkbox", { name: "Сохранить конфигурацию" });
    await user.click(saveCheckbox);
    expect(cookieSetter).toHaveBeenLastCalledWith(
      expect.stringMatching(/^admin_products_list_config=.*path=\/admin; max-age=31536000; SameSite=Lax$/),
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Сортировка" }), "name");
    expect(decodeURIComponent(cookieSetter.mock.calls.at(-1)?.[0] ?? "")).toContain('"sort":"name"');
    await waitFor(() =>
      expect(navigation.push).toHaveBeenLastCalledWith(
        "/admin/products?q=pump&view=explicit&category=parts&status=draft&availability=unclear&sort=name",
        { scroll: false },
      ),
    );

    await user.click(saveCheckbox);
    expect(cookieSetter).toHaveBeenLastCalledWith(
      "admin_products_list_config=; path=/admin; max-age=0; SameSite=Lax",
    );
    expect((screen.getByRole("combobox", { name: "Фильтр по категории" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Фильтр по публикации" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Фильтр по наличию" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe(
      DEFAULT_ADMIN_PRODUCT_LIST_CONFIG.sort,
    );
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/admin/products?q=pump&view=explicit",
      { scroll: false },
    );
  });

  it("cancels a pending search before an immediate sort navigation", () => {
    vi.useFakeTimers();
    render(
      <ProductsFilterBar
        categories={[]}
        initialConfig={DEFAULT_ADMIN_PRODUCT_LIST_CONFIG}
        initialSaved={false}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск товаров" }), {
      target: { value: "new pump" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Сортировка" }), {
      target: { value: "updated" },
    });

    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/admin/products?q=new+pump&view=explicit&sort=updated",
      { scroll: false },
    );
    act(() => vi.advanceTimersByTime(300));
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });

  it("keeps target mode and relaxed filters when only search changes", () => {
    vi.useFakeTimers();
    navigation.searchParams = new URLSearchParams(
      "view=target&category=parts&sort=updated&relaxed=status&page=2&q=old",
    );
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    render(
      <ProductsFilterBar
        categories={[{ slug: "parts", name: "Запчасти" }]}
        initialConfig={{ ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, category: "parts", sort: "updated" }}
        initialSaved
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск товаров" }), {
      target: { value: "new" },
    });
    act(() => vi.advanceTimersByTime(300));

    expect(navigation.push).toHaveBeenCalledOnce();
    const [href, options] = navigation.push.mock.calls[0] as [string, { scroll: boolean }];
    const url = new URL(href, "https://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "target",
      relaxed: "status",
      q: "new",
      category: "parts",
      sort: "updated",
    });
    expect(options).toEqual({ scroll: false });
    expect(cookieSetter).not.toHaveBeenCalled();
  });

  it("does not replace a newer controlled search value on a slower URL rerender", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ProductsFilterBar
        categories={[]}
        initialConfig={DEFAULT_ADMIN_PRODUCT_LIST_CONFIG}
        initialSaved={false}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "newer query" } });

    navigation.searchParams = new URLSearchParams("q=older-response");
    rerender(
      <ProductsFilterBar
        categories={[]}
        initialConfig={DEFAULT_ADMIN_PRODUCT_LIST_CONFIG}
        initialSaved={false}
      />,
    );

    expect(search.value).toBe("newer query");
    fireEvent.change(screen.getByRole("combobox", { name: "Сортировка" }), {
      target: { value: "updated" },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/admin/products?q=newer+query&view=explicit&sort=updated",
      { scroll: false },
    );
  });

  it("restores an explicit saved config on Back and makes it the persisted mutation context", async () => {
    const user = userEvent.setup();
    const configA = {
      category: "parts",
      status: "draft" as const,
      availability: "unclear" as const,
      sort: "name" as const,
    };
    const queryA = "q=older&view=explicit&category=parts&status=draft&availability=unclear&sort=name";
    navigation.searchParams = new URLSearchParams(queryA);
    window.history.replaceState(null, "", `/admin/products?${queryA}`);
    navigation.push.mockImplementation((href: string) => {
      window.history.pushState(null, "", href);
    });

    render(
      <ProductsFilterBar
        categories={[{ slug: "parts", name: "Запчасти" }]}
        initialConfig={configA}
        initialSaved={false}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Сохранить конфигурацию" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Сортировка" }), "updated");
    expect(parseAdminProductListConfigDocumentCookie(document.cookie)?.sort).toBe("updated");

    await moveThroughHistory("back");

    expect((screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement).value).toBe("older");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe("name");
    expect(parseAdminProductListConfigDocumentCookie(document.cookie)).toEqual(configA);
  });

  it("syncs q and qRef across Back/Forward and preserves the visible q on the next select navigation", async () => {
    const oldQuery = "q=old&view=explicit";
    const newQuery = "q=new&view=explicit";
    window.history.replaceState(null, "", `/admin/products?${oldQuery}`);
    window.history.pushState(null, "", `/admin/products?${newQuery}`);
    navigation.searchParams = new URLSearchParams(newQuery);

    render(
      <ProductsFilterBar
        categories={[]}
        initialConfig={DEFAULT_ADMIN_PRODUCT_LIST_CONFIG}
        initialSaved={false}
      />,
    );

    await moveThroughHistory("back");
    expect((screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement).value).toBe("old");

    await moveThroughHistory("forward");
    expect((screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement).value).toBe("new");

    fireEvent.change(screen.getByRole("combobox", { name: "Сортировка" }), {
      target: { value: "updated" },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/admin/products?q=new&view=explicit&sort=updated",
      { scroll: false },
    );
  });

  it("restores a target view on Back without overwriting the saved config cookie", async () => {
    const savedConfig = {
      category: "forklifts",
      status: "published" as const,
      availability: "in_stock" as const,
      sort: "updated" as const,
    };
    const targetQuery = "q=target&view=target&category=parts&status=draft&availability=unclear&sort=name";
    window.history.replaceState(null, "", `/admin/products?${targetQuery}`);
    window.history.pushState(null, "", "/admin/products?q=current&view=explicit&category=forklifts&sort=updated");
    navigation.searchParams = new URLSearchParams("q=current&view=explicit&category=forklifts&sort=updated");
    saveAdminProductListConfigCookie(savedConfig);

    render(
      <ProductsFilterBar
        categories={[
          { slug: "parts", name: "Запчасти" },
          { slug: "forklifts", name: "Погрузчики" },
        ]}
        initialConfig={savedConfig}
        initialSaved
      />,
    );

    await moveThroughHistory("back");

    expect((screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement).value).toBe("target");
    expect((screen.getByRole("combobox", { name: "Фильтр по категории" }) as HTMLSelectElement).value).toBe("parts");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe("name");
    expect(parseAdminProductListConfigDocumentCookie(document.cookie)).toEqual(savedConfig);
  });

  it("restores the saved config, or defaults without a cookie, on a clean-URL popstate", () => {
    const savedConfig = {
      category: "parts",
      status: "published" as const,
      availability: "in_stock" as const,
      sort: "updated" as const,
    };
    navigation.searchParams = new URLSearchParams("view=explicit&sort=name");
    window.history.replaceState(null, "", "/admin/products?view=explicit&sort=name");
    saveAdminProductListConfigCookie(savedConfig);

    render(
      <ProductsFilterBar
        categories={[{ slug: "parts", name: "Запчасти" }]}
        initialConfig={{ ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, sort: "name" }}
        initialSaved
      />,
    );

    act(() => {
      window.history.replaceState(null, "", "/admin/products?q=clean");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((screen.getByRole("searchbox", { name: "Поиск товаров" }) as HTMLInputElement).value).toBe("clean");
    expect((screen.getByRole("combobox", { name: "Фильтр по категории" }) as HTMLSelectElement).value).toBe("parts");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe("updated");

    act(() => {
      clearAdminProductListConfigCookie();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((screen.getByRole("checkbox", { name: "Сохранить конфигурацию" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("combobox", { name: "Фильтр по категории" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe("order");
  });

  it("resets saved filters through the empty-state action and preserves the latest search", () => {
    vi.useFakeTimers();
    const cookieSetter = vi.spyOn(document, "cookie", "set");
    render(
      <>
        <ProductsFilterBar
          categories={[{ slug: "parts", name: "Запчасти" }]}
          initialConfig={{ ...DEFAULT_ADMIN_PRODUCT_LIST_CONFIG, category: "parts", sort: "updated" }}
          initialSaved
        />
        <ProductFiltersResetButton />
      </>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск товаров" }), {
      target: { value: "latest pump" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));

    expect(cookieSetter).toHaveBeenLastCalledWith(
      "admin_products_list_config=; path=/admin; max-age=0; SameSite=Lax",
    );
    expect((screen.getByRole("checkbox", { name: "Сохранить конфигурацию" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("combobox", { name: "Фильтр по категории" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Сортировка" }) as HTMLSelectElement).value).toBe("order");
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/admin/products?q=latest+pump&view=explicit",
      { scroll: false },
    );
    act(() => vi.advanceTimersByTime(300));
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });
});
