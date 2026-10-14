import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function startServer() {
  const child = spawn(process.execPath, [path.join(root, "server.mjs")], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  let nextId = 1;
  return {
    child,
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
  };
}

test("stdio server initializes and lists the guarded AYPROM tools", async (t) => {
  const server = startServer();
  t.after(() => server.child.kill());

  const initialized = await server.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "ayprom-test", version: "1.0.0" },
  });
  assert.equal(initialized.result.serverInfo.name, "ayprom-search-console");
  server.notify("notifications/initialized");

  const listed = await server.request("tools/list");
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      "gsc_auth_status",
      "gsc_property_status",
      "gsc_search_analytics",
      "gsc_list_sitemaps",
      "gsc_get_sitemap",
      "gsc_inspect_url",
      "gsc_submit_sitemap",
      "gsc_delete_sitemap",
    ],
  );
  assert.equal(
    listed.result.tools.find((tool) => tool.name === "gsc_submit_sitemap").annotations.readOnlyHint,
    false,
  );

  const auth = await server.request("tools/call", {
    name: "gsc_auth_status",
    arguments: {},
  });
  const authStatus = JSON.parse(auth.result.content[0].text);
  assert.equal(authStatus.property, "sc-domain:ayprom-gidravlika.kg");
  assert.equal(typeof authStatus.authenticated, "boolean");
});
