// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/nextjs";
import { browserTracingIntegration } from "@sentry/browser";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_TRACING_INTEGRATION_NAME,
  browserSentryOptions,
} from "@/lib/sentry-browser-options";

// Настоящий Sentry не получает ни одной искусственной ошибки: клиент
// поднимается на транспорте, который просто складывает конверты в массив.
const sentEnvelopes: unknown[] = [];

function inMemoryTransport() {
  return {
    send: (envelope: unknown) => {
      sentEnvelopes.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  };
}

/**
 * Тот же набор опций, что уходит в браузер, но с подменённым транспортом и с
 * реальной BrowserTracing среди «умолчаний» — именно её обязан отфильтровать
 * наш колбэк `integrations`.
 */
function startClientWithTracingOffered() {
  return Sentry.init({
    ...browserSentryOptions,
    // Синтаксически валидный тестовый DSN: адрес никуда не уходит, транспорт
    // подменён.
    dsn: "https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/0",
    defaultIntegrations: [browserTracingIntegration()],
    transport: inMemoryTransport,
  });
}

afterEach(() => {
  sentEnvelopes.length = 0;
});

describe("браузерный Sentry в режиме «только ошибки»", () => {
  it("по-прежнему отправляет исключение", async () => {
    const client = startClientWithTracingOffered();
    expect(client).toBeDefined();

    Sentry.captureException(new Error("QA: синтетическая ошибка браузера"));
    await Sentry.flush(2_000);

    expect(sentEnvelopes.length).toBeGreaterThan(0);
    expect(JSON.stringify(sentEnvelopes)).toContain("QA: синтетическая ошибка браузера");
  });

  it("не оставляет BrowserTracing в списке интеграций поднятого клиента", () => {
    const client = startClientWithTracingOffered();

    expect(client?.getIntegrationByName(BROWSER_TRACING_INTEGRATION_NAME)).toBeUndefined();
  });

  it("колбэк integrations вырезает именно BrowserTracing и не трогает остальные", () => {
    const tracing = browserTracingIntegration();
    const other = { name: "InboundFilters", setupOnce: () => undefined };

    expect(tracing.name).toBe(BROWSER_TRACING_INTEGRATION_NAME);
    expect(browserSentryOptions.integrations([tracing, other])).toEqual([other]);
  });

  it("не задаёт клиентский tracesSampleRate и не экспортирует навигационный хук", () => {
    const stripComments = (source: string) =>
      source
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");
    const options = stripComments(readFileSync("src/lib/sentry-browser-options.ts", "utf8"));
    const client = stripComments(readFileSync("src/instrumentation-client.ts", "utf8"));

    expect(options).not.toContain("tracesSampleRate");
    expect(client).not.toContain("tracesSampleRate");
    expect(client).not.toContain("onRouterTransitionStart");
    expect(options).toContain("sendDefaultPii: false");
    expect("tracesSampleRate" in browserSentryOptions).toBe(false);
  });

  it("серверная трассировка и отчётность по ошибкам остаются нетронутыми", () => {
    const server = readFileSync("src/instrumentation.ts", "utf8");

    expect(server).toContain("tracesSampleRate: 0.1");
    expect(server).toContain("sendDefaultPii: false");
    expect(server).toContain("dsn: process.env.SENTRY_DSN");
    expect(server).toContain("export const onRequestError = Sentry.captureRequestError;");
    // Глобального выключателя трассировки быть не должно: он погасил бы и
    // серверные транзакции.
    expect(readFileSync("next.config.ts", "utf8")).not.toContain("excludeTracing");
  });
});
