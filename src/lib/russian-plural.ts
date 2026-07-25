type RussianForms = readonly [one: string, few: string, many: string];

export function pluralizeRussian(count: number, forms: RussianForms): string {
  const absolute = Math.abs(count);
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;

  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export function formatRussianCount(count: number, forms: RussianForms): string {
  return `${count} ${pluralizeRussian(count, forms)}`;
}
