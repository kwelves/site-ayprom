"use client";

import { motion } from "framer-motion";
import { DURATION } from "@/lib/motion";

// Compact, always-pinned recreation of Aceternity's "Lamp" beam-cluster —
// twin conic beams + glow orb + core line converging on a fixed point,
// scaled down to sit under a thumbnail strip instead of a full hero, with no
// mount/expand animation (unlike the original's whileInView grow-in). Only
// state it reacts to is `dimmed`, mirroring the old ActiveLamp's drag-dim
// behavior. Click-driven switches leave this fixed selection landmark on.
const BEAM_BLUE = "#1474ff";
const GLOW_BLUE = "#5e98ff";

export function CarouselLamp({ dimmed }: { dimmed: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex h-16 justify-center">
      <motion.div
        className="relative h-full w-[70px] sm:w-64"
        style={{ isolation: "isolate" }}
        initial={false}
        animate={{ opacity: dimmed ? 0 : 1 }}
        transition={{ duration: DURATION.slow }}
      >
        <div
          className="absolute bottom-0 left-1/2 h-full w-[35px] -translate-x-full sm:w-32"
          style={{
            background: `conic-gradient(from 70deg at right bottom, transparent, ${BEAM_BLUE}66, transparent)`,
            maskImage: "linear-gradient(to top, black, transparent)",
            WebkitMaskImage: "linear-gradient(to top, black, transparent)",
          }}
        />
        <div
          className="absolute bottom-0 left-1/2 h-full w-[35px] sm:w-32"
          style={{
            background: `conic-gradient(from -70deg at left bottom, transparent, ${BEAM_BLUE}66, transparent)`,
            maskImage: "linear-gradient(to top, black, transparent)",
            WebkitMaskImage: "linear-gradient(to top, black, transparent)",
          }}
        />
      </motion.div>

      {/* "Лампа" (glow orb + bright core line) — mobile keeps only the
          conic-beam "свечение" above, no lamp, per explicit request. */}
      <motion.span
        className="absolute bottom-1 left-1/2 hidden h-6 w-28 -translate-x-1/2 rounded-full blur-xl sm:block"
        style={{ background: GLOW_BLUE }}
        initial={false}
        animate={{ opacity: dimmed ? 0.12 : 0.55, scaleX: dimmed ? 0.35 : 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      />

      <motion.span
        className="absolute bottom-2 left-1/2 hidden h-[2px] w-28 -translate-x-1/2 rounded-full sm:block"
        style={{
          background: `linear-gradient(90deg, transparent, ${GLOW_BLUE}, #ffffff, ${GLOW_BLUE}, transparent)`,
          boxShadow: `0 0 6px rgba(255,255,255,0.9), 0 0 16px ${BEAM_BLUE}aa`,
        }}
        initial={false}
        animate={{ opacity: dimmed ? 0 : 1, scaleX: dimmed ? 0.35 : 1 }}
        transition={{ opacity: { duration: DURATION.slow }, scaleX: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
      />
    </div>
  );
}
