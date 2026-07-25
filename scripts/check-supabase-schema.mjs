import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
  console.error(`Не заданы переменные окружения: ${missingEnvironment.join(", ")}`);
  process.exit(1);
}

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

const expectedTables = new Map();
const expectedBuckets = new Map();

function splitDefinitions(body) {
  const definitions = [];
  let current = "";
  let depth = 0;
  let quote = null;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const previous = body[index - 1];

    if ((character === "'" || character === '"') && previous !== "\\") {
      quote = quote === character ? null : quote ?? character;
    }

    if (!quote) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === "," && depth === 0) {
        definitions.push(current.trim());
        current = "";
        continue;
      }
    }

    current += character;
  }

  if (current.trim()) definitions.push(current.trim());
  return definitions;
}

for (const migrationFile of migrationFiles) {
  const sql = await readFile(path.join(migrationsDirectory, migrationFile), "utf8");
  const withoutComments = sql.replace(/--.*$/gm, "");

  for (const match of withoutComments.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\."?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi,
  )) {
    const [, tableName, body] = match;
    const columns = new Set();

    for (const definition of splitDefinitions(body)) {
      const columnMatch = definition.match(/^(?:"([^"]+)"|([a-z_][a-z0-9_]*))/i);
      const columnName = columnMatch?.[1] ?? columnMatch?.[2];
      if (!columnName || /^(constraint|primary|unique|check|foreign|exclude)$/i.test(columnName)) continue;
      columns.add(columnName);
    }

    expectedTables.set(tableName, columns);
  }

  for (const match of withoutComments.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?public\."?([a-z_][a-z0-9_]*)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    const [, tableName, quotedColumn, plainColumn] = match;
    expectedTables.get(tableName)?.add(quotedColumn ?? plainColumn);
  }

  for (const match of withoutComments.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?public\."?([a-z_][a-z0-9_]*)"?\s+drop\s+column\s+(?:if\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
  )) {
    const [, tableName, quotedColumn, plainColumn] = match;
    expectedTables.get(tableName)?.delete(quotedColumn ?? plainColumn);
  }

  for (const match of withoutComments.matchAll(
    /insert\s+into\s+storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*(true|false)/gi,
  )) {
    expectedBuckets.set(match[1], match[2].toLowerCase() === "true");
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

const schemaResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
  headers: {
    Accept: "application/openapi+json",
    apikey: secretKey,
  },
});

if (!schemaResponse.ok) {
  console.error(`Не удалось получить OpenAPI-схему Supabase: HTTP ${schemaResponse.status}`);
  process.exit(1);
}

const openApi = await schemaResponse.json();
const remoteDefinitions = openApi.definitions ?? openApi.components?.schemas ?? {};
const remoteTables = new Map(
  Object.entries(remoteDefinitions)
    .filter(([, definition]) => definition?.properties)
    .map(([tableName, definition]) => [tableName, new Set(Object.keys(definition.properties))]),
);

const differences = [];

for (const [tableName, expectedColumns] of expectedTables) {
  const remoteColumns = remoteTables.get(tableName);

  if (!remoteColumns) {
    differences.push(`В удалённой схеме отсутствует таблица public.${tableName}`);
    continue;
  }

  const missingColumns = [...expectedColumns].filter((column) => !remoteColumns.has(column));
  const extraColumns = [...remoteColumns].filter((column) => !expectedColumns.has(column));

  if (missingColumns.length > 0) {
    differences.push(`public.${tableName}: отсутствуют колонки ${missingColumns.join(", ")}`);
  }
  if (extraColumns.length > 0) {
    differences.push(`public.${tableName}: лишние колонки ${extraColumns.join(", ")}`);
  }
}

for (const remoteTable of remoteTables.keys()) {
  if (!expectedTables.has(remoteTable)) {
    differences.push(`Удалённая таблица public.${remoteTable} отсутствует в локальных миграциях`);
  }
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: remoteBuckets, error: bucketsError } = await supabase.storage.listBuckets();

if (bucketsError) {
  differences.push(`Не удалось проверить Storage buckets: ${bucketsError.message}`);
} else {
  const actualBuckets = new Map(remoteBuckets.map((bucket) => [bucket.id, bucket.public]));

  for (const [bucketId, isPublic] of expectedBuckets) {
    if (!actualBuckets.has(bucketId)) {
      differences.push(`В Storage отсутствует bucket ${bucketId}`);
    } else if (actualBuckets.get(bucketId) !== isPublic) {
      differences.push(`Storage bucket ${bucketId}: public=${actualBuckets.get(bucketId)}, ожидалось ${isPublic}`);
    }
  }
}

if (differences.length > 0) {
  console.error("Локальные миграции и удалённая схема расходятся:");
  for (const difference of differences) console.error(`- ${difference}`);
  process.exit(1);
}

console.log(
  `Схема совпадает: ${expectedTables.size} таблиц public и ${expectedBuckets.size} Storage buckets.`,
);
