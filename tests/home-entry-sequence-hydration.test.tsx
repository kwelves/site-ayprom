// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeEntrySequence, useHomeEntrySequence } from "@/components/home/HomeEntrySequence";

const navigationMock = vi.hoisted(() => ({ pathname: "/" as string | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMock.pathname,
}));

// framer-motion здесь намеренно не мокается: ранний shell главной от него
// больше не зависит — предпочтение движения читается через
// usePrefersReducedMotion, у которого серверный снимок всегда false.
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <span role="img" aria-label={alt} data-src={src} />,
}));

afterEach(() => {
  cleanup();
  navigationMock.pathname = "/";
});

function SequenceProbe() {
  const { contentVisible, headerVisible, isHomeRoute } = useHomeEntrySequence();

  return (
    <output
      data-testid="sequence-probe"
      data-content-visible={String(contentVisible)}
      data-header-visible={String(headerVisible)}
      data-home-route={String(isHomeRoute)}
    />
  );
}

describe("HomeEntrySequence hydration contract", () => {
  it("keeps the prerender shell stable when the pathname appears only in the browser", () => {
    navigationMock.pathname = null;
    const serverMarkup = renderToString(
      <HomeEntrySequence>
        <SequenceProbe />
      </HomeEntrySequence>,
    );

    navigationMock.pathname = "/";
    const firstClientMarkup = renderToString(
      <HomeEntrySequence>
        <SequenceProbe />
      </HomeEntrySequence>,
    );

    expect(firstClientMarkup).toBe(serverMarkup);
    expect(serverMarkup).not.toContain('aria-hidden="true"');
    expect(serverMarkup).not.toContain('aria-label="Загрузка сайта"');
  });

  it("keeps server slots and the first client render on the same safe context values", async () => {
    const serverMarkup = renderToString(
      <HomeEntrySequence>
        <SequenceProbe />
      </HomeEntrySequence>,
    );

    expect(serverMarkup).toContain('data-content-visible="true"');
    expect(serverMarkup).toContain('data-header-visible="true"');
    expect(serverMarkup).toContain('data-home-route="false"');

    render(
      <HomeEntrySequence>
        <SequenceProbe />
      </HomeEntrySequence>,
    );

    const probe = screen.getByTestId("sequence-probe");
    await waitFor(() => {
      expect(probe.getAttribute("data-content-visible")).toBe("false");
      expect(probe.getAttribute("data-header-visible")).toBe("false");
      expect(probe.getAttribute("data-home-route")).toBe("true");
    });
    expect(screen.getByRole("progressbar", { name: "Загрузка сайта" })).not.toBeNull();
  });
});
