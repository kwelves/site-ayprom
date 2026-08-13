"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, type Transition } from "framer-motion";

// Архив вне общего словаря движения: пружина жила в @/lib/motion, но там
// осталась без пользователей после перевода карточек на CSS-hover, поэтому
// переехала сюда как есть — поведение архива не меняется.
const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 22 };

const MotionLink = motion.create(Link);

interface VehiclePlacement {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  rotateDeg?: number;
  flipX?: boolean;
}

interface ShadowSpec {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  opacity: number;
  blurPx: number;
  rotateDeg: number;
}

interface VehicleShowcaseCardProps {
  href: string;
  image: string;
  name: string;
  nativeWidth: number;
  nativeHeight: number;
  placement: VehiclePlacement;
  shadows: ShadowSpec[];
  floatDelay?: number;
}

export function VehicleShowcaseCard({
  href,
  image,
  name,
  nativeWidth,
  nativeHeight,
  placement,
  shadows,
  floatDelay = 0,
}: VehicleShowcaseCardProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="h-full transform-gpu"
      animate={shouldReduceMotion ? undefined : { y: [0, -3, 0] }}
      transition={
        shouldReduceMotion
          ? undefined
          : {
              y: {
                duration: 5.8,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
                delay: -floatDelay,
              },
            }
      }
    >
      <MotionLink
        href={href}
        className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-white/70 bg-card/95 shadow-[0_22px_50px_-24px_rgba(0,0,0,0.95),0_10px_24px_-16px_rgba(0,0,0,0.85)] ring-1 ring-white/20 backdrop-blur-[2px] transition-[border-color,box-shadow] hover:z-10 hover:border-blue-300 hover:shadow-[0_30px_65px_-24px_rgba(0,0,0,1),0_16px_30px_-14px_rgba(13,87,200,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        whileHover={shouldReduceMotion ? undefined : { scale: 1.04, y: -6 }}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
        transition={springSnappy}
      >
        <div className="relative isolate aspect-4/3 w-full shrink-0 bg-muted/40">
          {shadows.map((shadow, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full"
              style={{
                left: `${shadow.leftPct}%`,
                top: `${shadow.topPct}%`,
                width: `${shadow.widthPct}%`,
                height: `${shadow.heightPct}%`,
                opacity: shadow.opacity,
                filter: `blur(${shadow.blurPx}px)`,
                backgroundColor: "#000",
                transform: `rotate(${shadow.rotateDeg}deg)`,
                zIndex: 0,
              }}
            />
          ))}

          <Image
            src={image}
            alt={name}
            width={nativeWidth}
            height={nativeHeight}
            sizes="(max-width: 639px) 90vw, (max-width: 1023px) 45vw, 23vw"
            className="pointer-events-none absolute max-w-none"
            style={{
              left: `${placement.leftPct}%`,
              top: `${placement.topPct}%`,
              width: `${placement.widthPct}%`,
              height: `${placement.heightPct}%`,
              transform:
                [
                  placement.flipX ? "scaleX(-1)" : "",
                  placement.rotateDeg ? `rotate(${placement.rotateDeg}deg)` : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
              transformOrigin: placement.flipX ? "center" : "top left",
              zIndex: 1,
            }}
          />
        </div>

        <div className="px-4 py-3.5 text-center">
          <span className="text-sm font-medium text-card-foreground">{name}</span>
        </div>
      </MotionLink>
    </motion.div>
  );
}
