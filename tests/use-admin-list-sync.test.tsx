/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminList } from "@/lib/admin/use-admin-list";
import { AdminToastProvider } from "@/components/admin/ui/AdminToastProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/products",
}));

interface Item {
  id: string;
  name: string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness({ initial, remove }: { initial: Item[]; remove: (id: string) => Promise<void> }) {
  const { items, removeItem, actionError } = useAdminList({
    initial,
    getId: (item: Item) => item.id,
    reorder: vi.fn().mockResolvedValue(undefined),
    remove,
    messages: { created: "created", updated: "updated", deleted: "deleted", reordered: "reordered" },
  });

  return (
    <div>
      {items.map((item) => (
        <button key={item.id} onClick={() => removeItem(item)}>
          {item.name}
        </button>
      ))}
      {actionError && <p>{actionError}</p>}
    </div>
  );
}

afterEach(cleanup);

describe("useAdminList server synchronization", () => {
  it("заменяет локальный список свежим снимком после server refresh", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const first = { id: "first", name: "Первый" };
    const second = { id: "second", name: "Второй" };
    const { rerender } = render(<Harness initial={[first, second]} remove={remove} />);

    rerender(<Harness initial={[second]} remove={remove} />);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Первый" })).toBeNull());
    expect(screen.getByRole("button", { name: "Второй" })).toBeTruthy();
  });

  it("ошибка одной операции не возвращает другую уже удалённую запись", async () => {
    const firstDelete = deferred();
    const secondDelete = deferred();
    const remove = vi.fn((id: string) => (id === "first" ? firstDelete.promise : secondDelete.promise));
    const first = { id: "first", name: "Первый" };
    const second = { id: "second", name: "Второй" };
    render(<Harness initial={[first, second]} remove={remove} />);

    fireEvent.click(screen.getByRole("button", { name: "Первый" }));
    fireEvent.click(screen.getByRole("button", { name: "Второй" }));
    expect(screen.queryByRole("button")).toBeNull();

    await act(async () => {
      secondDelete.resolve();
      await secondDelete.promise;
      firstDelete.reject(new Error("delete failed"));
      await firstDelete.promise.catch(() => undefined);
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Первый" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Второй" })).toBeNull();
    expect(screen.getByText("Не удалось удалить запись. Она возвращена в список.")).toBeTruthy();
  });

  it("подтверждает успешное удаление через общий toast", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminToastProvider>
        <Harness initial={[{ id: "first", name: "Первый" }]} remove={remove} />
      </AdminToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Первый" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("deleted"));
    expect(screen.queryByRole("button", { name: "Первый" })).toBeNull();
  });
});
