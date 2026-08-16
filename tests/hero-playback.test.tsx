// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/home/Hero";

vi.mock("framer-motion", () => ({ useReducedMotion: () => false }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/home/HomeEntrySequence", () => ({
  useHomeEntrySequence: () => ({
    revealVideo: () => undefined,
    revealHeader: () => undefined,
    contentVisible: true,
  }),
}));

const play = vi.fn<() => Promise<void>>();
const pause = vi.fn();
const load = vi.fn();
let observers: TestIntersectionObserver[] = [];

class TestIntersectionObserver {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  emit(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function setVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: visibilityState });
}

async function settlePlaybackAttempt() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  observers = [];
  play.mockReset().mockResolvedValue(undefined);
  pause.mockReset();
  load.mockReset();
  setVisibility("visible");
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: load });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => true });
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Hero video playback", () => {
  it("pauses outside Hero or in a hidden tab, then resumes only when both are visible", async () => {
    render(<Hero vehicleTypes={[]} />);
    const observer = observers[0];
    expect(observer).toBeDefined();
    expect(play).toHaveBeenCalledTimes(1);
    await settlePlaybackAttempt();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(play).toHaveBeenCalledTimes(2);
    await settlePlaybackAttempt();

    observer.emit(false);
    expect(pause).toHaveBeenCalledTimes(2);

    observer.emit(true);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("pauses before page cache and resumes on pageshow, then cleans its observer up", async () => {
    const view = render(<Hero vehicleTypes={[]} />);
    const observer = observers[0];
    await settlePlaybackAttempt();

    window.dispatchEvent(new Event("pagehide"));
    expect(pause).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pageshow"));
    expect(play).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("resyncs after a page-cache pause interrupts an in-flight play attempt", async () => {
    let resolveInitialPlay: (() => void) | undefined;
    play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialPlay = resolve;
        }),
    );

    render(<Hero vehicleTypes={[]} />);
    expect(play).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    expect(pause).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pageshow"));
    // The original attempt is still pending, so this event only asks for one
    // follow-up after it settles rather than stacking concurrent play calls.
    expect(play).toHaveBeenCalledTimes(1);

    resolveInitialPlay?.();
    await settlePlaybackAttempt();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("defers a failed stream recovery until the Hero and document are visible again", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video!);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(load).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("restores the bounded recovery budget after a successful decoded frame", () => {
    vi.useFakeTimers();
    const { container } = render(<Hero vehicleTypes={[]} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video!);
    vi.advanceTimersByTime(1_000);
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.loadedData(video!);
    fireEvent.error(video!);
    vi.advanceTimersByTime(1_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
