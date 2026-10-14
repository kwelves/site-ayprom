// Browser side of the admin RPC. Reads are answered from memory the moment they are asked for and
// refreshed behind the scenes (stale-while-revalidate); any action that succeeds marks everything
// stale so the next read waits for fresh data instead of showing yesterday's list.
export class AdminNotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "AdminNotFoundError";
  }
}

export interface RpcClientOptions {
  fetchImpl: typeof fetch;
  navigate: (url: string) => void;
  /** `reason` is "expired" (password changed) or "unavailable" (check failed); absent when never signed in. */
  onUnauthorized: (reason?: string) => void;
  now?: () => number;
  /** A cached read older than this is refreshed in the background. */
  backgroundRefreshAfterMs?: number;
  baseUrl?: string;
}

export async function encodeRpcArgs(args: unknown[]): Promise<unknown[]> {
  return Promise.all(args.map(encodeValue));
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function encodeValue(value: unknown): Promise<unknown> {
  if (value === undefined) return { $undefined: true };
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    const entries: Array<[string, unknown]> = [];
    for (const [key, entry] of value.entries()) {
      entries.push([
        key,
        typeof entry === "string"
          ? entry
          : { $file: { name: entry.name, type: entry.type || "application/octet-stream", base64: await fileToBase64(entry) } },
      ]);
    }
    return { $formData: entries };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeValue));
  if (typeof value === "object" && value !== null) {
    const pairs = await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await encodeValue(entry)] as const));
    return Object.fromEntries(pairs);
  }
  return value;
}

interface CacheEntry {
  value: unknown;
  json: string;
  at: number;
  stale: boolean;
}

export function createRpcClient(options: RpcClientOptions) {
  const now = options.now ?? Date.now;
  const backgroundAfter = options.backgroundRefreshAfterMs ?? 3000;
  const baseUrl = options.baseUrl ?? "/api/admin/rpc/";
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  const listeners = new Set<() => void>();
  let generation = 0;

  // Reads never carry files, so a plain JSON key (with `undefined` made visible) is enough.
  const keyOf = (name: string, args: unknown[]) =>
    `${name}\u0000${JSON.stringify(args, (_key, value) => (value === undefined ? "\u0001undefined" : value))}`;

  async function post(name: string, args: unknown[]): Promise<{ value?: unknown; redirect?: string }> {
    const response = await options.fetchImpl(`${baseUrl}${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ args: await encodeRpcArgs(args) }),
    });
    let body: { ok?: boolean; value?: unknown; redirect?: string; notFound?: boolean; error?: { code?: string; message?: string; reason?: string } } | null = null;
    try { body = await response.json(); } catch { body = null; }
    if (body?.ok) return body.redirect !== undefined ? { redirect: body.redirect } : { value: body.value };
    if (body?.notFound) throw new AdminNotFoundError();
    if (response.status === 401) {
      options.onUnauthorized(body?.error?.reason);
      throw new Error("unauthorized");
    }
    throw new Error(body?.error?.message ?? "Не удалось выполнить действие. Попробуйте ещё раз.");
  }

  function store(key: string, value: unknown, startedIn: number): boolean {
    const json = JSON.stringify(value) ?? "";
    const previous = cache.get(key);
    cache.set(key, { value, json, at: now(), stale: startedIn !== generation });
    return previous?.json !== json;
  }

  function load(key: string, name: string, args: unknown[], notifyOnChange: boolean): Promise<unknown> {
    const running = inflight.get(key);
    if (running) return running;
    const startedIn = generation;
    const promise = post(name, args)
      .then(({ value }) => {
        const changed = store(key, value, startedIn);
        if (notifyOnChange && changed) for (const listener of [...listeners]) listener();
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return {
    async call(name: string, args: unknown[]): Promise<unknown> {
      const answer = await post(name, args);
      generation += 1;
      for (const entry of cache.values()) entry.stale = true;
      if (answer.redirect !== undefined) {
        options.navigate(answer.redirect);
        return undefined;
      }
      return answer.value;
    },

    read(name: string, args: unknown[]): Promise<unknown> {
      const key = keyOf(name, args);
      const entry = cache.get(key);
      if (!entry || entry.stale) return load(key, name, args, false);
      if (now() - entry.at >= backgroundAfter) void load(key, name, args, true).catch(() => undefined);
      return Promise.resolve(entry.value);
    },

    peek(name: string, args: unknown[]): { value: unknown } | undefined {
      const entry = cache.get(keyOf(name, args));
      return entry && !entry.stale ? { value: entry.value } : undefined;
    },

    async prefetch(name: string, args: unknown[]): Promise<void> {
      const key = keyOf(name, args);
      const entry = cache.get(key);
      if (entry && !entry.stale && now() - entry.at < backgroundAfter) return;
      await load(key, name, args, true).catch(() => undefined);
    },

    /** Drop everything the browser remembers (for example after logout). */
    clear(): void {
      generation += 1;
      cache.clear();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type RpcClient = ReturnType<typeof createRpcClient>;
