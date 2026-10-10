import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadOAuthClient,
  loadToken,
  parseOAuthClient,
  saveToken,
} from "../src/oauth-store.mjs";

test("parseOAuthClient accepts Google desktop credentials", () => {
  const parsed = parseOAuthClient({
    installed: {
      client_id: "client-id.apps.googleusercontent.com",
      client_secret: "client-secret",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    },
  });

  assert.equal(parsed.clientId, "client-id.apps.googleusercontent.com");
  assert.equal(parsed.clientSecret, "client-secret");
  assert.equal(parsed.tokenUri, "https://oauth2.googleapis.com/token");
});

test("parseOAuthClient rejects incomplete credentials", () => {
  assert.throws(() => parseOAuthClient({ installed: { client_id: "only-id" } }), /client_secret/i);
});

test("OAuth client and token files round-trip outside the repository", async (t) => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "ayprom-gsc-oauth-"));
  t.after(() => fs.rm(configDir, { recursive: true, force: true }));
  const config = {
    configDir,
    oauthClientPath: path.join(configDir, "oauth-client.json"),
    tokenPath: path.join(configDir, "tokens.json"),
  };

  await fs.writeFile(
    config.oauthClientPath,
    JSON.stringify({ installed: { client_id: "id", client_secret: "secret" } }),
  );
  await saveToken(config, {
    access_token: "access",
    refresh_token: "refresh",
    expiry_date: 123456,
  });

  assert.deepEqual(await loadOAuthClient(config), {
    clientId: "id",
    clientSecret: "secret",
    authUri: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUri: "https://oauth2.googleapis.com/token",
  });
  assert.deepEqual(await loadToken(config), {
    access_token: "access",
    refresh_token: "refresh",
    expiry_date: 123456,
  });
});

test("loadToken explains how to authenticate when the token is missing", async () => {
  await assert.rejects(
    () => loadToken({ tokenPath: path.join(os.tmpdir(), `missing-${crypto.randomUUID()}.json`) }),
    /npm run auth/i,
  );
});
