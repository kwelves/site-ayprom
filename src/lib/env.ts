// Central guard for required environment variables.
//
// Two rules this file exists to enforce:
//  1. A missing variable must fail loudly with the variable NAME, never with
//     its value — error messages travel into logs, error trackers and (in dev
//     overlays) the browser, so a value must never appear in one.
//  2. Secrets must never be read through a `!` non-null assertion. `!` only
//     silences the type checker: at runtime `undefined` still flows onward and
//     surfaces later as a confusing auth failure far from the real cause.
//
// Deliberately not validated at module load: Next.js evaluates modules during
// `next build`, where deploy-time-only secrets are legitimately absent. These
// are checked at the point of use instead, so a build never needs production
// secrets present.

/** Server-only variables. Never prefix any of these with NEXT_PUBLIC_. */
const SERVER_ENV_KEYS = ["SUPABASE_SECRET_KEY", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"] as const;

/** Variables intentionally inlined into the client bundle — public by design. */
const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
] as const;

type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];
type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];

/**
 * Reads a required variable, throwing a value-free error when it is unset.
 *
 * NEXT_PUBLIC_SUPABASE_URL is accepted here too: it is public, but the admin
 * client still needs it, and an unset URL should fail the same way.
 */
export function requireServerEnv(key: ServerEnvKey | PublicEnvKey): string {
  const value = process.env[key];
  if (!value) {
    // Only the name is interpolated — never `value`.
    throw new Error(
      `Переменная окружения ${key} не задана. Добавьте её в .env.local (локально) ` +
        `или в переменные окружения хостинга. Список см. в .env.example.`
    );
  }
  return value;
}

/**
 * Reports which required variables are missing, for startup/diagnostic checks.
 * Returns names only, so the result is always safe to log or display.
 */
export function getMissingServerEnvKeys(): string[] {
  return [...SERVER_ENV_KEYS, ...PUBLIC_ENV_KEYS].filter((key) => !process.env[key]);
}
