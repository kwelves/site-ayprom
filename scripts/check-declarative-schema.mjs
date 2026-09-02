// QA-014: `supabase/schemas/prod.sql` объявлен источником истины, но ведётся
// руками и разошёлся с миграциями — из него пропала таблица
// `admin_credentials`, а имя CHECK у `admin_auth_events` было выдумано.
//
// Опасность не в самой базе: файл не выполняется. Опасность в том, что он
// служит входом для генерации будущих миграций, и `supabase db diff -f ...` на
// разошедшемся файле выписал бы миграцию, УДАЛЯЮЩУЮ таблицу с хешем пароля
// администратора.
//
// Почему эталон берётся из базы, а не из текста миграций. Часть констрейнтов
// объявлена безымянно прямо на колонке (`attempt_key_hash text CHECK (...)`), и
// имя им присваивает сам Postgres по правилу «таблица_колонка_check». В тексте
// миграции этого имени нет вообще, поэтому текстовое сравнение такую ошибку не
// поймает в принципе. Единственный источник настоящих имён — сама база, и она
// читается официальным `supabase db dump`.
//
// Сверка идёт по именам объектов, а не по их полным определениям: этого хватает,
// чтобы поймать пропавшую таблицу, забытый констрейнт или разъехавшееся имя, и
// при этом проверка не притворяется полноценным schema-differ'ом.
//
// QA-013 — это другая находка (права клиентских ролей), не путать.
import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const declarativePath = path.join(process.cwd(), "supabase", "schemas", "prod.sql");

/**
 * Ограничение времени на снятие схемы. Без него проверка молча висела бы,
 * пока Docker не ответит: `supabase db dump` ждёт демон без собственного
 * таймаута, и в CI это выглядело бы как зависший шаг без единой строки
 * объяснения.
 */
const DUMP_TIMEOUT_MS = 120_000;

/**
 * Порог правдоподобия дампа. Пустая или неинициализированная база даёт
 * синтаксически валидный дамп почти без объектов, и тогда сверка честно, но
 * бесполезно объявила бы расхождением весь файл. Лучше сказать прямо, что
 * сравнивать не с чем.
 */
const MIN_EXPECTED_OBJECTS = 20;

// Оба файла имеют формат pg_dump, поэтому к ним применяются одни и те же
// выражения: систематическая погрешность разбора сокращается с обеих сторон.
const OBJECT_PATTERNS = [
  { kind: "table", pattern: /CREATE TABLE (?:IF NOT EXISTS )?"public"\."([^"]+)"/g },
  { kind: "constraint", pattern: /(?:ADD )?CONSTRAINT "([^"]+)"/g },
  { kind: "function", pattern: /CREATE (?:OR REPLACE )?FUNCTION "public"\."([^"]+)"/g },
  { kind: "index", pattern: /CREATE (?:UNIQUE )?INDEX "([^"]+)"/g },
  { kind: "policy", pattern: /CREATE POLICY "([^"]+)"/g },
  { kind: "trigger", pattern: /CREATE (?:OR REPLACE )?TRIGGER "([^"]+)"/g },
];

function collectObjects(sql) {
  const objects = new Set();
  for (const { kind, pattern } of OBJECT_PATTERNS) {
    for (const match of sql.matchAll(pattern)) {
      objects.add(`${kind}:${match[1]}`);
    }
  }
  return objects;
}

/** Разбирает причину неудачи в понятную человеку строку. */
function explainDumpFailure(error) {
  const stderr = error.stderr ? String(error.stderr) : "";
  const stdout = error.stdout ? String(error.stdout) : "";
  const output = `${stderr}\n${stdout}`.toLowerCase();
  const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT";

  if (timedOut) {
    return [
      `Снятие схемы не уложилось в ${DUMP_TIMEOUT_MS / 1000} с и было прервано.`,
      "Чаще всего это значит, что Docker Desktop запущен, но не отвечает.",
      "Проверьте `docker ps`, при необходимости перезапустите Docker и `npx supabase start`.",
    ];
  }
  if (output.includes("docker daemon") || output.includes("cannot connect to the docker") || output.includes("docker api")) {
    return [
      "Docker не отвечает: снять схему локальной базы невозможно.",
      "Запустите Docker Desktop и повторите; затем `npx supabase start`.",
    ];
  }
  if (output.includes("supabase start") || output.includes("not running") || output.includes("no such container")) {
    return [
      "Локальный стек Supabase не запущен.",
      "Выполните `npx supabase start` и повторите проверку.",
    ];
  }
  if (output.includes("enoent") || output.includes("не является внутренней") || output.includes("is not recognized")) {
    return [
      "Не удалось запустить Supabase CLI.",
      "Установите Supabase CLI и проверьте `supabase --version`.",
    ];
  }
  return ["Не удалось снять схему локальной базы."];
}

function fail(lines, details) {
  for (const line of lines) console.error(line);
  if (details) {
    console.error("");
    console.error("Вывод команды:");
    console.error(String(details).trim());
  }
  process.exit(1);
}

async function dumpLiveSchema() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ayprom-schema-"));
  const dumpPath = path.join(directory, "live-schema.sql");
  try {
    // CI устанавливает и закрепляет Supabase CLI отдельным setup-action. Прямой
    // вызов использует именно эту версию; `npx supabase` мог бы незаметно
    // скачать другую latest-версию и сделать schema gate невоспроизводимым.
    // Единственная подстановка — временный каталог из `mkdtemp`, не пользовательский ввод.
    execSync(`supabase db dump --local --schema public -f "${dumpPath}"`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DUMP_TIMEOUT_MS,
    });
    return { sql: await readFile(dumpPath, "utf8"), directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    fail(explainDumpFailure(error), error.stderr || error.message);
  }
}

const { sql: liveSql, directory } = await dumpLiveSchema();

let declarativeSql;
try {
  declarativeSql = await readFile(declarativePath, "utf8");
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  fail([`Не найден файл декларативной схемы: ${declarativePath}`], error.message);
}

const liveObjects = collectObjects(liveSql);
const declaredObjects = collectObjects(declarativeSql);

await rm(directory, { recursive: true, force: true });

// Проверяется именно живая база: если объектов подозрительно мало, сравнивать
// не с чем, и молчаливое «расхождение по всему файлу» только запутает.
if (liveObjects.size < MIN_EXPECTED_OBJECTS) {
  fail([
    `В снятой схеме всего ${liveObjects.size} объектов — это не похоже на рабочую базу.`,
    "Похоже, миграции не применены. Выполните `npx supabase db reset --local` и повторите.",
  ]);
}

if (declaredObjects.size < MIN_EXPECTED_OBJECTS) {
  fail([
    `В ${path.relative(process.cwd(), declarativePath)} распознано всего ${declaredObjects.size} объектов.`,
    "Либо файл повреждён, либо изменился формат pg_dump и выражения разбора устарели.",
  ]);
}

const missingFromFile = [...liveObjects].filter((name) => !declaredObjects.has(name)).sort();
const absentFromDatabase = [...declaredObjects].filter((name) => !liveObjects.has(name)).sort();

if (missingFromFile.length === 0 && absentFromDatabase.length === 0) {
  console.log(`Декларативная схема согласована с миграциями (сверено объектов: ${liveObjects.size}).`);
  process.exit(0);
}

if (missingFromFile.length > 0) {
  console.error("Есть в локальной базе, но не объявлено в supabase/schemas/prod.sql:");
  for (const name of missingFromFile) console.error(`  ${name}`);
}

if (absentFromDatabase.length > 0) {
  console.error("Объявлено в supabase/schemas/prod.sql, но отсутствует в локальной базе:");
  for (const name of absentFromDatabase) console.error(`  ${name}`);
}

console.error("");
console.error("QA-014: декларативная схема разошлась с миграциями.");
console.error("Не запускайте `supabase db diff` до устранения: на разошедшемся файле");
console.error("он сгенерирует миграцию, удаляющую недостающие объекты.");
process.exit(1);
