"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { useHomeEntrySequence } from "@/components/home/HomeEntrySequence";
import { DURATION } from "@/lib/motion";
import { HOME_HERO_TITLE } from "@/lib/home-seo";
import {
  HERO_MOBILE_MEDIA_QUERY,
  HERO_VIDEO_SOURCES,
  createHeroMotionWatch,
  heroVideoSource,
  canSustainPlayback,
  createDownloadRateWatch,
  createStallWatch,
  isFullyBuffered,
  nextHeroUpgradeState,
  type HeroUpgradeEvent,
  type HeroUpgradeState,
  type StallWatch,
} from "@/lib/hero-video";
import type { VehicleType } from "@/types/catalog";

const VIDEO_RECOVERY_DELAY_MS = 1_000;
const MAX_VIDEO_RECOVERY_ATTEMPTS = 1;

/**
 * Упреждение при подмене ступеней. Перемотка качественной версии к нужному
 * времени не мгновенна, поэтому цель берётся впереди текущего кадра, а старт
 * ждёт, пока стартовая ступень до неё доедет. 0,4 с с запасом покрывают
 * перемотку внутри уже загруженного отрезка и остаются меньше расстояния
 * между ключевыми кадрами.
 */
const SWAP_LEAD_SECONDS = 0.4;

/** Как часто сторож проверяет, не остановилась ли качественная ступень. */
const STALL_CHECK_INTERVAL_MS = 1_000;

/** Как часто перепроверяется готовность качественной ступени к подмене. */
const QUALITY_READINESS_POLL_MS = 500;

export function Hero({ vehicleTypes }: { vehicleTypes: VehicleType[] }) {
  const handleHashClick = useHashNavClick();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const playbackAttemptRef = useRef<Promise<void> | null>(null);
  const playbackResyncAfterAttemptRef = useRef(false);
  const syncVideoPlaybackRef = useRef<() => void>(() => undefined);
  const heroIsVisibleRef = useRef(true);
  const pageIsHiddenRef = useRef(false);
  const videoFailedRef = useRef(false);
  // QA-006. `videoRef` — стартовая ступень, она же единственная до подмены.
  const qualityVideoRef = useRef<HTMLVideoElement>(null);
  const upgradeStateRef = useRef<HeroUpgradeState>("idle");
  const motionWatchRef = useRef(createHeroMotionWatch());
  const rateWatchRef = useRef(createDownloadRateWatch());
  const resumeSwapRef = useRef<() => void>(() => undefined);
  const stallWatchRef = useRef<StallWatch | null>(null);
  const [motionConfirmed, setMotionConfirmed] = useState(false);
  const [qualityVisible, setQualityVisible] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const { revealVideo, revealHeader, contentVisible } = useHomeEntrySequence();

  const advanceUpgrade = useCallback((event: HeroUpgradeEvent) => {
    const next = nextHeroUpgradeState(upgradeStateRef.current, event);
    const changed = next !== upgradeStateRef.current;
    upgradeStateRef.current = next;
    return changed;
  }, []);

  // The video is useful only while its section is on screen. Keep that state
  // in refs so every browser lifecycle event makes the same decision without
  // recreating observers or leaving a stale `videoFailed` closure behind.
  const isHeroPlaybackContextActive = useCallback(
    () => document.visibilityState === "visible" && heroIsVisibleRef.current && !pageIsHiddenRef.current,
    [],
  );

  const canPlayVideo = useCallback(
    () => isHeroPlaybackContextActive() && !videoFailedRef.current,
    [isHeroPlaybackContextActive],
  );

  // После подмены играет качественная ступень, до неё — стартовая. Пауза же
  // всегда касается обеих: если вкладку спрятали в момент перехода, играющей
  // не должна остаться ни одна.
  const activeVideo = useCallback(
    () => (upgradeStateRef.current === "done" ? qualityVideoRef.current : videoRef.current),
    [],
  );

  /**
   * Полная остановка обеих ступеней. Отдельная функция, потому что вызывается
   * из двух мест (потеря контекста воспроизведения и `pagehide`), и оба обязаны
   * откатить подмену, если она застала их на полпути.
   */
  const haltPlayback = useCallback(() => {
    // Между `play()` качественной ступени и её первым отрисованным кадром
    // проходит заметное время. Пауза в этот промежуток означает, что кадров
    // больше не будет, значит подмена не завершится сама никогда — состояние
    // навсегда осталось бы `swapping`, а возобновление выбрало бы стартовую
    // ступень. Откат в `ready` позволяет повторить попытку при возвращении.
    advanceUpgrade("swap-interrupted");
    // Штатная пауза — не зависание: сторож замирает вместе с видео.
    stallWatchRef.current?.suspend();
    videoRef.current?.pause();
    qualityVideoRef.current?.pause();
  }, [advanceUpgrade]);

  const syncVideoPlayback = useCallback(() => {
    const video = activeVideo();
    if (!video) return;

    if (!canPlayVideo()) {
      haltPlayback();
      return;
    }

    // Контекст снова активен. Если подмена была прервана, повторяем её здесь:
    // файл уже скачан, повторить нужно только выравнивание и запуск.
    if (upgradeStateRef.current === "ready") resumeSwapRef.current();
    // Отсчёт зависания начинается заново, а не продолжается с простоем,
    // накопленным за время, когда видео и не должно было двигаться.
    stallWatchRef.current?.resume(performance.now());

    // `play()` is asynchronous. Do not stack calls while a source is loading:
    // repeated play/pause pairs are a common source of AbortError noise and a
    // visibly stalled first frame when returning to the tab.
    if (!video.paused) return;

    if (playbackAttemptRef.current !== null) {
      // `play()` can reject after a lifecycle pause. If the tab or BFCache
      // page returns before that promise settles, remember one contextual
      // retry so the visible video cannot remain paused behind a stale
      // in-flight attempt. The flag is consumed before the retry starts,
      // which prevents a rejected retry from looping indefinitely.
      playbackResyncAfterAttemptRef.current = true;
      return;
    }

    const playbackAttempt = video.play();
    playbackAttemptRef.current = playbackAttempt;
    void playbackAttempt.catch(() => undefined).finally(() => {
      if (playbackAttemptRef.current !== playbackAttempt) return;

      playbackAttemptRef.current = null;
      if (!playbackResyncAfterAttemptRef.current) return;

      playbackResyncAfterAttemptRef.current = false;
      // Use the latest callback rather than closing over this callback in
      // itself. The explicit one-time flag above avoids recursive retries.
      syncVideoPlaybackRef.current();
    });
  }, [activeVideo, canPlayVideo, haltPlayback]);

  useEffect(() => {
    syncVideoPlaybackRef.current = syncVideoPlayback;
  }, [syncVideoPlayback]);

  const recoverVideo = useCallback(() => {
    if (recoveryAttemptsRef.current >= MAX_VIDEO_RECOVERY_ATTEMPTS) return;
    const video = videoRef.current;
    if (!video || !isHeroPlaybackContextActive()) return;

    recoveryAttemptsRef.current += 1;
    videoFailedRef.current = false;
    video.load();
  }, [isHeroPlaybackContextActive]);

  const handleVideoError = useCallback(() => {
    setMotionConfirmed(false);
    // Восстановление начинает воспроизведение заново, поэтому наблюдение за
    // движением тоже начинается с чистого листа: кадры до сбоя ничего не
    // подтверждают.
    motionWatchRef.current = createHeroMotionWatch();
    videoFailedRef.current = true;
    // A missing stream must never keep navigation or the page inaccessible.
    // There is intentionally no poster: the inverse base remains in place
    // while one bounded, low-pressure recovery attempt is made.
    revealHeader();

    if (recoveryAttemptsRef.current >= MAX_VIDEO_RECOVERY_ATTEMPTS || recoveryTimerRef.current !== null) return;
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      recoverVideo();
    }, prefersReducedMotion ? 0 : VIDEO_RECOVERY_DELAY_MS);
  }, [prefersReducedMotion, recoverVideo, revealHeader]);

  // Clear only on unmount. Lifecycle listeners are stable, so an error-driven
  // retry remains scheduled until it runs or a recovered `loadeddata` cancels
  // it.
  useEffect(
    () => () => {
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    },
    [],
  );

  // Заставка снимается по ПОДТВЕРЖДЁННОМУ движению, а не по `loadeddata`.
  // Прежний критерий («первый кадр декодирован») на медленной сети открывал
  // hero с неподвижной картинкой: воспроизведение так и не начиналось, а
  // заставка уже ушла. Теперь нужны и событие `playing`, и два показанных
  // кадра с разным временем внутри ролика — см. `createHeroMotionWatch`.
  // Дальше — прежний порядок: короткий проявочный переход видео заканчивается
  // под непрозрачным слоем, затем гаснет слой, и только потом появляется
  // шапка: видео → шапка → содержимое.
  useEffect(() => {
    if (!motionConfirmed) return;
    if (prefersReducedMotion) {
      revealVideo();
      revealHeader();
      return;
    }

    let videoTimer: number | undefined;
    let headerTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      videoTimer = window.setTimeout(() => {
        revealVideo();
        headerTimer = window.setTimeout(revealHeader, DURATION.base * 1000);
      }, DURATION.fast * 1000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (videoTimer !== undefined) window.clearTimeout(videoTimer);
      if (headerTimer !== undefined) window.clearTimeout(headerTimer);
    };
  }, [motionConfirmed, prefersReducedMotion, revealHeader, revealVideo]);

  // Наблюдение за реально показанными кадрами стартовой ступени.
  //
  // `requestVideoFrameCallback` сообщает о кадре, отправленном на экран, и
  // приносит его время внутри ролика — только так можно отличить «показан
  // один застывший кадр» от «пошло движение». Firefox его не поддерживает:
  // там признаком служит продвижение `currentTime`, менее точное, но
  // приходящее тоже лишь при реальном воспроизведении.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let frameHandle: number | null = null;

    const settle = (confirmed: boolean) => {
      if (confirmed && !cancelled) setMotionConfirmed(true);
    };

    // Наблюдатель читается из ref, а не захватывается: сбой видео заменяет
    // его новым, и захваченный экземпляр подтвердил бы движение по кадрам,
    // показанным ещё до сбоя.
    const markPlaying = () => {
      motionWatchRef.current.observePlaying();
      settle(motionWatchRef.current.confirmed);
    };

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (cancelled) return;
      settle(motionWatchRef.current.observeFrame(metadata.mediaTime));
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };

    const onTimeUpdate = () => {
      settle(motionWatchRef.current.observeFrame(video.currentTime));
    };

    video.addEventListener("playing", markPlaying);
    if (typeof video.requestVideoFrameCallback === "function") {
      frameHandle = video.requestVideoFrameCallback(onFrame);
    } else {
      video.addEventListener("timeupdate", onTimeUpdate);
    }

    // На тёплом повторном визите видео успевает заиграть до гидратации:
    // событие `playing` уже прошло, и ждать его второй раз бессмысленно.
    if (!video.paused && video.currentTime > 0) markPlaying();

    return () => {
      cancelled = true;
      video.removeEventListener("playing", markPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
      if (frameHandle !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameHandle);
      }
    };
  }, []);

  // Качественная ступень запрашивается только когда стартовая ЦЕЛИКОМ в
  // буфере. Если начать раньше, тяжёлый файл отберёт канал у того видео,
  // которое прямо сейчас на экране, и лечение станет болезнью. На быстрой
  // сети это доли секунды, на 1,5 Мбит/с — около четырнадцати.
  useEffect(() => {
    const startup = videoRef.current;
    if (!startup) return;

    const considerUpgrade = () => {
      if (upgradeStateRef.current !== "idle") return;
      if (!isFullyBuffered(startup.buffered, startup.duration)) return;
      if (!advanceUpgrade("startup-fully-buffered")) return;

      const quality = qualityVideoRef.current;
      if (!quality) return;
      quality.preload = "auto";
      quality.src = heroVideoSource("quality", window.matchMedia(HERO_MOBILE_MEDIA_QUERY).matches);
      quality.load();
      rateWatchRef.current.observe(0, performance.now());
      // Отсчёт скорости начинается здесь, от нулевого буфера. Если начинать
      // его с первого события `progress`, на быстром канале весь рост уже
      // произошёл: Chrome набирает 15,2 с одним махом и останавливается, все
      // последующие замеры дают нулевой прирост, и подмена не наступает
      // никогда — проверено, за 40 секунд не сдвинулось.
    };

    // `suspend` приходит, когда браузер перестал докачивать — обычно потому,
    // что файл кончился. `progress` страхует случаи, где `suspend` не пришёл.
    startup.addEventListener("progress", considerUpgrade);
    startup.addEventListener("suspend", considerUpgrade);
    considerUpgrade();

    return () => {
      startup.removeEventListener("progress", considerUpgrade);
      startup.removeEventListener("suspend", considerUpgrade);
    };
  }, [advanceUpgrade]);

  // Синхронная подмена ступеней.
  useEffect(() => {
    const quality = qualityVideoRef.current;
    const startup = videoRef.current;
    if (!quality || !startup) return;

    let cancelled = false;
    let rafHandle: number | null = null;
    let frameHandle: number | null = null;
    let releaseTimer: number | undefined;
    let pendingSeeked: (() => void) | null = null;
    let stallTimer: number | undefined;
    let stallFrameHandle: number | null = null;
    let lastQualityTime = Number.NaN;

    // Сторож зависшей качественной ступени. Возврат к стартовой был привязан
    // только к событию `error`, но поток может встать и без ошибки:
    // соединение открыто, новые байты не идут, браузер ждёт. Ошибки нет, а
    // hero замер. Отсчёт ведётся от последнего ПОКАЗАННОГО кадра, а не от
    // `play()`: абсолютный таймаут сработал бы и на исправном видео.
    const observeQualityMovement = () => {
      stallWatchRef.current?.observeMovement(performance.now());
    };

    const onQualityTimeUpdate = () => {
      // Запасной признак движения там, где нет кадровых колбэков: важно
      // именно ИЗМЕНЕНИЕ времени — событие приходит и на месте.
      if (quality.currentTime === lastQualityTime) return;
      lastQualityTime = quality.currentTime;
      observeQualityMovement();
    };

    const stopStallWatch = () => {
      if (stallTimer !== undefined) {
        window.clearInterval(stallTimer);
        stallTimer = undefined;
      }
      if (stallFrameHandle !== null && typeof quality.cancelVideoFrameCallback === "function") {
        quality.cancelVideoFrameCallback(stallFrameHandle);
        stallFrameHandle = null;
      }
      quality.removeEventListener("timeupdate", onQualityTimeUpdate);
      stallWatchRef.current = null;
    };

    // Прерванная подмена повторяется целиком, поэтому предыдущая попытка
    // должна быть разобрана до последнего слушателя: иначе второй заход
    // оставил бы висеть чужой обработчик `seeked` и параллельный цикл
    // выравнивания, которые доведут до `play()` уже неактуальную цель.
    const resetSwapAttempt = () => {
      if (pendingSeeked) {
        quality.removeEventListener("seeked", pendingSeeked);
        pendingSeeked = null;
      }
      if (rafHandle !== null) {
        window.cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      if (frameHandle !== null && typeof quality.cancelVideoFrameCallback === "function") {
        quality.cancelVideoFrameCallback(frameHandle);
        frameHandle = null;
      }
    };

    // Отказ качественной ступени. Повторять попытку нельзя: новая загрузка
    // отняла бы канал у видео, которое сейчас на экране, ради версии, которая
    // один раз уже не доехала. Поэтому `failed` — состояние терминальное.
    //
    // Отказ может прийти и ПОСЛЕ подмены: оборванный на середине файл ломается
    // не сразу — заголовок целый, длительность объявлена, весь ролик числится
    // в буфере, подмена проходит штатно, и лишь дойдя до обрыва
    // воспроизведение падает. Стартовая ступень к этому моменту уже погашена,
    // поэтому её нужно вернуть, иначе hero замирает на мёртвом кадре.
    const abandon = () => {
      resetSwapAttempt();
      const qualityWasVisible = upgradeStateRef.current === "done";
      // `failed` терминально, поэтому переход происходит ровно один раз: если
      // ошибка и сторож сработали одновременно, возврат выполнится тоже один
      // раз, а второй вызов выйдет здесь.
      if (!advanceUpgrade("quality-failed")) return;
      stopStallWatch();

      if (releaseTimer !== undefined) {
        window.clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
      quality.pause();

      if (!qualityWasVisible) return;
      // Стартовая ступень загружена целиком и стоит на паузе там, где её
      // оставили, поэтому возвращается мгновенно и без новых запросов.
      setQualityVisible(false);
      syncVideoPlaybackRef.current();
    };

    const startStallWatch = () => {
      stallWatchRef.current = createStallWatch(performance.now());
      lastQualityTime = quality.currentTime;

      if (typeof quality.requestVideoFrameCallback === "function") {
        const onFrame: VideoFrameRequestCallback = () => {
          observeQualityMovement();
          stallFrameHandle = quality.requestVideoFrameCallback(onFrame);
        };
        stallFrameHandle = quality.requestVideoFrameCallback(onFrame);
      } else {
        quality.addEventListener("timeupdate", onQualityTimeUpdate);
      }

      stallTimer = window.setInterval(() => {
        if (!stallWatchRef.current?.isStalled(performance.now())) return;
        abandon();
      }, STALL_CHECK_INTERVAL_MS);
    };

    const finishSwap = () => {
      if (cancelled) return;
      advanceUpgrade("swap-finished");
      setQualityVisible(true);
      // Сторож включается только после завершённой подмены: до неё зависание
      // качественной ступени ничем не грозит — на экране стартовая.
      startStallWatch();
      // Стартовая ступень гасится только после того, как перекрёстное
      // затухание закончилось — иначе на её месте мелькнёт пустота.
      releaseTimer = window.setTimeout(
        () => startup.pause(),
        prefersReducedMotion ? 0 : DURATION.base * 1000 + 80,
      );
    };

    const startQualityPlayback = () => {
      if (cancelled) return;
      void quality
        .play()
        .then(() => {
          if (cancelled) return;
          // Показывать качественную ступень можно только когда она реально
          // отрисовала кадр: иначе затухание откроет пустой прямоугольник.
          if (typeof quality.requestVideoFrameCallback === "function") {
            frameHandle = quality.requestVideoFrameCallback(() => finishSwap());
          } else {
            finishSwap();
          }
        })
        .catch(abandon);
    };

    const beginSwap = () => {
      if (upgradeStateRef.current !== "ready") return;
      resetSwapAttempt();
      if (!advanceUpgrade("swap-started")) return;

      const duration = startup.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        abandon();
        return;
      }

      // Обе ступени — один материал с посекундно совпадающими ключевыми
      // кадрами, поэтому подмена сводится к попаданию в одно время. Перемотка
      // занимает заметное время, за которое стартовая ступень уходит вперёд,
      // поэтому цель берётся с упреждением, а старт ждёт, пока стартовая
      // ступень до неё доедет. Без упреждения качественная ступень вступала
      // бы на доли секунды позади — это и был бы видимый скачок.
      const raw = startup.currentTime + SWAP_LEAD_SECONDS;
      const wraps = raw >= duration;
      const target = wraps ? raw - duration : raw;

      const onSeeked = () => {
        quality.removeEventListener("seeked", onSeeked);
        pendingSeeked = null;
        if (cancelled) return;

        let previousTime = startup.currentTime;
        let seenWrap = false;
        const waitForAlignment = () => {
          if (cancelled) return;
          const now = startup.currentTime;
          // Ролик зациклен: резкое падение времени означает, что круг
          // начался заново, и только после этого цель за границей цикла
          // становится достижимой.
          if (now < previousTime - 1) seenWrap = true;
          previousTime = now;

          if ((!wraps || seenWrap) && now >= target) {
            startQualityPlayback();
            return;
          }
          rafHandle = window.requestAnimationFrame(waitForAlignment);
        };
        waitForAlignment();
      };

      pendingSeeked = onSeeked;
      quality.addEventListener("seeked", onSeeked);
      quality.currentTime = target;
    };

    // Возобновление после прерванной подмены идёт через `syncVideoPlayback` —
    // единственную точку, куда сходятся все изменения контекста
    // воспроизведения (видимость вкладки, page cache, уход hero с экрана).
    resumeSwapRef.current = beginSwap;

    // Момент подмены определяется измеренной скоростью загрузки, и это третья
    // попытка после двух неудачных.
    //
    // `canplaythrough` не годится: браузер оптимистичен, и на канале 1,5
    // Мбит/с подмена по нему происходила при недокачанном файле — дальше
    // качественная ступень спотыкалась почти непрерывно (измерено 19 провалов
    // показа и 19 событий ожидания после подмены).
    //
    // «Файл целиком в буфере» не годится тем более: этого не наступает
    // никогда. Приостановленному `<video>` Chrome докачивает 15,23 с из 25,42
    // и останавливается до начала воспроизведения — проверено, буфер не
    // сдвинулся за 60 секунд наблюдения, и подмена не происходила вовсе.
    //
    // Работает прямое измерение: сколько секунд видео приезжает за секунду
    // реального времени. Больше полутора — поток обгоняет воспроизведение с
    // запасом; меньше — споткнётся, сколько ни жди, и тогда правильное
    // поведение это остаться на стартовой ступени.
    const considerQualityReady = () => {
      if (upgradeStateRef.current !== "loading") return;
      const rateWatch = rateWatchRef.current;
      const buffered = quality.buffered;
      rateWatch.observe(
        buffered.length > 0 ? buffered.end(buffered.length - 1) : 0,
        performance.now(),
      );
      if (!canSustainPlayback(rateWatch.ratio, rateWatch.bufferedSeconds)) return;
      if (!advanceUpgrade("quality-ready")) return;
      beginSwap();
    };

    // Опрос вместо одной лишь подписки на события. Если весь буфер приезжает
    // раньше, чем набирается минимальная выборка для замера скорости, все
    // события `progress` укладываются в это окно, а `suspend` не приходит
    // вовсе — ответ ведь не завершён. Тогда решение о подмене не принималось
    // никогда: проверено на ответе, который отдал 20 МБ за 258 мс и остался
    // открытым. Опрос снимает зависимость от того, какие события браузер
    // решит прислать, и сам прекращается, как только стадия загрузки пройдена.
    const readinessPoll = window.setInterval(() => {
      if (upgradeStateRef.current === "idle" || upgradeStateRef.current === "loading") {
        considerQualityReady();
        return;
      }
      window.clearInterval(readinessPoll);
    }, QUALITY_READINESS_POLL_MS);

    quality.addEventListener("progress", considerQualityReady);
    quality.addEventListener("suspend", considerQualityReady);
    quality.addEventListener("canplaythrough", considerQualityReady);
    quality.addEventListener("error", abandon);

    return () => {
      cancelled = true;
      resumeSwapRef.current = () => undefined;
      quality.removeEventListener("progress", considerQualityReady);
      quality.removeEventListener("suspend", considerQualityReady);
      quality.removeEventListener("canplaythrough", considerQualityReady);
      quality.removeEventListener("error", abandon);
      window.clearInterval(readinessPoll);
      resetSwapAttempt();
      stopStallWatch();
      if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
    };
  }, [advanceUpgrade, prefersReducedMotion]);

  // The backdrop is fixed, but it does not need to keep decoding beneath the
  // rest of the page. A single gate handles document visibility, BFCache
  // restoration, and Hero intersection so the video resumes promptly only
  // when a person can see it.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const recoverOrSyncPlayback = () => {
      if (isHeroPlaybackContextActive() && videoFailedRef.current) {
        recoverVideo();
      } else {
        syncVideoPlayback();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        heroIsVisibleRef.current = entry.isIntersecting;
        recoverOrSyncPlayback();
      },
      // A frame must keep playing until the Hero is actually gone. This
      // prevents a briefly visible final strip of video from looking frozen.
      { threshold: 0 },
    );

    const pauseForPageHide = () => {
      pageIsHiddenRef.current = true;
      // Обе ступени, и с откатом незавершённой подмены — см. haltPlayback.
      haltPlayback();
    };

    const resumeAfterPageShow = () => {
      pageIsHiddenRef.current = false;
      recoverOrSyncPlayback();
    };

    observer.observe(section);
    document.addEventListener("visibilitychange", recoverOrSyncPlayback);
    window.addEventListener("pageshow", resumeAfterPageShow);
    window.addEventListener("pagehide", pauseForPageHide);
    syncVideoPlayback();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", recoverOrSyncPlayback);
      window.removeEventListener("pageshow", resumeAfterPageShow);
      window.removeEventListener("pagehide", pauseForPageHide);
    };
  }, [haltPlayback, isHeroPlaybackContextActive, recoverVideo, syncVideoPlayback]);

  // Not a plain scrollIntoView({block: "start"}) — that aligns the next
  // section's top edge with the very top of the viewport, but the sticky
  // Header (h-16 = 64px) then sits on top of that edge and overlaps into
  // the section, eating its top spacing. Offsetting by the header's height
  // keeps the header's bottom edge flush with the section's top instead.
  const scrollToNextSection = (event?: React.MouseEvent) => {
    event?.preventDefault();
    const target = sectionRef.current?.nextElementSibling;
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  return (
    <section ref={sectionRef} className="relative flex min-h-[calc(100svh-4rem)] items-end">
      {/* Fixed backdrop: the video stays pinned to the viewport while the page scrolls over it.
          `inset-0` instead of `top-0 h-dvh` — a fixed element's box already tracks the visual
          viewport natively, so this needs no explicit height. Sizing it off `dvh` instead made
          the browser recompute (and repaint) this full-screen layer on every tick of the
          address-bar show/hide animation during mobile scroll, which read as jitter/flicker. */}
      <div className="fixed inset-0 -z-10 bg-inverse">
        {/* Стартовая ступень (QA-006). Лёгкая версия 1280x720 / 720x1280 весом
            2,5–2,7 МБ: на канале около 1,5 Мбит/с она начинает двигаться за
            0,55 с и доигрывает круг без провалов показа, тогда как одна лишь
            качественная ступень в тех же условиях не запускалась вовсе.
            `preload="metadata"` — ровно то, на чём измерялось; браузер всё
            равно докачивает файл по ходу воспроизведения. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => {
            // A recovered stream can decode before its scheduled retry runs.
            // Cancel that retry so `load()` cannot restart a healthy playback.
            if (recoveryTimerRef.current !== null) {
              window.clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = null;
            }
            videoFailedRef.current = false;
            recoveryAttemptsRef.current = 0;
            // Заставку это событие больше не снимает: декодированный кадр не
            // означает воспроизведения. Оно лишь подтверждает, что поток жив.
            syncVideoPlayback();
          }}
          // There is intentionally no static poster. If the CDN stream fails,
          // do not leave navigation and content inaccessible behind a blank
          // video layer; the site can still be used while the browser retries.
          onError={handleVideoError}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-fast ${motionConfirmed ? "opacity-100" : "opacity-0"}`}
        >
          <source src={HERO_VIDEO_SOURCES.startup.mobile} type="video/mp4" media={HERO_MOBILE_MEDIA_QUERY} />
          <source src={HERO_VIDEO_SOURCES.startup.desktop} type="video/mp4" />
        </video>
        {/* Качественная ступень: настоящий 2K (2560x1440 / 1440x2560) для всех
            экранов. Источник не объявляется разметкой намеренно — файл должен
            запрашиваться не сразу, а только когда стартовая ступень целиком в
            буфере, иначе он отберёт у неё канал. Адрес проставляется кодом,
            рамка выбирается тем же медиавыражением, что и у стартовой. */}
        <video
          ref={qualityVideoRef}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-base ${qualityVisible ? "opacity-100" : "opacity-0"}`}
        />
        {/* Directional gradient instead of a flat overlay: the top of the video
            stays bright (sky, the truck itself), darkening only toward the
            bottom where the text sits — guarantees contrast there regardless
            of what's in that part of the frame, without dimming the whole shot. */}
        <div className="absolute inset-0 bg-gradient-to-t from-inverse/90 via-inverse/35 to-transparent" />
        {/* This gradient fades to nothing right at the top, so the transparent
            Header's white logo/nav text — sitting directly on the video up
            there — has no guaranteed contrast of its own. A second, short
            top-anchored gradient covers just that strip without touching how
            bright the rest of the video reads. */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-inverse/55 to-transparent sm:h-28" />
      </div>

      {/* Появление первого экрана — CSS-анимация, а не варианты framer-motion.
          Заголовок здесь почти наверняка LCP-элемент, а у Framer он стартует
          с opacity: 0 и становится виден только после гидратации: сначала
          загрузка и исполнение JS, и лишь потом появление. Класс же работает
          с первого отрисованного кадра. Задержки заменяют каскад вариантов,
          `prefers-reduced-motion` глушится общим правилом в globals.css. */}
      <Container
        aria-hidden={!contentVisible}
        className={`pb-24 transition-[opacity,translate] duration-reveal ease-ui sm:pb-28 lg:pb-32 ${contentVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <div inert={!contentVisible} className="max-w-2xl">
          <h1 className="animate-fade-up text-shadow-md text-balance text-3xl font-bold tracking-tight text-inverse-foreground sm:text-4xl lg:text-5xl">
            {HOME_HERO_TITLE}
          </h1>
          {vehicleTypes.length > 0 && (
            <div
              className="mt-6 flex animate-fade-up flex-wrap items-center gap-2 text-shadow-sm text-xl font-medium text-inverse-foreground-muted [animation-delay:60ms]"
            >
              {vehicleTypes.map((vehicleType, i) => (
                <span key={vehicleType.slug} className="flex items-center gap-2">
                  {i > 0 && <span className="text-inverse-foreground-subtle">/</span>}
                  <Link
                    href={`/catalog/vehicle-type/${vehicleType.slug}`}
                    className="transition-colors hover:text-primary"
                  >
                    {vehicleType.name}
                  </Link>
                </span>
              ))}
            </div>
          )}

          <form
            action="/catalog"
            method="GET"
            className="mt-12 flex w-full max-w-lg animate-fade-up items-center gap-2 rounded-lg border border-input bg-card p-1.5 shadow-sm [animation-delay:120ms] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <Search aria-hidden="true" className="ml-2 h-5 w-5 shrink-0 text-faint-foreground" />
            <input
              type="text"
              name="q"
              aria-label="Поиск по каталогу"
              autoComplete="off"
              placeholder="Например: гидроцилиндр HOWO…"
              className="h-10 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-faint-foreground"
            />
            <Button type="submit" size="lg" className="shrink-0">
              Найти
            </Button>
          </form>

          {/* flex-nowrap + shrinking padding/text (not flex-wrap) — on narrow
              phones these two buttons should stay side by side and shrink
              together rather than the second one dropping to its own line. */}
          <div className="mt-6 flex animate-fade-up flex-nowrap gap-2 [animation-delay:180ms] sm:gap-3">
            <Button
              href="/#categories"
              size="lg"
              className="min-w-0 flex-1 px-3 text-sm whitespace-nowrap sm:flex-initial sm:px-6 sm:text-base"
              onClick={(event) => handleHashClick("/#categories", event)}
            >
              Перейти в каталог
            </Button>
            <Button
              href="/#brands"
              variant="secondary"
              size="lg"
              className="min-w-0 flex-1 px-3 text-sm whitespace-nowrap sm:flex-initial sm:px-6 sm:text-base"
              onClick={(event) => handleHashClick("/#brands", event)}
            >
              Марки техники
            </Button>
          </div>
        </div>
      </Container>

      {/* Покачивание — CSS-ключевые кадры, а не бесконечный animate у Framer:
          тот держал rAF-цикл на главном потоке всё время, пока открыта
          главная, в том числе когда первый экран уже прокручен. Обёртка нужна,
          чтобы центрирование (`-translate-x-1/2`) и анимация не спорили за
          свойство `translate`. */}
      <div
        aria-hidden={!contentVisible}
        inert={!contentVisible}
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 transition-[opacity,translate] duration-reveal ease-ui ${contentVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <button
          type="button"
          onClick={scrollToNextSection}
          aria-label="Прокрутить вниз"
          className="animate-nudge-down rounded-full p-2.5 text-inverse-foreground/80 transition-colors duration-fast ease-ui hover:text-inverse-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-inverse"
        >
          <ChevronDown aria-hidden="true" className="h-8 w-8" />
        </button>
      </div>
    </section>
  );
}
