import Link from "next/link";
import {
  SHOWCASE_CARD_CLASS,
  SHOWCASE_CAROUSEL_FRAME_CLASS,
  SHOWCASE_CAROUSEL_MASK_CLASS,
  SHOWCASE_CAROUSEL_ROW_CLASS,
  SHOWCASE_GRID_CLASS,
  SHOWCASE_HINT_CLASS,
  SHOWCASE_LABEL_CLASS,
  SHOWCASE_STAGE_CLASS,
} from "./showcase-geometry";
import type { VehicleVisual } from "./vehicle-visual";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

interface VehicleShowcaseShellProps {
  entries: VehicleShowcaseEntry[];
  visuals: Record<string, VehicleVisual>;
  defaultSlug: string;
}

/**
 * Полезная статическая витрина в исходном HTML.
 *
 * Это Server Component: он не добавляет ни байта клиентского JS и остаётся на
 * экране, пока интерактивный чанк не подъехал — а если тот вообще не
 * загрузится, остаётся навсегда. Поэтому здесь есть заголовок техники, её
 * фотография и настоящие ссылки в каталог, а не пустой прямоугольник.
 *
 * Размеры берутся из showcase-geometry вместе с интерактивной версией, чтобы
 * подмена не сдвинула ни одного блока (CLS остаётся нулевым).
 *
 * Фотография — один <picture>: браузер выбирает ровно один файл по
 * медиавыражению, поэтому мобильный и десктопный варианты никогда не
 * запрашиваются одновременно, а фотографии остальных машин не запрашиваются
 * вовсе — их показывает уже интерактивная карусель.
 */
export function VehicleShowcaseShell({ entries, visuals, defaultSlug }: VehicleShowcaseShellProps) {
  const defaultIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.vehicleType.slug === defaultSlug),
  );
  const entry = entries[defaultIndex];
  const visual = visuals[entry?.vehicleType.slug ?? ""];
  if (!entry || !visual) return null;

  const scale = visual.scale ?? 1;
  const desktopScale = visual.desktopScale ?? scale;
  const others = entries.filter((candidate) => candidate.vehicleType.slug !== entry.vehicleType.slug);

  return (
    <>
      <p className={SHOWCASE_LABEL_CLASS}>{entry.vehicleType.name}</p>

      <div className={SHOWCASE_GRID_CLASS}>
        <div className={SHOWCASE_STAGE_CLASS}>
          <picture>
            <source media="(min-width: 1024px)" srcSet={visual.image} type="image/webp" />
            {/* Обычный <img> внутри <picture>, а не next/image: файлы и так
                заранее сконвертированы и отдаются напрямую (интерактив
                использует их с `unoptimized`), а <picture> выбирает ровно один
                вариант по медиавыражению вообще без клиентского JS. */}
            <img
              src={visual.imageMobile ?? visual.image}
              alt={entry.vehicleType.name}
              width={visual.naturalWidth}
              height={visual.naturalHeight}
              // Витрина начинается ровно под первым экраном, поэтому её фото
              // не должно соперничать за канал с hero-видео: браузер загрузит
              // его, когда секция начнёт приближаться — то есть тогда же,
              // когда за интерактивом поедет его чанк.
              loading="lazy"
              decoding="async"
              data-vehicle-shell-image
              className="absolute inset-0 h-full w-full object-contain"
              style={
                {
                  "--vehicle-shell-scale": scale,
                  "--vehicle-shell-scale-lg": desktopScale,
                } as React.CSSProperties
              }
            />
          </picture>
        </div>

        <div className={SHOWCASE_CARD_CLASS}>
          <div className={SHOWCASE_HINT_CLASS}>
            <p className="text-4xl font-bold text-white/10 tabular-nums">
              01—{String(entry.hotspots.length).padStart(2, "0")}
            </p>
            <p className="text-sm text-slate-400">
              Точки на технике показывают, какое гидрооборудование ей подходит.
            </p>
            <Link
              href={`/catalog/vehicle-type/${entry.vehicleType.slug}`}
              className="mt-1 inline-flex w-fit min-h-11 items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-[background-color,scale] duration-fast ease-ui hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Запчасти для «{entry.vehicleType.name}»
            </Link>
          </div>
        </div>
      </div>

      <div className={SHOWCASE_CAROUSEL_ROW_CLASS}>
        <div className={SHOWCASE_CAROUSEL_FRAME_CLASS}>
          {/* Та же высота, что у ленты миниатюр, но без единой картинки:
              фотографии остальных машин не должны попадать в первую загрузку. */}
          <div className={`${SHOWCASE_CAROUSEL_MASK_CLASS} flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4`}>
            {others.map((candidate) => (
              <Link
                key={candidate.vehicleType.slug}
                href={`/catalog/vehicle-type/${candidate.vehicleType.slug}`}
                className="rounded-md px-1 text-sm font-medium text-slate-400 transition-colors duration-fast ease-ui hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {candidate.vehicleType.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
