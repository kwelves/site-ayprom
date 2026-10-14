import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSearchConsoleClient } from "../src/google-client.mjs";

async function makeConfig(t, token) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "ayprom-gsc-client-"));
  t.after(() => fs.rm(configDir, { recursive: true, force: true }));
  const config = {
    property: "sc-domain:ayprom-gidravlika.kg",
    configDir,
    oauthClientPath: path.join(configDir, "oauth-client.json"),
    tokenPath: path.join(configDir, "tokens.json"),
  };
  await fs.writeFile(
    config.oauthClientPath,
    JSON.stringify({ installed: { client_id: "client-id", client_secret: "client-secret" } }),
  );
  await fs.writeFile(config.tokenPath, JSON.stringify(token));
  return config;
}

test("propertyStatus encodes the fixed domain property and authenticates", async (t) => {
  const config = await makeConfig(t, {
    access_token: "valid-access",
    refresh_token: "refresh",
    expiry_date: Date.now() + 600_000,
  });
  const calls = [];
  const client = createSearchConsoleClient({
    config,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ siteUrl: config.property, permissionLevel: "siteOwner" });
    },
  });

  const result = await client.propertyStatus();

  assert.equal(result.permissionLevel, "siteOwner");
  assert.equal(
    calls[0].url,
    "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aayprom-gidravlika.kg",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer valid-access");
});

test("searchAnalytics sends the requested body to the fixed property", async (t) => {
  const config = await makeConfig(t, {
    access_token: "valid-access",
    refresh_token: "refresh",
    expiry_date: Date.now() + 600_000,
  });
  const calls = [];
  const client = createSearchConsoleClient({
    config,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ rows: [] });
    },
  });

  await client.searchAnalytics({
    startDate: "2026-08-01",
    endDate: "2026-09-01",
    dimensions: ["query"],
  });

  assert.match(calls[0].url, /searchAnalytics\/query$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    startDate: "2026-08-01",
    endDate: "2026-09-01",
    dimensions: ["query"],
  });
});

test("expired access tokens are refreshed and persisted before the API call", async (t) => {
  const config = await makeConfig(t, {
    access_token: "expired-access",
    refresh_token: "refresh-token",
    expiry_date: 1,
  });
  const calls = [];
  const client = createSearchConsoleClient({
    config,
    now: () => 2_000_000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "new-access", expires_in: 3600, token_type: "Bearer" });
      }
      return Response.json({ siteUrl: config.property });
    },
  });

  await client.propertyStatus();

  assert.equal(calls.length, 2);
  assert.match(String(calls[0].init.body), /grant_type=refresh_token/);
  assert.equal(calls[1].init.headers.Authorization, "Bearer new-access");
  const persisted = JSON.parse(await fs.readFile(config.tokenPath, "utf8"));
  assert.equal(persisted.access_token, "new-access");
  assert.equal(persisted.refresh_token, "refresh-token");
});

test("Google API failures are safe and do not expose bearer tokens", async (t) => {
  const config = await makeConfig(t, {
    access_token: "do-not-leak",
    refresh_token: "refresh",
    expiry_date: Date.now() + 600_000,
  });
  const client = createSearchConsoleClient({
    config,
    fetchImpl: async () => Response.json(
      { error: { code: 403, message: "Insufficient permission" } },
      { status: 403 },
    ),
  });

  await assert.rejects(
    () => client.propertyStatus(),
    (error) => {
      assert.match(error.message, /403.*Insufficient permission/);
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    },
  );
});
