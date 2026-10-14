// Stand-in for `next/navigation` on the server side. Errors carry Next's own `digest`
// tags, so code written for Next (for example actions.ts `isRedirectError`) keeps working.
const REDIRECT_PREFIX = "NEXT_REDIRECT";
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

export function redirect(url: string, type: "replace" | "push" = "replace"): never {
  const error = new Error(REDIRECT_PREFIX) as Error & { digest: string };
  error.digest = `${REDIRECT_PREFIX};${type};${url};307;`;
  throw error;
}

export function permanentRedirect(url: string, type: "replace" | "push" = "replace"): never {
  const error = new Error(REDIRECT_PREFIX) as Error & { digest: string };
  error.digest = `${REDIRECT_PREFIX};${type};${url};308;`;
  throw error;
}

export function notFound(): never {
  const error = new Error("NEXT_NOT_FOUND") as Error & { digest: string };
  error.digest = NOT_FOUND_DIGEST;
  throw error;
}

export function readRedirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith(`${REDIRECT_PREFIX};`)) return null;
  const fields = digest.split(";");
  return fields.slice(2, -2).join(";") || null;
}

export function isNotFoundError(error: unknown): boolean {
  return (error as { digest?: unknown } | null)?.digest === NOT_FOUND_DIGEST;
}
