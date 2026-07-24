"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { springSnappy } from "@/lib/motion";

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
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:z-10 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      whileHover={shouldReduceMotion ? undefined : { scale: 1.05, y: -4 }}
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
  );
}
