const LOCAL_SUPABASE_PORT = "54321";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function parseSupabaseStatusEnv(output) {
  const values = new Map();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error("Supabase CLI вернул env в неизвестном формате.");
      }
    }
    values.set(key, value);
  }

  return values;
}

export function assertLocalSupabaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw localUrlError();
  }

  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.port !== LOCAL_SUPABASE_PORT
  ) {
    throw localUrlError();
  }
}

export function assertPublicSupabaseKey(rawKey) {
  const key = rawKey.trim();
  if (!key || /^sb_secret_/i.test(key) || jwtRole(key) === "service_role") {
    throw new Error("PostgREST contract принимает только публичный Supabase key.");
  }
}

function jwtRole(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function localUrlError() {
  return new Error(
    "PostgREST contract разрешён только на local Supabase http://127.0.0.1:54321.",
  );
}
