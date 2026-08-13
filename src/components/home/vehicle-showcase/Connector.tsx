"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { ConnectorPaths } from "./connector-geometry";

const DRAW_EASE = [0.22, 1, 0.36, 1] as const;

// Ни на одном пути здесь нет `vector-effect="non-scaling-stroke"`, и добавлять
// его нельзя. Framer рисует `pathLength` не сам: он ставит на путь атрибут
// `pathLength="1"` и анимирует `stroke-dasharray` от «0 1» до «1 1», то есть
// нормализует длину в пользовательских координатах SVG.
// `non-scaling-stroke` переводит обводку вместе с рисунком штриха в экранные
// координаты — длина штриха остаётся в пользовательских, а раскладывается вдоль
// пути, измеренного в экранных. Пока масштаб между ними равен единице, разницы
// нет; при масштабировании дисплея Windows (или зуме страницы) каждый путь
// прорисовывается ровно на 1/масштаб своей длины, и линия обрывается на
// полпути — одинаково у стержня и у обеих ветвей, при том что бегущий импульс
// продолжает ходить целиком.
// Толщину обводки атрибут здесь всё равно ни на что не влияет: у <svg>
// коннектора нет ни viewBox, ни трансформации, пользовательские координаты
// совпадают с CSS-пикселями один в один.

interface ConnectorProps {
  paths: Pick<ConnectorPaths, "stem" | "terminal"> & Partial<Pick<ConnectorPaths, "topBranch" | "bottomBranch">>;
  onConnected?: () => void;
}

// Mount this keyed by the active hotspot id (`<Connector key={activeHotspotId} .../>`
// inside an <AnimatePresence>) — that's what makes every switch restart the
// draw from scratch and erase the previous line via its exit animation,
// instead of just re-pointing the same persistent path at new coordinates.
export function Connector({ paths, onConnected }: ConnectorProps) {
  const shouldReduceMotion = useReducedMotion();
  const [constructed, setConstructed] = useState(false);
  const stemDuration = shouldReduceMotion ? 0 : 0.4;
  const branchDuration = shouldReduceMotion ? 0 : 0.85;
  const hasBranches = Boolean(paths.topBranch && paths.bottomBranch);

  const handleBranchesComplete = () => {
    setConstructed(true);
    onConnected?.();
  };

  return (
    <>
      <g style={{ filter: "drop-shadow(0 0 5px rgba(20,116,255,0.28))" }}>
        <motion.path
          d={paths.stem}
          fill="none"
          stroke="#1474ff"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          exit={{ pathLength: 0, transition: { duration: shouldReduceMotion ? 0 : 0.25, ease: "easeIn" } }}
          transition={{ duration: stemDuration, ease: DRAW_EASE }}
          onAnimationComplete={hasBranches ? undefined : handleBranchesComplete}
        />
        {hasBranches && (
          <>
            <motion.path
              d={paths.topBranch}
              fill="none"
              stroke="#1474ff"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              exit={{ pathLength: 0, transition: { duration: shouldReduceMotion ? 0 : 0.25, ease: "easeIn" } }}
              transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
            />
            <motion.path
              d={paths.bottomBranch}
              fill="none"
              stroke="#1474ff"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              exit={{ pathLength: 0, transition: { duration: shouldReduceMotion ? 0 : 0.25, ease: "easeIn" } }}
              transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
              onAnimationComplete={handleBranchesComplete}
            />
          </>
        )}
      </g>

      {/* One-shot construction beam — a bright short segment that races
          ahead of the track while it's being drawn. Once `constructed`,
          this layer is swapped for the continuously looping pulses below. */}
      {!shouldReduceMotion && !constructed && (
        <g style={{ filter: "drop-shadow(0 0 4px rgba(185,220,255,0.9))" }}>
          <motion.path
            d={paths.stem}
            fill="none"
            stroke="#b9dcff"
            strokeWidth={3.5}
            strokeLinecap="round"
            initial={{ pathLength: 0.08, pathOffset: 0, opacity: 1 }}
            animate={{ pathOffset: 0.95, opacity: [1, 1, 0] }}
            transition={{ duration: stemDuration, ease: DRAW_EASE }}
          />
          {hasBranches && (
            <>
              <motion.path
                d={paths.topBranch}
                fill="none"
                stroke="#b9dcff"
                strokeWidth={3.5}
                strokeLinecap="round"
                initial={{ pathLength: 0.08, pathOffset: 0, opacity: 1 }}
                animate={{ pathOffset: 0.95, opacity: [1, 1, 0] }}
                transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
              />
              <motion.path
                d={paths.bottomBranch}
                fill="none"
                stroke="#b9dcff"
                strokeWidth={3.5}
                strokeLinecap="round"
                initial={{ pathLength: 0.08, pathOffset: 0, opacity: 1 }}
                animate={{ pathOffset: 0.95, opacity: [1, 1, 0] }}
                transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
              />
            </>
          )}
        </g>
      )}

      {/* Permanent cycling pulses around the card outline, once built —
          "Card outline track" + "Split traveling pulses" from spec. Loop
          seamlessly (pathOffset 0→1 linear, repeat) rather than a CSS
          conic-gradient spin, so it visually is the same beam that built
          the line, still travelling. */}
      {!shouldReduceMotion && constructed && hasBranches && (
        <g style={{ filter: "drop-shadow(0 0 4px rgba(185,220,255,0.75))" }}>
          <motion.path
            d={paths.topBranch}
            fill="none"
            stroke="#b9dcff"
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0.1, pathOffset: 0 }}
            animate={{ pathOffset: 1 }}
            transition={{ duration: 2, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          />
          <motion.path
            d={paths.bottomBranch}
            fill="none"
            stroke="#b9dcff"
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0.1, pathOffset: 0 }}
            animate={{ pathOffset: 1 }}
            transition={{ duration: 2, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          />
        </g>
      )}

      <motion.circle
        cx={paths.terminal.x}
        cy={paths.terminal.y}
        r={3.5}
        fill="#8fc2ff"
        style={{ filter: "drop-shadow(0 0 7px rgba(143,194,255,0.82))" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: shouldReduceMotion ? 0 : 0.15 } }}
        transition={{ delay: stemDuration, duration: 0.15 }}
      />
    </>
  );
}
