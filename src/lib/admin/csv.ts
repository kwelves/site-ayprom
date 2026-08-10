// Минимальный разбор CSV по RFC 4180 без сторонних зависимостей: кавычки,
// экранированные кавычки внутри поля (""), запятые и переводы строк внутри
// кавычек. Достаточно для файлов, которые реально экспортируют Excel и
// Google Таблицы — полноценный CSV-грамматический автомат, а не split(",").
//
// \r\n, \r и \n внутри кавычек сохраняются как есть (сохраняет многострочные
// описания в ячейках); вне кавычек любой из них завершает строку.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // BOM — Excel на Windows добавляет его в CSV по умолчанию.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Последняя строка без завершающего перевода — обычное дело для файлов,
  // сохранённых без хвостового \n.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Полностью пустые строки (частый мусор в конце экспортированного файла)
  // не несут данных ни при каком количестве колонок.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

// Строит из сырых строк CSV массив объектов по заголовку — заголовок
// приводится к нижнему регистру и обрезается по краям, чтобы не зависеть от
// регистра и лишних пробелов в исходном файле.
export function csvToRecords(text: string): CsvTable {
  const [headerRow, ...dataRows] = parseCsv(text);
  const header = (headerRow ?? []).map((h) => h.trim().toLowerCase());

  const rows = dataRows.map((values) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      if (key) record[key] = (values[index] ?? "").trim();
    });
    return record;
  });

  return { header, rows };
}
