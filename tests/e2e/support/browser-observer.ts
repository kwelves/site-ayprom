import { expect, test as base, type Request, type Response, type TestInfo } from "@playwright/test";

export type BrowserFailure = {
  type: "console" | "pageerror" | "requestfailed" | "response";
  detail: string;
  url?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  errorText?: string;
  isNavigationRequest?: boolean;
  isNextPrefetch?: boolean;
  isNextAction?: boolean;
  isNextRscNavigation?: boolean;
};

export type BrowserFailurePredicate = (failure: Readonly<BrowserFailure>) => boolean;

export type BrowserObserver = {
  allow: (predicate: BrowserFailurePredicate) => void;
  assertClean: () => void;
};

const SPEED_INSIGHTS_PATH = "/_vercel/speed-insights/script.js";
const SPEED_INSIGHTS_404_CONSOLE = "error: Failed to load resource: the server responded with a status of 404 (Not Found)";

function redact(value: string): string {
  return value
    .replace(/(apikey|authorization|token|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}

function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function expectedOrigin(): string {
  const baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) throw new Error("E2E_BASE_URL обязателен для strict browser observer.");
  return new URL(baseURL).origin;
}

function hasExactOriginAndPath(failure: Readonly<BrowserFailure>, pathname: string): boolean {
  if (!failure.url) return false;
  try {
    const url = new URL(failure.url);
    return url.origin === expectedOrigin() && url.pathname === pathname;
  } catch {
    return false;
  }
}

function hasExpectedOrigin(failure: Readonly<BrowserFailure>): boolean {
  if (!failure.url) return false;
  try {
    return new URL(failure.url).origin === expectedOrigin();
  } catch {
    return false;
  }
}

async function attachFailures(testInfo: TestInfo, failures: BrowserFailure[]) {
  await testInfo.attach("browser-observer.json", {
    body: Buffer.from(JSON.stringify(failures, null, 2)),
    contentType: "application/json",
  });
}

function requestFailure(request: Request): BrowserFailure {
  const errorText = request.failure()?.errorText ?? "unknown failure";
  const url = safeUrl(request.url());
  const headers = request.headers();
  return {
    type: "requestfailed",
    detail: `${request.method()} ${url}: ${redact(errorText)}`,
    url,
    method: request.method(),
    resourceType: request.resourceType(),
    errorText: redact(errorText),
    isNavigationRequest: request.isNavigationRequest(),
    isNextPrefetch:
      headers["next-router-prefetch"] === "1" ||
      headers.purpose === "prefetch" ||
      headers["sec-purpose"] === "prefetch",
    isNextAction: Boolean(headers["next-action"]),
    isNextRscNavigation:
      headers.rsc === "1" && Boolean(headers["next-router-state-tree"] || headers["next-url"]),
  };
}

function responseFailure(response: Response): BrowserFailure {
  const url = safeUrl(response.url());
  return {
    type: "response",
    detail: `${response.status()} ${response.request().method()} ${url}`,
    url,
    method: response.request().method(),
    resourceType: response.request().resourceType(),
    status: response.status(),
  };
}

export const test = base.extend<{ browserObserver: BrowserObserver }>({
  browserObserver: [
    async ({ page }, use, testInfo) => {
      const failures: BrowserFailure[] = [];
      const allowedPredicates: BrowserFailurePredicate[] = [
        allowExpectedSameOriginNextPrefetchAbort(),
        allowLocalSpeedInsightsAbsence(),
        allowChromiumWebGLDriverNoise(),
      ];
      const record = (failure: BrowserFailure) => {
        if (!allowedPredicates.some((predicate) => predicate(failure))) failures.push(failure);
      };

      page.on("console", (message) => {
        if (message.type() !== "warning" && message.type() !== "error") return;
        const locationURL = message.location().url;
        record({
          type: "console",
          detail: redact(`${message.type()}: ${message.text()}`),
          url: locationURL ? safeUrl(locationURL) : undefined,
        });
      });
      page.on("pageerror", (error) => {
        record({ type: "pageerror", detail: redact(error.message) });
      });
      page.on("requestfailed", (request) => record(requestFailure(request)));
      page.on("response", (response) => {
        if (response.status() >= 400) record(responseFailure(response));
      });

      await use({
        allow(predicate) {
          allowedPredicates.push(predicate);
        },
        assertClean() {
          expect(failures, "До target assertion browser observer должен быть чистым").toEqual([]);
        },
      });

      await attachFailures(testInfo, failures);
      expect(failures, "В браузере не должно быть неожиданных warnings/errors, failed requests или HTTP 4xx/5xx").toEqual([]);
    },
    { auto: true },
  ],
});

export function allowExpectedDocumentStatus(pathname: string, status: number): BrowserFailurePredicate {
  return (failure) => {
    if (
      status === 404 &&
      failure.type === "console" &&
      hasExactOriginAndPath(failure, pathname) &&
      (failure.detail === "error: Failed to load resource: the server responded with a status of 404" ||
        failure.detail === "error: Failed to load resource: the server responded with a status of 404 (Not Found)")
    ) {
      return true;
    }
    if (
      failure.type !== "response" ||
      failure.status !== status ||
      failure.method !== "GET" ||
      failure.resourceType !== "document"
    ) {
      return false;
    }
    return hasExactOriginAndPath(failure, pathname);
  };
}

export function allowExpectedSameOriginNextPrefetchAbort(): BrowserFailurePredicate {
  return (failure) =>
    failure.type === "requestfailed" &&
    failure.method === "GET" &&
    failure.resourceType === "fetch" &&
    failure.errorText === "net::ERR_ABORTED" &&
    failure.isNavigationRequest === false &&
    failure.isNextPrefetch === true &&
    Boolean(failure.url?.startsWith(`${expectedOrigin()}/`));
}

export function allowExpectedNextActionPostAbort(pathname: string): BrowserFailurePredicate {
  return (failure) =>
    failure.type === "requestfailed" &&
    failure.method === "POST" &&
    failure.resourceType === "fetch" &&
    failure.errorText === "net::ERR_ABORTED" &&
    failure.isNextAction === true &&
    hasExactOriginAndPath(failure, pathname);
}

export function allowExpectedNextRscNavigationAbort(pathname: string): BrowserFailurePredicate {
  return (failure) =>
    failure.type === "requestfailed" &&
    failure.method === "GET" &&
    failure.resourceType === "fetch" &&
    failure.errorText === "net::ERR_ABORTED" &&
    failure.isNavigationRequest === false &&
    failure.isNextRscNavigation === true &&
    hasExactOriginAndPath(failure, pathname);
}

export function allowExpectedInvalidLoginPostAbort(): BrowserFailurePredicate {
  return allowExpectedNextActionPostAbort("/admin/login");
}

export function allowLocalSpeedInsightsAbsence(): BrowserFailurePredicate {
  return (failure) => {
    if (
      failure.type === "console" &&
      hasExpectedOrigin(failure) &&
      failure.detail.includes(`Refused to execute script from '${expectedOrigin()}${SPEED_INSIGHTS_PATH}'`) &&
      failure.detail.includes("MIME type ('text/html')") &&
      failure.detail.endsWith("strict MIME type checking is enabled.")
    ) {
      return true;
    }
    if (!hasExactOriginAndPath(failure, SPEED_INSIGHTS_PATH)) return false;
    if (
      failure.type === "response" &&
      failure.status === 404 &&
      failure.method === "GET" &&
      failure.resourceType === "script"
    ) {
      return true;
    }
    if (
      failure.type === "requestfailed" &&
      failure.method === "GET" &&
      failure.resourceType === "script" &&
      failure.errorText === "net::ERR_ABORTED"
    ) {
      return true;
    }
    return failure.type === "console" && failure.detail === SPEED_INSIGHTS_404_CONSOLE;
  };
}

export function allowChromiumWebGLDriverNoise(): BrowserFailurePredicate {
  return (failure) =>
    failure.type === "console" &&
    /^warning: \[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/.test(
      failure.detail,
    );
}

export { expect } from "@playwright/test";
