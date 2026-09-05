import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const url = option("--url", "http://127.0.0.1:3115");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Performance runner only accepts an isolated loopback server.");
}
const output = path.resolve(option("--output", ".tmp-pagespeed/measurements"));
const runs = Number(option("--runs", "3"));
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("--runs must be 1..10");
const cache = path.join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx");
const candidates = process.env.LIGHTHOUSE_PATH ? [process.env.LIGHTHOUSE_PATH] :
  existsSync(cache) ? readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/lighthouse/package.json")) : [];
const packagePath = candidates.find((candidate) => existsSync(candidate));
if (!packagePath) throw new Error("Set LIGHTHOUSE_PATH to an installed Lighthouse package.json; dependencies are not installed automatically.");
const requireLighthouse = createRequire(packagePath);
const { default: lighthouse } = await import(pathToFileURL(requireLighthouse.resolve("lighthouse")).href);
const { launch, killAll } = await import(pathToFileURL(requireLighthouse.resolve("chrome-launcher")).href);
// Форм-фактор задаётся КОНФИГОМ, а не флагом: `preset: "desktop"` — опция CLI,
// программный API её молча игнорирует, и «десктопный» прогон на самом деле
// оставался мобильным (проверено по configSettings.formFactor в отчёте).
const desktopConfig = (await import(pathToFileURL(path.join(path.dirname(packagePath), "core/config/desktop-config.js")).href)).default;
mkdirSync(output, { recursive: true });

// chrome-launcher's own temporary profile is removed inside `kill()`, after
// the browser is already gone. On Windows that removal loses a race with the
// still-closing Chrome process and throws EPERM, which used to abort the whole
// measurement run. Owning the profile directory here makes `destroyTmp()` a
// no-op (it only deletes directories it created itself), so `kill()` cannot
// throw for that reason, and this runner deletes exactly the one directory it
// created — never a shared temp root.
const profileRoot = path.join(output, "chrome-profiles");
mkdirSync(profileRoot, { recursive: true });

/** Best effort: a profile Windows still holds open must not fail the run. */
function removeProfile(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.error(JSON.stringify({ profileCleanupFailed: directory, message: String(error?.message ?? error) }));
  }
}

/** Chrome must always be terminated; only its cleanup may fail non-fatally. */
function stopChrome(chrome, userDataDir) {
  try {
    chrome.kill();
  } catch (error) {
    console.error(JSON.stringify({ chromeKillWarning: String(error?.message ?? error) }));
  }
  removeProfile(userDataDir);
}

const summary = [];
try {
  for (const formFactor of ["desktop", "mobile"]) {
    for (let run = 1; run <= runs; run++) {
      const prefix = `${formFactor}-${run}`;
      const userDataDir = path.join(profileRoot, prefix);
      mkdirSync(userDataDir, { recursive: true });
      const chrome = await launch({
        chromePath: chromium.executablePath(),
        userDataDir,
        chromeFlags: ["--headless=new", "--disable-dev-shm-usage", "--no-first-run"],
      });
      try {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: ["json", "html"], logLevel: "error" },
          formFactor === "desktop" ? desktopConfig : undefined,
        );
        if (!result) throw new Error("Lighthouse returned no report");
        if (result.lhr.configSettings.formFactor !== formFactor) {
          throw new Error(`Lighthouse ran as ${result.lhr.configSettings.formFactor}, expected ${formFactor}`);
        }
        writeFileSync(path.join(output, `${prefix}.json`), result.report[0]);
        writeFileSync(path.join(output, `${prefix}.html`), result.report[1]);
        const { lhr } = result;
        const record = {
          formFactor, run, version: lhr.lighthouseVersion, fetched: lhr.fetchTime,
          appliedFormFactor: lhr.configSettings.formFactor,
          throttling: lhr.configSettings.throttling,
          scores: Object.fromEntries(Object.entries(lhr.categories).map(([name, value]) => [name, Math.round(value.score * 100)])),
          metrics: Object.fromEntries(["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"].map((id) => [id, lhr.audits[id].numericValue])),
          runtimeError: lhr.runtimeError ?? null,
        };
        summary.push(record);
        writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
        console.log(JSON.stringify(record));
        if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
      } finally {
        stopChrome(chrome, userDataDir);
      }
    }
  }
} finally {
  // Nothing must outlive this process, including an instance whose own
  // `kill()` reported a problem.
  try {
    killAll();
  } catch (error) {
    console.error(JSON.stringify({ killAllWarning: String(error?.message ?? error) }));
  }
  removeProfile(profileRoot);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
const medians = Object.fromEntries(
  ["desktop", "mobile"].map((formFactor) => {
    const rows = summary.filter((record) => record.formFactor === formFactor);
    if (rows.length === 0) return [formFactor, null];
    return [formFactor, {
      runs: rows.length,
      performance: median(rows.map((row) => row.scores.performance)),
      accessibility: median(rows.map((row) => row.scores.accessibility)),
      bestPractices: median(rows.map((row) => row.scores["best-practices"])),
      seo: median(rows.map((row) => row.scores.seo)),
      metrics: Object.fromEntries(
        ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]
          .map((id) => [id, median(rows.map((row) => row.metrics[id]))]),
      ),
    }];
  }),
);
writeFileSync(path.join(output, "medians.json"), JSON.stringify(medians, null, 2));
console.log(JSON.stringify({ medians }, null, 2));
