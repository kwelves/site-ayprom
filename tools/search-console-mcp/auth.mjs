import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";

import { loadConfig } from "./src/config.mjs";
import { loadOAuthClient, saveToken } from "./src/oauth-store.mjs";

function base64Url(buffer) {
  return buffer.toString("base64url");
}

function openBrowser(url) {
  let child;
  if (process.platform === "win32") {
    child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } else if (process.platform === "darwin") {
    child = spawn("open", [url], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  }
  child.unref();
}

async function main() {
  const config = loadConfig();
  const oauthClient = await loadOAuthClient(config);
  const state = crypto.randomUUID();
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());

  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((request, response) => {
    try {
      const incoming = new URL(request.url, "http://127.0.0.1");
      if (incoming.pathname !== "/oauth2callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      if (incoming.searchParams.get("state") !== state) {
        throw new Error("OAuth state mismatch.");
      }
      const oauthError = incoming.searchParams.get("error");
      if (oauthError) {
        throw new Error(`Google authorization failed: ${oauthError}`);
      }
      const code = incoming.searchParams.get("code");
      if (!code) {
        throw new Error("Google did not return an authorization code.");
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>AYPROM Search Console connected</h1><p>You can close this tab and return to Codex.</p>");
      resolveCallback(code);
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Authorization failed. Return to the terminal for details.");
      rejectCallback(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const authUrl = new URL(oauthClient.authUri);
  authUrl.search = new URLSearchParams({
    client_id: oauthClient.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  console.log(`Opening Google authorization in your browser.\n${authUrl}`);
  openBrowser(authUrl.toString());

  const timeout = setTimeout(() => rejectCallback(new Error("OAuth authorization timed out.")), 300_000);
  try {
    const code = await callback;
    const body = new URLSearchParams({
      client_id: oauthClient.clientId,
      client_secret: oauthClient.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const response = await fetch(oauthClient.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok || !token.access_token || !token.refresh_token) {
      throw new Error(`Google token exchange failed (${response.status}).`);
    }
    await saveToken(config, {
      ...token,
      expiry_date: Date.now() + Number(token.expires_in || 3600) * 1000,
    });
    console.log(`Authorization saved under ${config.configDir}.`);
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
