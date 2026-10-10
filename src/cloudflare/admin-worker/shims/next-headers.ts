import { requireRequestContext } from "../request-context";

// Stand-in for `next/headers`: the same two calls, backed by the current RPC request.
export interface CookieOptions {
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  maxAge?: number;
  expires?: Date | number;
}

export function serializeSetCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires !== undefined) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const mode = options.sameSite === true ? "strict" : options.sameSite;
    parts.push(`SameSite=${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  }
  return parts.join("; ");
}

export async function cookies() {
  const context = requireRequestContext();
  return {
    get(name: string) {
      const value = context.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll() {
      return [...context.cookies].map(([name, value]) => ({ name, value }));
    },
    has(name: string) {
      return context.cookies.has(name);
    },
    set(name: string, value: string, options?: CookieOptions) {
      context.cookies.set(name, value);
      context.setCookies.push(serializeSetCookie(name, value, options));
    },
    delete(name: string) {
      context.cookies.delete(name);
      context.setCookies.push(`${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    },
  };
}

export async function headers(): Promise<Headers> {
  return new Headers(requireRequestContext().request.headers);
}
