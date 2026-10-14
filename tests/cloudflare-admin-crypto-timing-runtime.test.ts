import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";

type Mode = "env" | "verify" | "hash";
type Sample = { ok: true; elapsedMs: number };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

it("measures local workerd wall time of existing admin password operations without exposing credentials", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-admin-crypto-timing-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-admin-crypto-timing-local",
    main: path.resolve("tests/support/admin-crypto-timing-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
  }));
  let running;
  try {
    running = await startWrangler(config, directory);
    const timings: Record<Mode, { worker: number[]; roundTrip: number[] }> = {
      env: { worker: [], roundTrip: [] },
      verify: { worker: [], roundTrip: [] },
      hash: { worker: [], roundTrip: [] },
    };
    for (const mode of ["env", "verify", "hash"] as const) {
      for (let index = 0; index < 7; index += 1) {
        const sent = performance.now();
        const response = await fetch(`${running.base}/measure?mode=${mode}`, { signal: AbortSignal.timeout(20_000) });
        expect(response.status).toBe(200);
        const result = await response.json() as Sample;
        const roundTripMs = performance.now() - sent;
        expect(Object.keys(result).sort()).toEqual(["elapsedMs", "ok"]);
        expect(result.ok).toBe(true);
        expect(Number.isFinite(result.elapsedMs)).toBe(true);
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0); // workerd timer can quantize a short operation to zero
        expect(roundTripMs).toBeGreaterThan(0);
        if (index > 0) {
          timings[mode].worker.push(result.elapsedMs);
          timings[mode].roundTrip.push(roundTripMs);
        } // first call warms the runtime
      }
    }
    const result = Object.fromEntries(Object.entries(timings).map(([mode, values]) => [mode, {
      samples: values.worker.length,
      medianWorkerdWallMs: Math.round(median(values.worker) * 100) / 100,
      medianHttpRoundTripMs: Math.round(median(values.roundTrip) * 100) / 100,
      minHttpRoundTripMs: Math.round(Math.min(...values.roundTrip) * 100) / 100,
      maxHttpRoundTripMs: Math.round(Math.max(...values.roundTrip) * 100) / 100,
    }]));
    console.log(JSON.stringify({ localTimingNotCpu: result }));
  } finally {
    await stopWrangler(running?.child);
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== tmpdir() || !path.basename(resolved).startsWith("ayprom-admin-crypto-timing-")) {
      throw new Error("unexpected_timing_directory");
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 120_000);
