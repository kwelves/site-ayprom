"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ConnectorPaths } from "./connector-geometry";

const DRAW_EASE = [0.4, 0, 0.2, 1] as const;

interface ConnectorProps {
  paths: Pick<ConnectorPaths, "stem" | "terminal"> & Partial<Pick<ConnectorPaths, "topBranch" | "bottomBranch">>;
  onConnected?: () => void;
}

export function Connector({ paths, onConnected }: ConnectorProps) {
  const shouldReduceMotion = useReducedMotion();
  const stemDuration = shouldReduceMotion ? 0 : 0.32;
  const branchDuration = shouldReduceMotion ? 0 : 0.52;
  const hasBranches = Boolean(paths.topBranch && paths.bottomBranch);

  return (
    <>
      {/* glow layer sits beneath the crisp trace so the drop-shadow doesn't
          double up on the beam pass */}
      <g style={{ filter: "drop-shadow(0 0 5px rgba(20,116,255,0.28))" }}>
        <motion.path
          d={paths.stem}
          fill="none"
          stroke="#1474ff"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: stemDuration, ease: DRAW_EASE }}
          onAnimationComplete={hasBranches ? undefined : onConnected}
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
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
            />
            <motion.path
              d={paths.bottomBranch}
              fill="none"
              stroke="#1474ff"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
              onAnimationComplete={onConnected}
            />
          </>
        )}
      </g>

      {!shouldReduceMotion && (
        <g style={{ filter: "drop-shadow(0 0 4px rgba(185,220,255,0.9))" }}>
          <motion.path
            d={paths.stem}
            fill="none"
            stroke="#b9dcff"
            strokeWidth={3.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
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
                vectorEffect="non-scaling-stroke"
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
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0.08, pathOffset: 0, opacity: 1 }}
                animate={{ pathOffset: 0.95, opacity: [1, 1, 0] }}
                transition={{ duration: branchDuration, delay: stemDuration, ease: DRAW_EASE }}
              />
            </>
          )}
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
        transition={{ delay: stemDuration, duration: 0.15 }}
      />
    </>
  );
}
