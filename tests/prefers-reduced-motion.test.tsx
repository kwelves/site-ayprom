// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

type Listener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return matches && query.includes("prefers-reduced-motion");
      },
      media: query,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
      onchange: null,
      dispatchEvent: () => false,
    }),
  });

  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function Probe() {
  const prefersReducedMotion = usePrefersReducedMotion();
  return <output data-testid="probe">{String(prefersReducedMotion)}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("usePrefersReducedMotion", () => {
  it("на сервере всегда false, поэтому первый серверный и клиентский HTML совпадают", () => {
    // Системная настройка уже «уменьшить движение», но серверный снимок обязан
    // остаться false — иначе гидратация разошлась бы на первом же рендере.
    installMatchMedia(true);

    expect(renderToString(<Probe />)).toContain(">false<");
  });

  it("без matchMedia (старый движок, окружение без медиазапросов) не падает", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  it("читает текущую настройку и реагирует на её изменение", async () => {
    const media = installMatchMedia(true);

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true"));
    expect(media.listenerCount).toBeGreaterThan(0);

    act(() => media.set(false));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("false"));

    act(() => media.set(true));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("true"));
  });

  it("отписывается при размонтировании", () => {
    const media = installMatchMedia(false);
    const view = render(<Probe />);
    expect(media.listenerCount).toBeGreaterThan(0);

    view.unmount();
    expect(media.listenerCount).toBe(0);
  });
});
