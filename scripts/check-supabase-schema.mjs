import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyAlterTableColumnChanges,
  extractCreatedPublicTables,
} from "./schema-migration-parser.mjs";

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

for (const migrationFile of migrationFiles) {
  const sql = await readFile(path.join(migrationsDirectory, migrationFile), "utf8");
  const withoutComments = sql.replace(/--.*$/gm, "");

  for (const [tableName, columns] of extractCreatedPublicTables(withoutComments)) {
    expectedTables.set(tableName, columns);
  }

  applyAlterTableColumnChanges(withoutComments, expectedTables);

  // Один INSERT может задавать сразу несколько bucket'ов, поэтому сначала
  // выделяется всё выражение до `;`, а потом из него разбираются все кортежи.
  // Прежняя версия читала только первый и молча теряла остальные.
  for (const statement of withoutComments.matchAll(
    /insert\s+into\s+"?storage"?\."?buckets"?[^;]*?values\s*([\s\S]*?);/gi,
  )) {
    for (const tuple of statement[1].matchAll(/\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*(true|false)/gi)) {
      expectedBuckets.set(tuple[1], tuple[2].toLowerCase() === "true");
    }
  }
}

const schemasDirectory = path.join(process.cwd(), "supabase", "schemas");
const schemaFiles = (await readdir(schemasDirectory)).filter((fileName) => fileName.endsWith(".sql")).sort();
const declaredTables = new Map();
for (const schemaFile of schemaFiles) {
  const sql = await readFile(path.join(schemasDirectory, schemaFile), "utf8");
  for (const [tableName, columns] of extractCreatedPublicTables(sql.replace(/--.*$/gm, ""))) {
    declaredTables.set(tableName, columns);
  }
}

const declarationDifferences = [];
for (const [tableName, migrationColumns] of expectedTables) {
  const declaredColumns = declaredTables.get(tableName);
  if (!declaredColumns) {
    declarationDifferences.push(`public.${tableName}: таблица отсутствует в supabase/schemas`);
    continue;
  }
  const missing = [...migrationColumns].filter((column) => !declaredColumns.has(column));
  const extra = [...declaredColumns].filter((column) => !migrationColumns.has(column));
  if (missing.length > 0) declarationDifferences.push(`public.${tableName}: в декларации нет колонок ${missing.join(", ")}`);
  if (extra.length > 0) declarationDifferences.push(`public.${tableName}: в декларации лишние колонки ${extra.join(", ")}`);
}
for (const tableName of declaredTables.keys()) {
  if (!expectedTables.has(tableName)) {
    declarationDifferences.push(`public.${tableName}: декларация не представлена миграциями`);
  }
}

if (declarationDifferences.length > 0) {
  console.error("Декларативная схема и миграции расходятся:");
  for (const difference of declarationDifferences) console.error(`- ${difference}`);
  process.exit(1);
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
