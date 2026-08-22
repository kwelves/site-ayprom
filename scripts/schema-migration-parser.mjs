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

export function extractCreatedPublicTables(sql) {
  const tables = new Map();

  for (const match of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?"?public"?\."?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi,
  )) {
    const [, tableName, body] = match;
    const columns = new Set();

    for (const definition of splitDefinitions(body)) {
      const columnMatch = definition.match(/^(?:"([^"]+)"|([a-z_][a-z0-9_]*))/i);
      const columnName = columnMatch?.[1] ?? columnMatch?.[2];
      if (!columnName || /^(constraint|primary|unique|check|foreign|exclude)$/i.test(columnName)) continue;
      columns.add(columnName);
    }

    tables.set(tableName, columns);
  }

  return tables;
}

/** Applies every ADD/DROP COLUMN clause, including comma-separated ALTER TABLE statements. */
export function applyAlterTableColumnChanges(sql, expectedTables) {
  for (const statement of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?"?public"?\."?([a-z_][a-z0-9_]*)"?\s+([\s\S]*?);/gi,
  )) {
    const [, tableName, clauses] = statement;
    const columns = expectedTables.get(tableName);
    if (!columns) continue;

    for (const clause of splitDefinitions(clauses)) {
      const addMatch = clause.match(
        /^add\s+column\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/i,
      );
      if (addMatch) {
        columns.add(addMatch[1] ?? addMatch[2]);
        continue;
      }

      const dropMatch = clause.match(
        /^drop\s+column\s+(?:if\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/i,
      );
      if (dropMatch) columns.delete(dropMatch[1] ?? dropMatch[2]);
    }
  }
}
