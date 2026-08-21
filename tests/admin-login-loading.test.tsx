// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPasswordInput } from "@/components/admin/LoginPasswordInput";
import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";
import { WelcomeSplash } from "@/components/admin/WelcomeSplash";

const router = vi.hoisted(() => ({
  prefetch: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  router.prefetch.mockReset();
  router.replace.mockReset();
});

describe("admin login loading feedback", () => {
  it("shows the pending state when the password is submitted with Enter", async () => {
    let finishLogin: (() => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    const user = userEvent.setup();

    render(
      <form action={action}>
        <label>
          Пароль
          <LoginPasswordInput />
        </label>
        <LoginSubmitButton />
      </form>,
    );

    await user.type(screen.getByLabelText("Пароль"), "secret{Enter}");

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: "Проверяем доступ…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Проверяем пароль. Это может занять несколько секунд.")).toBeTruthy();

    await act(async () => finishLogin?.());
  });

  it("prefetches products while keeping the welcome screen visible for 1.4 seconds", () => {
    vi.useFakeTimers();
    render(<WelcomeSplash />);

    expect(screen.getByRole("status").textContent).toContain("Здравствуйте, шеф");
    expect(router.prefetch).toHaveBeenCalledWith("/admin/products");
    expect(router.replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_399));
    expect(router.replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledWith("/admin/products");
  });
});
