import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAuditAppender } from "../src/audit-log.mjs";

test("audit appender writes JSONL and removes credential-shaped data", async (t) => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "ayprom-gsc-audit-"));
  t.after(() => fs.rm(configDir, { recursive: true, force: true }));
  const config = { auditPath: path.join(configDir, "audit.jsonl") };
  const appendAudit = createAuditAppender(config, () => new Date("2026-09-18T10:00:00.000Z"));

  await appendAudit({
    action: "submit_sitemap",
    target: "https://www.ayprom-gidravlika.kg/sitemap.xml",
    error: "Bearer abc.secret-token",
    refresh_token: "must-not-appear",
  });

  const raw = await fs.readFile(config.auditPath, "utf8");
  const record = JSON.parse(raw.trim());
  assert.equal(record.timestamp, "2026-09-18T10:00:00.000Z");
  assert.equal(record.error, "Bearer [REDACTED]");
  assert.equal("refresh_token" in record, false);
  assert.doesNotMatch(raw, /must-not-appear|abc\.secret-token/);
});
