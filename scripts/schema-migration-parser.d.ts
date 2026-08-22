export function applyAlterTableColumnChanges(
  sql: string,
  expectedTables: Map<string, Set<string>>,
): void;

export function extractCreatedPublicTables(sql: string): Map<string, Set<string>>;
