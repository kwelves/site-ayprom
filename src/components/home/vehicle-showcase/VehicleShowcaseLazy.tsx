"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { SHOWCASE_ROOT_CLASS } from "./showcase-geometry";
import type { VehicleVisual } from "./vehicle-visual";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

/**
 * Запас, на который наблюдатель «видит» секцию заранее.
 *
 * Здесь он обязан быть нулевым, и это не осторожность, а геометрия главной:
 * hero занимает ровно `100svh - 4rem` под шапкой той же высоты, поэтому
 * витрина начинается ТОЧНО на нижней границе первого экрана — на любой
 * ширине и высоте окна. Любой положительный нижний запас означал бы
 * «пересекается всегда», и чанк снова уезжал бы в первоначальную загрузку
 * (проверено: с запасом 600px он приходил при scrollY = 0 вместе с пятью
 * миниатюрами карусели). С нулевым запасом загрузка начинается с первым же
 * движением к витрине, а до этого работает статическая заглушка.
 */
const APPROACH_MARGIN = "0px";

interface VehicleShowcaseLazyProps {
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
  /** Статическая витрина из Server Component — то, что видно до загрузки. */
  children: React.ReactNode;
}

type InteractiveComponent = ComponentType<{
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
}>;

/**
 * Клиентский наблюдатель, который включает витрину.
 *
 * Обычного `next/dynamic` в Server Component недостаточно: фабрика импорта
 * вызывается при первом рендере, то есть чанк уезжает в первоначальную
 * загрузку. Здесь `import()` вызывается буквально из обработчика
 * IntersectionObserver, поэтому до приближения секции запроса за чанком нет
 * вовсе — это видно в Network.
 *
 * Пока интерактив не загружен (и если он не загрузится никогда), на экране
 * остаётся полезная статическая витрина со ссылками. Обёртка одна и та же:
 * этот div несёт ровно те же классы, что корневой div интерактива, поэтому
 * подмена не добавляет и не убирает ни одного узла раскладки.
 */
export function VehicleShowcaseLazy({ entries, visuals, defaultSlug, children }: VehicleShowcaseLazyProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [approached, setApproached] = useState(false);
  const [Interactive, setInteractive] = useState<InteractiveComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const node = anchorRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // Движок без наблюдателя не должен остаться со статической витриной
      // навсегда — там интерактив просто включается сразу. Микрозадача, а не
      // синхронный setState в теле эффекта.
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setApproached(true);
      });
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        setApproached(true);
      },
      { rootMargin: APPROACH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!approached) return;

    let cancelled = false;
    import("./VehicleShowcaseInteractive")
      .then((module) => {
        if (!cancelled) setInteractive(() => module.VehicleShowcaseInteractive);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [approached, attempt]);

  if (Interactive) {
    return <Interactive entries={entries} visuals={visuals} defaultSlug={defaultSlug} />;
  }

  return (
    <div ref={anchorRef} className={SHOWCASE_ROOT_CLASS}>
      {children}
      {failed && (
        // Абсолютная позиция намеренно: повторная попытка не должна менять
        // высоту секции, иначе неудачная загрузка сама стала бы источником
        // сдвига раскладки.
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}
          className="absolute top-0 right-0 z-20 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-fast ease-ui hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Загрузить витрину
        </button>
      )}
    </div>
  );
}
