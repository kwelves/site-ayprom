// A tiny Sentry reporter for the Cloudflare Workers: it sends one error event per failure, over plain fetch, with no SDK.
// The text of an error is never sent (it can hold names, e-mails or other personal data): only the class of the error,
// the places in the code it passed through, and a few short tags. A flood of the same error cannot use up the quota.

export interface ParsedSentryDsn {
  publicKey: string;
  envelopeUrl: string;
  dsn: string;
}

/** Reads a Sentry address; anything that is not https on sentry.io (or a subdomain of it) is refused. */
export function parseSentryDsn(value: string | undefined): ParsedSentryDsn | null {
  const dsn = value?.trim();
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const project = /^\/(\d+)$/.exec(url.pathname)?.[1];
  const host = url.hostname.toLowerCase();
  const onSentry = host === "sentry.io" || host.endsWith(".sentry.io");
  if (url.protocol !== "https:" || !url.username || url.password || !project || !onSentry) return null;
  return { publicKey: url.username, envelopeUrl: `https://${url.host}/api/${project}/envelope/`, dsn };
}

interface Frame {
  function?: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: true;
}

const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const MAX_FRAMES = 50;

/** Newest call first, as JavaScript prints it. */
function framesOf(error: unknown): Frame[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  const frames: Frame[] = [];
  for (const line of error.stack.split("\n")) {
    const match = FRAME.exec(line);
    if (!match) continue;
    frames.push({
      ...(match[1] ? { function: match[1] } : {}),
      filename: match[2].split(/[?#]/)[0],
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: true,
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function typeOf(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z0-9_.$]{1,64}$/.test(name) ? name : "Error";
}

function cleanTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (/^[A-Za-z0-9_.:-]{1,32}$/.test(key) && typeof value === "string" && value.length > 0 && value.length <= 64) clean[key] = value;
  }
  return clean;
}

export function buildSentryEnvelope(input: {
  dsn: ParsedSentryDsn;
  error: unknown;
  eventId: string;
  timestampSeconds: number;
  environment: string;
  release?: string;
  runtime: string;
  tags?: Record<string, unknown>;
}): string {
  const frames = framesOf(input.error).reverse(); // Sentry wants the oldest call first
  const event = {
    event_id: input.eventId,
    timestamp: input.timestampSeconds,
    platform: "javascript",
    level: "error",
    environment: input.environment,
    ...(input.release ? { release: input.release } : {}),
    sdk: { name: "ayprom-sentry-lite", version: "1" },
    tags: { ...cleanTags(input.tags), runtime: input.runtime },
    exception: { values: [{ type: typeOf(input.error), ...(frames.length > 0 ? { stacktrace: { frames } } : {}) }] },
  };
  return [
    JSON.stringify({ event_id: input.eventId, sent_at: new Date(input.timestampSeconds * 1000).toISOString(), dsn: input.dsn.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

export interface SentryReporterOptions {
  dsn: string | undefined;
  environment: string;
  runtime: string;
  release?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export type SentryReporter = (error: unknown, tags?: Record<string, unknown>) => Promise<void>;

/** Null when there is no usable address, so the caller simply has nothing to call. The returned function never throws. */
export function createSentryReporter(options: SentryReporterOptions): SentryReporter | null {
  const dsn = parseSentryDsn(options.dsn);
  if (!dsn) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 3000;
  const lastSentAt = new Map<string, number>();
  let recent: number[] = [];

  return async (error, tags) => {
    try {
      const time = now();
      for (const [key, sentAt] of lastSentAt) if (time - sentAt >= WINDOW_MS) lastSentAt.delete(key);
      recent = recent.filter((sentAt) => time - sentAt < WINDOW_MS);
      const top = framesOf(error)[0];
      const key = `${typeOf(error)}|${top ? `${top.function ?? ""}|${top.filename}|${top.lineno}` : ""}`;
      if (lastSentAt.has(key) || recent.length >= MAX_PER_WINDOW) return;
      lastSentAt.set(key, time);
      recent.push(time);

      const body = buildSentryEnvelope({
        dsn, error, eventId: crypto.randomUUID().replaceAll("-", ""), timestampSeconds: Math.floor(time / 1000),
        environment: options.environment, release: options.release, runtime: options.runtime, tags,
      });
      await fetchImpl(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=ayprom-sentry-lite/1, sentry_key=${dsn.publicKey}`,
        },
        body,
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch {
      // Reporting a failure must never become a failure of its own.
    }
  };
}
