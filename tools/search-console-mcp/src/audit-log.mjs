import fs from "node:fs/promises";
import path from "node:path";

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/(access_token|refresh_token|client_secret)["'=:\s]+[^\s",}]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|secret|authorization/i.test(key))
        .map(([key, child]) => [key, redact(child)]),
    );
  }
  return value;
}

export function createAuditAppender(config, now = () => new Date()) {
  return async function appendAudit(event) {
    await fs.mkdir(path.dirname(config.auditPath), { recursive: true });
    const record = redact({ timestamp: now().toISOString(), ...event });
    await fs.appendFile(config.auditPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  };
}
