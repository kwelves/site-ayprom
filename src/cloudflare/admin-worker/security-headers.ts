import { buildContentSecurityPolicy } from "@/lib/security/csp";

// The Vercel site sends these headers on every response (next.config.ts). The admin on Cloudflare must send the same,
// and never be indexed: the admin has no business in a search engine, whatever address it is reached at.
interface HeaderEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_MEDIA_BASE_URL?: string;
}

function httpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function adminSecurityHeaders(env: HeaderEnv): Record<string, string> {
  return {
    // A missing or malformed address never widens the policy: it simply stays at 'self'.
    "Content-Security-Policy": buildContentSecurityPolicy({
      isDevelopment: false,
      supabaseOrigin: httpsOrigin(env.NEXT_PUBLIC_SUPABASE_URL) ?? "'self'",
      mediaOrigin: httpsOrigin(env.NEXT_PUBLIC_MEDIA_BASE_URL),
    }),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

/** Copies the response (a response from the assets service has immutable headers) and sets the protections on it. */
export function applyAdminSecurityHeaders(response: Response, env: HeaderEnv): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(adminSecurityHeaders(env))) copy.headers.set(name, value);
  return copy;
}
