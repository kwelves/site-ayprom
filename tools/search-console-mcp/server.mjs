import readline from "node:readline";

import { createAuditAppender } from "./src/audit-log.mjs";
import { loadConfig } from "./src/config.mjs";
import { createSearchConsoleClient } from "./src/google-client.mjs";
import { loadOAuthClient, loadToken } from "./src/oauth-store.mjs";
import { createToolHandlers } from "./src/tool-handlers.mjs";

const config = loadConfig();
const client = createSearchConsoleClient({ config });

async function authStatus() {
  let clientReady = false;
  let tokenReady = false;
  let refreshTokenReady = false;
  try {
    await loadOAuthClient(config);
    clientReady = true;
  } catch {}
  try {
    const token = await loadToken(config);
    tokenReady = Boolean(token.access_token || token.refresh_token);
    refreshTokenReady = Boolean(token.refresh_token);
  } catch {}
  return {
    authenticated: clientReady && tokenReady && refreshTokenReady,
    property: config.property,
    oauthClientConfigured: clientReady,
    tokenConfigured: tokenReady,
    refreshTokenConfigured: refreshTokenReady,
    configDirectory: config.configDir,
    nextStep: clientReady && refreshTokenReady
      ? "Ready for Search Console API calls."
      : "Place oauth-client.json in the config directory, then run npm run auth in the plugin directory.",
  };
}

const handlers = createToolHandlers({
  client,
  config,
  authStatus,
  appendAudit: createAuditAppender(config),
});

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const sitemapSchema = { type: "string", format: "uri", pattern: "^https://" };
const emptySchema = { type: "object", additionalProperties: false };

const tools = [
  {
    name: "gsc_auth_status",
    description: "Проверяет локальную готовность OAuth для AYPROM без раскрытия секретов.",
    inputSchema: emptySchema,
    annotations: readAnnotations,
  },
  {
    name: "gsc_property_status",
    description: "Возвращает уровень доступа к sc-domain:ayprom-gidravlika.kg.",
    inputSchema: emptySchema,
    annotations: readAnnotations,
  },
  {
    name: "gsc_search_analytics",
    description: "Читает клики, показы, CTR и среднюю позицию AYPROM из Search Analytics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["startDate", "endDate"],
      properties: {
        startDate: dateSchema,
        endDate: dateSchema,
        dimensions: {
          type: "array",
          maxItems: 7,
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["query", "page", "country", "device", "date", "searchAppearance", "hour"],
          },
        },
        rowLimit: { type: "integer", minimum: 1, maximum: 25000, default: 1000 },
        startRow: { type: "integer", minimum: 0, default: 0 },
        type: {
          type: "string",
          enum: ["web", "image", "video", "news", "discover", "googleNews"],
        },
        dataState: { type: "string", enum: ["final", "all", "hourly_all"] },
        filters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["dimension", "operator", "expression"],
            properties: {
              dimension: {
                type: "string",
                enum: ["query", "page", "country", "device", "date", "searchAppearance"],
              },
              operator: {
                type: "string",
                enum: ["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"],
              },
              expression: { type: "string", minLength: 1, maxLength: 4096 },
            },
          },
        },
      },
    },
    annotations: readAnnotations,
  },
  {
    name: "gsc_list_sitemaps",
    description: "Перечисляет sitemap, известные Google для AYPROM.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { sitemapIndex: sitemapSchema },
    },
    annotations: readAnnotations,
  },
  {
    name: "gsc_get_sitemap",
    description: "Читает статус конкретного sitemap AYPROM.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sitemapUrl"],
      properties: { sitemapUrl: sitemapSchema },
    },
    annotations: readAnnotations,
  },
  {
    name: "gsc_inspect_url",
    description: "Читает состояние URL AYPROM в индексе Google; не запускает переобход.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", format: "uri", pattern: "^https://" },
        languageCode: { type: "string", default: "ru-RU", maxLength: 35 },
      },
    },
    annotations: readAnnotations,
  },
  {
    name: "gsc_submit_sitemap",
    description: "Отправляет sitemap AYPROM. Требует точную фразу SUBMIT <нормализованный URL>.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sitemapUrl", "confirmation"],
      properties: {
        sitemapUrl: sitemapSchema,
        confirmation: { type: "string", minLength: 8 },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "gsc_delete_sitemap",
    description: "Удаляет sitemap из Search Console. Требует точную фразу DELETE <нормализованный URL>.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sitemapUrl", "confirmation"],
      properties: {
        sitemapUrl: sitemapSchema,
        confirmation: { type: "string", minLength: 8 },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

const methodHandlers = {
  gsc_auth_status: handlers.authStatus,
  gsc_property_status: handlers.propertyStatus,
  gsc_search_analytics: handlers.searchAnalytics,
  gsc_list_sitemaps: handlers.listSitemaps,
  gsc_get_sitemap: handlers.getSitemap,
  gsc_inspect_url: handlers.inspectUrl,
  gsc_submit_sitemap: handlers.submitSitemap,
  gsc_delete_sitemap: handlers.deleteSitemap,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function protocolError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return;
  }
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion || "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ayprom-search-console", version: "0.1.0" },
      instructions: "Use only the fixed AYPROM Search Console property. Write tools require explicit confirmation.",
    });
    return;
  }
  if (message.method === "ping") {
    result(message.id, {});
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const handler = methodHandlers[name];
    if (!handler) {
      protocolError(message.id, -32602, `Unknown tool: ${name}`);
      return;
    }
    try {
      const value = await handler(message.params?.arguments || {});
      result(message.id, {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      });
    } catch (error) {
      result(message.id, {
        isError: true,
        content: [{ type: "text", text: String(error?.message || error) }],
      });
    }
    return;
  }
  if (message.id !== undefined) {
    protocolError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    protocolError(null, -32700, "Parse error");
    return;
  }
  Promise.resolve(handle(message)).catch((error) => {
    if (message.id !== undefined) protocolError(message.id, -32603, String(error?.message || error));
  });
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
