import { AsyncLocalStorage } from "node:async_hooks";

// What an admin action may touch while it runs, instead of Next's hidden request state.
export interface RpcRequestContext {
  request: Request;
  cookies: Map<string, string>;
  setCookies: string[];
}

const storage = new AsyncLocalStorage<RpcRequestContext>();

export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    if (!jar.has(name)) jar.set(name, value);
  }
  return jar;
}

export function createRequestContext(request: Request): RpcRequestContext {
  return { request, cookies: parseCookieHeader(request.headers.get("cookie")), setCookies: [] };
}

export function runWithRequestContext<T>(context: RpcRequestContext, run: () => Promise<T>): Promise<T> {
  return storage.run(context, run);
}

export function requireRequestContext(): RpcRequestContext {
  const context = storage.getStore();
  if (!context) throw new Error("admin_request_context_missing");
  return context;
}
