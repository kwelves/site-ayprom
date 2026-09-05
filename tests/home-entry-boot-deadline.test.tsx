// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeEntrySequence, useHomeEntrySequence } from "@/components/home/HomeEntrySequence";
import { DURATION } from "@/lib/motion";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <span role="img" aria-label={alt} data-src={src} />,
}));

/** Обещанный пользователю предел показа заставки. */
const BOOT_DEADLINE_MS = 1_500;

/** Стенд-заменитель Hero: кнопка играет роль подтверждённого движения видео. */
function Probe() {
  const sequence = useHomeEntrySequence();
  return (
    <>
      <output data-testid="probe" data-content-visible={String(sequence.contentVisible)} />
      <button type="button" data-testid="reveal-header" onClick={sequence.revealHeader}>
        hero
      </button>
    </>
  );
}

function renderSequence() {
  return render(
    <HomeEntrySequence>
      <Probe />
    </HomeEntrySequence>,
  );
}

/** Заставка ещё на экране, а содержимое ещё закрыто от фокуса и скринридера. */
function bootLocked(container: HTMLElement) {
  const content = container.querySelector("[data-home-entry-content]");
  return {
    overlay: screen.queryByRole("progressbar", { name: "Загрузка сайта" }) !== null,
    inert: content?.hasAttribute("inert") ?? false,
    ariaHidden: content?.getAttribute("aria-hidden") === "true",
    contentVisible: screen.getByTestId("probe").getAttribute("data-content-visible") === "true",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("предел показа заставки главной", () => {
  it("снимает заставку и inert не позже 1500 мс, даже если видео так и не пошло", async () => {
    const view = renderSequence();
    // `sequenceArmed` выставляется микрозадачей после монтирования.
    await act(async () => {});

    expect(bootLocked(view.container)).toEqual({
      overlay: true,
      inert: true,
      ariaHidden: true,
      contentVisible: false,
    });

    // Ни одного сигнала от видео за всё это время — сценарий «зависший поток».
    act(() => {
      vi.advanceTimersByTime(BOOT_DEADLINE_MS - 1);
    });
    expect(bootLocked(view.container).overlay).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Ровно по дедлайну и одним шагом: overlay убран, inert/aria-hidden сняты,
    // boot завершён. Дополнительных внутренних фаз после дедлайна нет.
    expect(bootLocked(view.container)).toEqual({
      overlay: false,
      inert: false,
      ariaHidden: false,
      contentVisible: true,
    });
  });

  it("после дедлайна ничего не возвращает страницу за заставку", async () => {
    const view = renderSequence();
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(BOOT_DEADLINE_MS);
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(bootLocked(view.container)).toEqual({
      overlay: false,
      inert: false,
      ariaHidden: false,
      contentVisible: true,
    });
  });

  it("успешный сценарий заканчивается заметно раньше дедлайна", async () => {
    const view = renderSequence();
    await act(async () => {});

    // Hero подтвердил движение и открыл шапку — обычный путь, без ожидания
    // предельного срока.
    act(() => {
      screen.getByTestId("reveal-header").click();
    });

    // Заставка гаснет своим переходом, содержимое открывается следом.
    act(() => {
      vi.advanceTimersByTime(DURATION.base * 1000 + 80);
    });

    const state = bootLocked(view.container);
    expect(state).toEqual({
      overlay: false,
      inert: false,
      ariaHidden: false,
      contentVisible: true,
    });
    expect(DURATION.base * 1000 + 80).toBeLessThan(BOOT_DEADLINE_MS);
  });
});
