import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";
import {
  ALLOWED_PROPERTY,
  assertAllowedUrl,
  normalizeSitemapUrl,
  requireWriteConfirmation,
} from "../src/policy.mjs";

test("loadConfig fixes the Search Console property and stores secrets outside the repo", () => {
  const config = loadConfig({
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  });

  assert.equal(config.property, "sc-domain:ayprom-gidravlika.kg");
  assert.equal(
    config.configDir,
    path.join("C:\\Users\\tester\\AppData\\Local", "AYPROM", "search-console-mcp"),
  );
  assert.equal(config.oauthClientPath, path.join(config.configDir, "oauth-client.json"));
  assert.equal(config.tokenPath, path.join(config.configDir, "tokens.json"));
  assert.equal(config.auditPath, path.join(config.configDir, "audit.jsonl"));
});

test("loadConfig accepts an explicit local config directory", () => {
  const config = loadConfig({ AYPROM_GSC_CONFIG_DIR: "D:\\private\\gsc" });
  assert.equal(config.configDir, path.resolve("D:\\private\\gsc"));
});

test("loadConfig falls back to the operating-system temp-safe home config path", () => {
  const config = loadConfig({});
  assert.equal(config.property, ALLOWED_PROPERTY);
  assert.ok(config.configDir.startsWith(os.homedir()));
});

test("assertAllowedUrl accepts the apex and subdomains over HTTPS", () => {
  assert.equal(
    assertAllowedUrl("https://www.ayprom-gidravlika.kg/catalog"),
    "https://www.ayprom-gidravlika.kg/catalog",
  );
  assert.equal(
    assertAllowedUrl("https://ayprom-gidravlika.kg/"),
    "https://ayprom-gidravlika.kg/",
  );
});

test("assertAllowedUrl rejects HTTP, credentials, foreign hosts, and deceptive suffixes", () => {
  for (const value of [
    "http://www.ayprom-gidravlika.kg/",
    "https://user:pass@www.ayprom-gidravlika.kg/",
    "https://example.com/",
    "https://ayprom-gidravlika.kg.example.com/",
  ]) {
    assert.throws(() => assertAllowedUrl(value), /AYPROM|HTTPS|credentials/i);
  }
});

test("normalizeSitemapUrl removes fragments but preserves query strings", () => {
  assert.equal(
    normalizeSitemapUrl("https://www.ayprom-gidravlika.kg/sitemap.xml?part=1#section"),
    "https://www.ayprom-gidravlika.kg/sitemap.xml?part=1",
  );
});

test("requireWriteConfirmation requires the exact normalized phrase", () => {
  const url = "https://www.ayprom-gidravlika.kg/sitemap.xml";
  assert.equal(requireWriteConfirmation("SUBMIT", url, `SUBMIT ${url}`), url);
  assert.equal(requireWriteConfirmation("DELETE", url, `DELETE ${url}`), url);
  assert.throws(
    () => requireWriteConfirmation("DELETE", url, `delete ${url}`),
    /confirmation/i,
  );
});
