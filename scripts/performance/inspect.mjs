import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const url = option("--url", "http://127.0.0.1:3115");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback URL required");
const output = path.resolve(option("--output", ".tmp-pagespeed/inspect"));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const page = await context.newPage();
    const consoleMessages = [];
    const pageErrors = [];
    const failures = [];
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failures.push({ url: request.url(), failure: request.failure() }));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    const snapshot = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector("h1")?.textContent,
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
      scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
      resources: performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize, initiatorType: entry.initiatorType })),
      videos: [...document.querySelectorAll("video")].map((video) => ({ source: video.currentSrc, readyState: video.readyState, currentTime: video.currentTime, paused: video.paused })),
    }));
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ ...snapshot, consoleMessages, pageErrors, failures }, null, 2));
    console.log(JSON.stringify({ name, heading: snapshot.heading, consoleMessages, pageErrors, failedRequests: failures.length }));
    await context.close();
  }
} finally {
  await browser.close();
}
