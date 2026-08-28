import { describe, expect, it } from "vitest";
import {
  canSustainPlayback,
  createDownloadRateWatch,
  HERO_VIDEO_SOURCES,
  createHeroMotionWatch,
  heroVideoSource,
  isFullyBuffered,
  nextHeroUpgradeState,
  type HeroUpgradeState,
} from "@/lib/hero-video";

// QA-006. Прежний hero снимал заставку по `loadeddata` — «первый кадр
// декодирован». Именно поэтому на медленной сети заставка уходила, открывая
// неподвижную картинку: воспроизведение так и не начиналось. Здесь
// проверяется новый критерий и порядок догрузки второй ступени.

function ranges(end: number | null): TimeRanges {
  if (end === null) return { length: 0, start: () => 0, end: () => 0 } as unknown as TimeRanges;
  return { length: 1, start: () => 0, end: () => end } as unknown as TimeRanges;
}

describe("подтверждение движения", () => {
  it("одного события playing недостаточно", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    expect(watch.confirmed).toBe(false);
  });

  it("одного показанного кадра недостаточно", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    expect(watch.observeFrame(0)).toBe(false);
    expect(watch.confirmed).toBe(false);
  });

  it("повторно показанный тот же кадр движением не считается", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    watch.observeFrame(1.5);
    expect(watch.observeFrame(1.5)).toBe(false);
    expect(watch.confirmed).toBe(false);
  });

  it("подтверждает движение по playing и двум разным кадрам", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    watch.observeFrame(0);
    expect(watch.observeFrame(1 / 24)).toBe(true);
    expect(watch.confirmed).toBe(true);
  });

  it("не подтверждает движение без playing, даже когда кадры сменились", () => {
    const watch = createHeroMotionWatch();
    watch.observeFrame(0);
    expect(watch.observeFrame(1 / 24)).toBe(false);
    expect(watch.confirmed).toBe(false);
  });

  it("подтверждает, когда playing приходит после смены кадров", () => {
    const watch = createHeroMotionWatch();
    watch.observeFrame(0);
    watch.observeFrame(1 / 24);
    watch.observePlaying();
    expect(watch.confirmed).toBe(true);
  });

  // Ролик зациклен: переход 25,4 → 0 — такое же движение, как и вперёд.
  it("считает движением переход через границу цикла", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    watch.observeFrame(25.375);
    expect(watch.observeFrame(0)).toBe(true);
  });

  it("подтверждает ровно один раз", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    watch.observeFrame(0);
    expect(watch.observeFrame(0.5)).toBe(true);
    expect(watch.observeFrame(1)).toBe(false);
  });

  it("игнорирует нечисловое время кадра", () => {
    const watch = createHeroMotionWatch();
    watch.observePlaying();
    expect(watch.observeFrame(Number.NaN)).toBe(false);
    watch.observeFrame(0);
    expect(watch.observeFrame(0.5)).toBe(true);
  });
});

describe("готовность стартовой ступени", () => {
  it("пустой буфер не считается полным", () => {
    expect(isFullyBuffered(ranges(null), 25.416667)).toBe(false);
  });

  it("неизвестная длительность не считается полным буфером", () => {
    expect(isFullyBuffered(ranges(10), Number.NaN)).toBe(false);
  });

  it("частично загруженный файл не считается полным", () => {
    expect(isFullyBuffered(ranges(12), 25.416667)).toBe(false);
  });

  it("догруженный до конца файл считается полным", () => {
    expect(isFullyBuffered(ranges(25.416667), 25.416667)).toBe(true);
  });

  it("допускает недобор в пределах допуска", () => {
    expect(isFullyBuffered(ranges(25.1), 25.416667)).toBe(true);
  });
});

describe("измерение скорости загрузки", () => {
  it("по одной точке судить нельзя", () => {
    const watch = createDownloadRateWatch();
    watch.observe(5, 0);
    expect(watch.ratio).toBeNull();
    expect(canSustainPlayback(watch.ratio, watch.bufferedSeconds)).toBe(false);
  });

  it("слишком короткая выборка не считается", () => {
    const watch = createDownloadRateWatch(1500);
    watch.observe(0, 0);
    watch.observe(12, 500);
    expect(watch.ratio).toBeNull();
  });

  it("считает секунды видео на секунду реального времени", () => {
    const watch = createDownloadRateWatch(1500);
    watch.observe(0, 0);
    watch.observe(15, 2000);
    expect(watch.ratio).toBeCloseTo(7.5, 3);
    expect(watch.bufferedSeconds).toBe(15);
  });

  // Канал 1,5 Мбит/с против потока 8 Мбит/с: за 10 секунд приезжает около
  // двух секунд видео. Подмена в таких условиях и давала рваную картинку.
  it("медленный канал не проходит порог", () => {
    const watch = createDownloadRateWatch(1500);
    watch.observe(10, 0);
    watch.observe(12, 10_000);
    expect(watch.ratio).toBeCloseTo(0.2, 3);
    expect(canSustainPlayback(watch.ratio, watch.bufferedSeconds)).toBe(false);
  });

  it("быстрый канал с накопленным буфером проходит порог", () => {
    const watch = createDownloadRateWatch(1500);
    watch.observe(0, 0);
    watch.observe(15, 2000);
    expect(canSustainPlayback(watch.ratio, watch.bufferedSeconds)).toBe(true);
  });

  // Одной скорости мало: короткий всплеск не должен выдаваться за устойчивый
  // канал, пока не накоплен ощутимый буфер.
  it("высокая скорость без буфера порог не проходит", () => {
    expect(canSustainPlayback(9, 4)).toBe(false);
    expect(canSustainPlayback(9, 12)).toBe(true);
  });

  it("игнорирует нечисловые показания", () => {
    const watch = createDownloadRateWatch(1500);
    watch.observe(Number.NaN, 0);
    watch.observe(0, 0);
    watch.observe(15, 2000);
    expect(watch.ratio).toBeCloseTo(7.5, 3);
  });
});

describe("переходы догрузки качественной ступени", () => {
  it("не начинает загрузку, пока стартовая ступень не в буфере целиком", () => {
    expect(nextHeroUpgradeState("idle", "quality-ready")).toBe("idle");
    expect(nextHeroUpgradeState("idle", "swap-started")).toBe("idle");
  });

  it("проходит полный путь от загрузки до подмены", () => {
    let state: HeroUpgradeState = "idle";
    state = nextHeroUpgradeState(state, "startup-fully-buffered");
    expect(state).toBe("loading");
    state = nextHeroUpgradeState(state, "quality-ready");
    expect(state).toBe("ready");
    state = nextHeroUpgradeState(state, "swap-started");
    expect(state).toBe("swapping");
    state = nextHeroUpgradeState(state, "swap-finished");
    expect(state).toBe("done");
  });

  // Подмена не мгновенна, и вкладку могут спрятать ровно между запуском
  // качественной ступени и её первым отрисованным кадром. Кадров после этого
  // не будет, значит `swap-finished` не наступит никогда — без отката
  // состояние застревало бы в `swapping` до перезагрузки страницы.
  it("прерывание подмены возвращает в ready, а не в failed", () => {
    expect(nextHeroUpgradeState("swapping", "swap-interrupted")).toBe("ready");
  });

  it("после прерывания подмену можно начать заново", () => {
    let state: HeroUpgradeState = "swapping";
    state = nextHeroUpgradeState(state, "swap-interrupted");
    state = nextHeroUpgradeState(state, "swap-started");
    expect(state).toBe("swapping");
    expect(nextHeroUpgradeState(state, "swap-finished")).toBe("done");
  });

  it("прерывание не действует на состояния, где подмена не идёт", () => {
    expect(nextHeroUpgradeState("idle", "swap-interrupted")).toBe("idle");
    expect(nextHeroUpgradeState("loading", "swap-interrupted")).toBe("loading");
    expect(nextHeroUpgradeState("ready", "swap-interrupted")).toBe("ready");
    // Завершённую подмену откатывать нечем и незачем.
    expect(nextHeroUpgradeState("done", "swap-interrupted")).toBe("done");
    expect(nextHeroUpgradeState("failed", "swap-interrupted")).toBe("failed");
  });

  it("отказ на любом шаге переводит в failed", () => {
    expect(nextHeroUpgradeState("loading", "quality-failed")).toBe("failed");
    expect(nextHeroUpgradeState("ready", "quality-failed")).toBe("failed");
    expect(nextHeroUpgradeState("swapping", "quality-failed")).toBe("failed");
  });

  // Требование фазы: отказ качественной ступени оставляет стартовую рабочей.
  // Повторная попытка отняла бы канал у играющего сейчас видео ради версии,
  // которая один раз уже не доехала.
  it("failed — терминальное состояние без повторных попыток", () => {
    expect(nextHeroUpgradeState("failed", "startup-fully-buffered")).toBe("failed");
    expect(nextHeroUpgradeState("failed", "quality-ready")).toBe("failed");
    expect(nextHeroUpgradeState("failed", "swap-started")).toBe("failed");
  });

  // `done` терминально для всего, кроме отказа: оборванный на середине файл
  // ломается уже ПОСЛЕ подмены, и тогда нужно вернуться к стартовой ступени.
  it("done — терминальное состояние для всего, кроме отказа", () => {
    expect(nextHeroUpgradeState("done", "startup-fully-buffered")).toBe("done");
    expect(nextHeroUpgradeState("done", "swap-started")).toBe("done");
    expect(nextHeroUpgradeState("done", "swap-interrupted")).toBe("done");
    expect(nextHeroUpgradeState("done", "quality-failed")).toBe("failed");
  });
});

describe("адреса ступеней", () => {
  it("выбирает рамку по признаку мобильного экрана", () => {
    expect(heroVideoSource("startup", true)).toBe(HERO_VIDEO_SOURCES.startup.mobile);
    expect(heroVideoSource("startup", false)).toBe(HERO_VIDEO_SOURCES.startup.desktop);
    expect(heroVideoSource("quality", true)).toBe(HERO_VIDEO_SOURCES.quality.mobile);
    expect(heroVideoSource("quality", false)).toBe(HERO_VIDEO_SOURCES.quality.desktop);
  });

  it("ступени лежат по разным версионированным путям", () => {
    expect(HERO_VIDEO_SOURCES.startup.desktop).toContain("/2026-08-27-startup/");
    expect(HERO_VIDEO_SOURCES.quality.desktop).toContain("/2026-08-18-2k/");
    expect(HERO_VIDEO_SOURCES.startup.desktop).not.toBe(HERO_VIDEO_SOURCES.quality.desktop);
    expect(HERO_VIDEO_SOURCES.startup.mobile).not.toBe(HERO_VIDEO_SOURCES.quality.mobile);
  });

  it("портретная и ландшафтная рамки не совпадают ни в одной ступени", () => {
    expect(HERO_VIDEO_SOURCES.startup.mobile).not.toBe(HERO_VIDEO_SOURCES.startup.desktop);
    expect(HERO_VIDEO_SOURCES.quality.mobile).not.toBe(HERO_VIDEO_SOURCES.quality.desktop);
  });
});
