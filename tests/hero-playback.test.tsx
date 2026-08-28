// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/home/Hero";

vi.mock("framer-motion", () => ({ useReducedMotion: () => false }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
const entrySequence = vi.hoisted(() => ({
  revealVideo: vi.fn(),
  revealHeader: vi.fn(),
}));

vi.mock("@/components/home/HomeEntrySequence", () => ({
  useHomeEntrySequence: () => ({
    revealVideo: entrySequence.revealVideo,
    revealHeader: entrySequence.revealHeader,
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

// QA-006: hero состоит из двух `<video>` — стартовой ступени и качественной.
// `pause` заглушён на прототипе, поэтому один общий счётчик вызовов больше
// ничего не значит: считать нужно по конкретному элементу. `mock.instances`
// хранит `this` каждого вызова.
function pausesOn(element: Element | null): number {
  return pause.mock.instances.filter((instance) => instance === element).length;
}

function heroVideos(container: HTMLElement) {
  const [startup, quality] = Array.from(container.querySelectorAll("video"));
  return { startup, quality };
}

/** jsdom не даёт задать эти свойства напрямую — подменяем их на элементе. */
function defineMediaState(video: HTMLVideoElement, state: { duration?: number; bufferedTo?: number }) {
  if (state.duration !== undefined) {
    Object.defineProperty(video, "duration", { configurable: true, value: state.duration });
  }
  if (state.bufferedTo !== undefined) {
    const end = state.bufferedTo;
    Object.defineProperty(video, "buffered", {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => end } as unknown as TimeRanges,
    });
  }
}

function setCurrentTime(video: HTMLVideoElement, value: number) {
  Object.defineProperty(video, "currentTime", { configurable: true, value });
}

/**
 * Подмена ступеней начинается с перемотки качественной версии на общее время.
 * В jsdom она не может завершиться (события `seeked` там нет), поэтому решение
 * «начинать подмену» наблюдается по самой записи в `currentTime`, а не по её
 * результату: иначе проверка проходила бы одинаково и с правильным, и с
 * неправильным условием запуска.
 */
function trackSeeks(video: HTMLVideoElement): number[] {
  const seeks: number[] = [];
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => 0,
    set: (value: number) => {
      seeks.push(value);
    },
  });
  return seeks;
}

beforeEach(() => {
  observers = [];
  play.mockReset().mockResolvedValue(undefined);
  pause.mockReset();
  load.mockReset();
  entrySequence.revealVideo.mockReset();
  entrySequence.revealHeader.mockReset();
  setVisibility("visible");
  // Рамка качественной ступени выбирается тем же медиавыражением, что и
  // стартовая; в jsdom `matchMedia` нет вовсе.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);
    const observer = observers[0];
    expect(observer).toBeDefined();
    expect(play).toHaveBeenCalledTimes(1);
    await settlePlaybackAttempt();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    // Останавливаются ОБЕ ступени. Если бы гасилась только видимая, то после
    // подмены качественная продолжала бы декодировать в скрытой вкладке.
    expect(pausesOn(startup)).toBe(1);
    expect(pausesOn(quality)).toBe(1);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(play).toHaveBeenCalledTimes(2);
    await settlePlaybackAttempt();

    observer.emit(false);
    expect(pausesOn(startup)).toBe(2);
    expect(pausesOn(quality)).toBe(2);

    observer.emit(true);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("pauses before page cache and resumes on pageshow, then cleans its observer up", async () => {
    const view = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(view.container);
    const observer = observers[0];
    await settlePlaybackAttempt();

    window.dispatchEvent(new Event("pagehide"));
    expect(pausesOn(startup)).toBe(1);
    expect(pausesOn(quality)).toBe(1);

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

    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup } = heroVideos(container);
    expect(play).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    expect(pausesOn(startup)).toBe(1);

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

// QA-006. Ниже — доказательства двух свойств, ради которых hero переделан:
// заставка снимается только по реальному движению, а тяжёлая ступень грузится
// только после того, как лёгкая целиком в буфере.
describe("Hero two-tier video", () => {
  it("не показывает видео и не открывает заставку по одному только loadeddata", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup } = heroVideos(container);

    fireEvent.loadedData(startup);

    // Это и был прежний дефект: декодированный кадр принимался за готовность,
    // и на медленной сети заставка уходила, открывая неподвижную картинку.
    expect(startup.className).toContain("opacity-0");
    expect(entrySequence.revealVideo).not.toHaveBeenCalled();
  });

  it("не считает движением playing без смены кадра", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup } = heroVideos(container);

    setCurrentTime(startup, 0);
    fireEvent.playing(startup);
    fireEvent.timeUpdate(startup);
    fireEvent.timeUpdate(startup);

    expect(startup.className).toContain("opacity-0");
  });

  it("показывает видео после playing и двух разных кадров", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup } = heroVideos(container);

    setCurrentTime(startup, 0);
    fireEvent.playing(startup);
    fireEvent.timeUpdate(startup);
    setCurrentTime(startup, 1 / 24);
    fireEvent.timeUpdate(startup);

    expect(startup.className).toContain("opacity-100");
  });

  it("не запрашивает качественную ступень, пока стартовая не в буфере целиком", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);

    defineMediaState(startup, { duration: 25.416667, bufferedTo: 12 });
    fireEvent.progress(startup);

    // Иначе тяжёлый файл отобрал бы канал у видео, которое сейчас на экране.
    expect(quality.getAttribute("src")).toBeNull();
  });

  it("запрашивает качественную ступень, когда стартовая догрузилась", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);

    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);

    expect(quality.src).toContain("/2026-08-18-2k/");
    expect(quality.preload).toBe("auto");
    expect(quality.className).toContain("opacity-0");
  });

  it("запрашивает качественную ступень ровно один раз", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);

    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);
    const first = quality.src;
    load.mockClear();

    fireEvent.progress(startup);
    fireEvent.suspend(startup);

    expect(quality.src).toBe(first);
    expect(load).not.toHaveBeenCalled();
  });

  it("не начинает подмену по одному только canplaythrough", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);
    const seeks = trackSeeks(quality);

    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);

    // `canplaythrough` — оптимистичная оценка браузера. На канале, который
    // впятеро медленнее потока, она неверна: подмена по ней происходила при
    // недокачанном файле, и дальше качественная ступень спотыкалась почти
    // непрерывно (измерено 19 провалов показа после подмены).
    defineMediaState(quality, { duration: 25.416667, bufferedTo: 9 });
    fireEvent.canPlayThrough(quality);

    expect(seeks).toHaveLength(0);
    expect(quality.className).toContain("opacity-0");
  });

  it("не начинает подмену, когда загрузка медленнее воспроизведения", () => {
    const now = vi.spyOn(performance, "now");
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);
    const seeks = trackSeeks(quality);

    // Отсчёт скорости начинается в момент запроса качественной ступени.
    now.mockReturnValue(0);
    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);

    // За 10 секунд реального времени приехало 12 секунд видео минус ноль,
    // то есть 1,2 секунды видео в секунду — меньше требуемого запаса.
    now.mockReturnValue(10_000);
    defineMediaState(quality, { duration: 25.416667, bufferedTo: 12 });
    fireEvent.progress(quality);

    expect(seeks).toHaveLength(0);
    now.mockRestore();
  });

  it("начинает подмену, когда загрузка обгоняет воспроизведение", () => {
    const now = vi.spyOn(performance, "now");
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);
    const seeks = trackSeeks(quality);

    // Отсчёт скорости начинается в момент запроса качественной ступени.
    now.mockReturnValue(0);
    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);

    // За 2 секунды приехало 15 секунд видео — запас более чем семикратный.
    now.mockReturnValue(2_000);
    defineMediaState(quality, { duration: 25.416667, bufferedTo: 15 });
    fireEvent.progress(quality);

    // Цель берётся с упреждением от текущего времени стартовой ступени,
    // чтобы перемотка успела завершиться до момента вступления.
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeGreaterThan(0);
    now.mockRestore();
  });

  // Подмена не мгновенна: между `play()` качественной ступени и её первым
  // отрисованным кадром проходит заметное время. Если ровно в этот промежуток
  // спрятать вкладку, обе ступени встают на паузу — и без отката состояние
  // навсегда застревало бы в `swapping`: кадров больше нет, значит завершение
  // не наступит, а возобновление выберет стартовую ступень. Посетитель молча
  // остался бы на 720p до перезагрузки страницы.
  function driveToSwapping(container: HTMLElement) {
    const { startup, quality } = heroVideos(container);
    const seeks = trackSeeks(quality);
    const now = vi.spyOn(performance, "now");

    // Движение подтверждается до подмены — так же, как в жизни: качественная
    // ступень запрашивается только после того, как стартовая уже играет.
    setCurrentTime(startup, 0);
    fireEvent.playing(startup);
    fireEvent.timeUpdate(startup);
    setCurrentTime(startup, 1 / 24);
    fireEvent.timeUpdate(startup);
    expect(startup.className).toContain("opacity-100");

    now.mockReturnValue(0);
    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);
    now.mockReturnValue(2_000);
    defineMediaState(quality, { duration: 25.416667, bufferedTo: 15 });
    fireEvent.progress(quality);

    expect(seeks).toHaveLength(1);
    return { startup, quality, seeks, now };
  }

  it("сокрытие вкладки во время подмены останавливает обе ступени и повторяет подмену при возврате", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality, seeks, now } = driveToSwapping(container);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pausesOn(startup)).toBe(1);
    expect(pausesOn(quality)).toBe(1);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    // Вторая перемотка означает, что подмена начата заново, а не потеряна.
    expect(seeks).toHaveLength(2);
    now.mockRestore();
  });

  it("уход в page cache во время подмены не теряет её: pageshow начинает подмену заново", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality, seeks, now } = driveToSwapping(container);

    window.dispatchEvent(new Event("pagehide"));
    expect(pausesOn(startup)).toBe(1);
    expect(pausesOn(quality)).toBe(1);

    window.dispatchEvent(new Event("pageshow"));

    expect(seeks).toHaveLength(2);
    now.mockRestore();
  });

  it("уход hero с экрана во время подмены тоже откатывает её", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality, seeks, now } = driveToSwapping(container);
    const observer = observers[0];

    observer.emit(false);
    expect(pausesOn(startup)).toBe(1);
    expect(pausesOn(quality)).toBe(1);

    observer.emit(true);

    expect(seeks).toHaveLength(2);
    now.mockRestore();
  });

  it("повторные сокрытия вкладки не наслаивают параллельные попытки подмены", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { seeks, now } = driveToSwapping(container);

    // Каждый возврат должен начинать подмену заново ровно один раз. Если бы
    // прошлая попытка не разбиралась, вместе с новой остались бы висеть её
    // обработчик перемотки и цикл выравнивания — и оба довели бы дело до
    // запуска уже неактуальной цели.
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    // Каждое возвращение повторяет подмену ровно один раз, а не наслаивает
    // параллельные попытки.
    expect(seeks).toHaveLength(3);
    now.mockRestore();
  });

  /** Доводит подмену до конца: в jsdom нет ни `seeked`, ни кадровых колбэков. */
  async function completeSwap(container: HTMLElement) {
    const state = driveToSwapping(container);
    // Цель бралась от нулевого времени стартовой ступени, поэтому достаточно
    // сдвинуть её вперёд, чтобы выравнивание сошлось с первой же попытки.
    setCurrentTime(state.startup, 5);
    // Завершение подмены происходит в колбэке промиса `play()`, а не в самом
    // событии, поэтому обновление состояния React нужно дождаться внутри act.
    await act(async () => {
      fireEvent.seeked(state.quality);
      await settlePlaybackAttempt();
    });
    return state;
  }

  // Оборванный на середине файл ломается не сразу: заголовок целый, весь ролик
  // числится в буфере, подмена проходит штатно — и лишь дойдя до обрыва,
  // воспроизведение падает с ошибкой декодирования. Проверено живьём: без
  // возврата к стартовой ступени hero замирал на мёртвом кадре.
  it("отказ качественной ступени ПОСЛЕ подмены возвращает стартовую", async () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality, now } = await completeSwap(container);

    expect(quality.className).toContain("opacity-100");
    const loadsBeforeFailure = load.mock.calls.length;

    fireEvent.error(quality);

    expect(quality.className).toContain("opacity-0");
    expect(startup.className).toContain("opacity-100");
    // Возврат идёт без новых запросов: файл стартовой ступени уже загружен и
    // стоит на паузе там, где его оставили.
    expect(load).toHaveBeenCalledTimes(loadsBeforeFailure);
    now.mockRestore();
  });

  it("после возврата к стартовой ступени качественная больше не запрашивается", async () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality, seeks, now } = await completeSwap(container);

    fireEvent.error(quality);
    const seeksAfterFailure = seeks.length;

    // Ни повторная догрузка, ни возвращение вкладки не должны воскрешать
    // ступень, которая уже сломалась.
    defineMediaState(quality, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(quality);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(seeks).toHaveLength(seeksAfterFailure);
    expect(quality.className).toContain("opacity-0");
    expect(startup.className).toContain("opacity-100");
    now.mockRestore();
  });

  it("отказ качественной ступени оставляет стартовую видимой и не повторяет попытку", () => {
    const { container } = render(<Hero vehicleTypes={[]} />);
    const { startup, quality } = heroVideos(container);

    setCurrentTime(startup, 0);
    fireEvent.playing(startup);
    fireEvent.timeUpdate(startup);
    setCurrentTime(startup, 1 / 24);
    fireEvent.timeUpdate(startup);

    defineMediaState(startup, { duration: 25.416667, bufferedTo: 25.416667 });
    fireEvent.progress(startup);
    expect(quality.src).not.toBe("");

    load.mockClear();
    fireEvent.error(quality);
    // Повторная загрузка отняла бы канал у играющей стартовой ступени ради
    // версии, которая один раз уже не доехала.
    fireEvent.progress(startup);
    fireEvent.suspend(startup);

    expect(load).not.toHaveBeenCalled();
    expect(quality.className).toContain("opacity-0");
    expect(startup.className).toContain("opacity-100");
    expect(pausesOn(startup)).toBe(0);
  });
});
