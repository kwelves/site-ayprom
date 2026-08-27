/**
 * QA-006: hero состоит из двух ступеней, и вся логика перехода между ними
 * живёт здесь, а не в компоненте — иначе её нельзя проверить без браузера.
 *
 * Почему две ступени. Качественная версия весит 22–25 МБ и требует
 * 7–8 Мбит/с. На канале около 1,5 Мбит/с браузер успевает декодировать один
 * кадр и замирает: воспроизведение не начинается вовсе — измерено, ровно
 * один отрисованный кадр за 40 секунд наблюдения. Лёгкая стартовая версия
 * (2,5–2,7 МБ) в тех же условиях начинает двигаться за 0,54–0,83 с и
 * доигрывает круг без единого провала показа.
 *
 * Порядок принципиален: сначала стартовая ступень, и только когда она
 * ЦЕЛИКОМ в буфере — фоновая загрузка качественной. Если начать раньше,
 * тяжёлая ступень отберёт канал у той, которая прямо сейчас на экране, и
 * лечение станет болезнью.
 */

const STORAGE_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-media/hero`;

/**
 * Одна строка на оба места, где выбирается рамка: `media` у `<source>`
 * стартовой ступени и `matchMedia` при выборе качественной. Разъехавшись,
 * они дали бы подмену портретного видео ландшафтным — то есть буквально
 * другую композицию кадра.
 */
export const HERO_MOBILE_MEDIA_QUERY = "(max-width: 767px)";

export const HERO_VIDEO_SOURCES = {
  startup: {
    desktop: `${STORAGE_PREFIX}/2026-08-27-startup/hero-startup-desktop.mp4`,
    mobile: `${STORAGE_PREFIX}/2026-08-27-startup/hero-startup-mobile.mp4`,
  },
  quality: {
    desktop: `${STORAGE_PREFIX}/2026-08-18-2k/hero-background-desktop.mp4`,
    mobile: `${STORAGE_PREFIX}/2026-08-18-2k/hero-background-mobile.mp4`,
  },
} as const;

export type HeroVideoTier = keyof typeof HERO_VIDEO_SOURCES;

export function heroVideoSource(tier: HeroVideoTier, isMobile: boolean): string {
  return HERO_VIDEO_SOURCES[tier][isMobile ? "mobile" : "desktop"];
}

/**
 * Подтверждение реального движения.
 *
 * Прежний hero снимал заставку по `loadeddata` — это всего лишь «первый кадр
 * декодирован». Именно поэтому на медленной сети заставка уходила, открывая
 * неподвижную картинку. Здесь требуются два независимых признака: событие
 * `playing` и ДВА показанных кадра с разным временем внутри ролика. Один кадр
 * движением не является по определению.
 */
export interface HeroMotionWatch {
  /** Отмечает событие `playing`. */
  observePlaying(): void;
  /**
   * Отмечает показанный кадр (`mediaTime` из requestVideoFrameCallback либо
   * `currentTime` из `timeupdate` там, где первого нет).
   * Возвращает true в тот момент, когда движение впервые подтверждено.
   */
  observeFrame(mediaTime: number): boolean;
  readonly confirmed: boolean;
}

/** Меньше этого расхождения — тот же кадр, показанный повторно. */
const SAME_FRAME_EPSILON = 1e-4;

export function createHeroMotionWatch(): HeroMotionWatch {
  let playing = false;
  let firstMediaTime: number | null = null;
  let moved = false;
  let confirmed = false;

  const settle = () => {
    if (confirmed || !playing || !moved) return false;
    confirmed = true;
    return true;
  };

  return {
    observePlaying() {
      playing = true;
      settle();
    },
    observeFrame(mediaTime: number) {
      if (!Number.isFinite(mediaTime)) return false;
      if (firstMediaTime === null) {
        firstMediaTime = mediaTime;
        return false;
      }
      // Ролик зациклен, поэтому переход 25,4 → 0 — тоже движение: сравнение
      // идёт по модулю разницы, а не по «стало больше».
      if (Math.abs(mediaTime - firstMediaTime) > SAME_FRAME_EPSILON) moved = true;
      return settle();
    },
    get confirmed() {
      return confirmed;
    },
  };
}

/**
 * Состояние фоновой догрузки качественной ступени.
 *
 * `failed` — терминальное состояние: если качественная ступень не пришла,
 * повторять попытки нельзя. Стартовая в этот момент играет, и любая новая
 * загрузка отняла бы у неё канал ради версии, которая уже один раз не
 * доехала. Требование фазы прямо говорит: отказ качественной ступени
 * оставляет стартовую рабочей.
 */
export type HeroUpgradeState = "idle" | "loading" | "ready" | "swapping" | "done" | "failed";

export type HeroUpgradeEvent =
  | "startup-fully-buffered"
  | "quality-ready"
  | "quality-failed"
  | "swap-started"
  | "swap-finished";

const TRANSITIONS: Record<HeroUpgradeState, Partial<Record<HeroUpgradeEvent, HeroUpgradeState>>> = {
  idle: { "startup-fully-buffered": "loading" },
  loading: { "quality-ready": "ready", "quality-failed": "failed" },
  ready: { "swap-started": "swapping", "quality-failed": "failed" },
  swapping: { "swap-finished": "done", "quality-failed": "failed" },
  done: {},
  failed: {},
};

export function nextHeroUpgradeState(state: HeroUpgradeState, event: HeroUpgradeEvent): HeroUpgradeState {
  return TRANSITIONS[state][event] ?? state;
}

/**
 * Качественная ступень запрашивается только когда стартовая уже целиком в
 * буфере. `buffered` может состоять из нескольких кусков, поэтому смотрим на
 * конец последнего, а не на его количество.
 */
export function isFullyBuffered(buffered: TimeRanges, duration: number, tolerance = 0.5): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) return false;
  return buffered.end(buffered.length - 1) >= duration - tolerance;
}

/**
 * Скорость загрузки качественной ступени в долях реального времени.
 *
 * Момент подмены нельзя брать ни из `canplaythrough` (браузер оптимистичен: на
 * медленном канале подмена по нему происходила при недокачанном файле, и
 * дальше видео спотыкалось почти непрерывно), ни из «файл целиком в буфере» —
 * этого не наступает никогда: приостановленному `<video>` Chrome докачивает
 * около 15 секунд из 25 и останавливается до начала воспроизведения.
 *
 * Работающий признак измеряется напрямую: сколько СЕКУНД ВИДЕО приезжает за
 * секунду реального времени. Больше единицы — поток обгоняет воспроизведение и
 * не споткнётся; меньше — споткнётся обязательно, сколько ни жди.
 */
export interface DownloadRateWatch {
  /** Принимает конец буфера (в секундах видео) и момент времени (в мс). */
  observe(bufferedEnd: number, atMs: number): void;
  /** Секунд видео за секунду реального времени; null — выборка ещё мала. */
  readonly ratio: number | null;
  readonly bufferedSeconds: number;
}

// Окно выборки намеренно короткое. На быстром канале Chrome набирает свои
// 15 секунд буфера меньше чем за секунду, после чего шлёт `suspend` и события
// прекращаются: при окне в полторы секунды измерение не успевало состояться
// вовсе, и подмена не происходила даже на гигабитном канале — проверено, за
// 40 секунд не сдвинулось. Порог отношения при этом не смягчён: отношение
// считается от момента запроса файла, то есть это средняя скорость за всё
// время загрузки, а не мгновенный всплеск.
export function createDownloadRateWatch(minSampleMs = 250): DownloadRateWatch {
  let firstAt: number | null = null;
  let firstBuffered = 0;
  let ratio: number | null = null;
  let bufferedSeconds = 0;

  return {
    observe(bufferedEnd: number, atMs: number) {
      if (!Number.isFinite(bufferedEnd) || !Number.isFinite(atMs)) return;
      bufferedSeconds = bufferedEnd;
      if (firstAt === null) {
        firstAt = atMs;
        firstBuffered = bufferedEnd;
        return;
      }
      const elapsedMs = atMs - firstAt;
      if (elapsedMs < minSampleMs) return;
      ratio = (bufferedEnd - firstBuffered) / (elapsedMs / 1000);
    },
    get ratio() {
      return ratio;
    },
    get bufferedSeconds() {
      return bufferedSeconds;
    },
  };
}

/**
 * Подменять ступень безопасно, когда загрузка обгоняет воспроизведение с
 * запасом И уже накоплен ощутимый буфер. Одного запаса по скорости мало:
 * короткий всплеск скорости не должен выдаваться за устойчивый канал.
 */
export function canSustainPlayback(
  ratio: number | null,
  bufferedSeconds: number,
  minRatio = 1.5,
  minBufferedSeconds = 10,
): boolean {
  if (ratio === null) return false;
  return ratio >= minRatio && bufferedSeconds >= minBufferedSeconds;
}
