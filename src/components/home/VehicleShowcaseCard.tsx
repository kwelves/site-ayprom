"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

const MotionLink = motion.create(Link);
const hoverTransition = {
  type: "spring" as const,
  stiffness: 700,
  damping: 40,
  mass: 0.35,
};

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
}

export function VehicleShowcaseCard({
  href,
  image,
  name,
  nativeWidth,
  nativeHeight,
  placement,
  shadows,
}: VehicleShowcaseCardProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <MotionLink
      href={href}
      className="group relative z-0 flex h-full transform-gpu flex-col overflow-hidden rounded-xl border border-white/65 bg-card/90 shadow-[0_22px_50px_-24px_rgba(0,0,0,0.95),0_10px_24px_-16px_rgba(0,0,0,0.85)] ring-1 ring-white/20 backdrop-blur-[4px] transition-colors duration-150 will-change-transform hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.025, y: -4 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      transition={hoverTransition}
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
          sizes="(max-width: 1023px) 45vw, 25vw"
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

      <div className="px-2 py-3 text-center sm:px-4 sm:py-3.5">
        <span className="text-xs font-medium text-card-foreground sm:text-sm">{name}</span>
      </div>
    </MotionLink>
  );
}
