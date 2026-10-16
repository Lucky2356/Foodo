export function rub(kop: number | null | undefined): string {
  if (kop === null || kop === undefined) return 'нет цены';
  return `${(kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: kop % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })} ₽`;
}

export function num(value: number, digits = 0): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function kcal(value: number): string {
  return `${num(Math.round(value))} ккал`;
}

export function grams(value: number): string {
  return value >= 1000 ? `${num(value / 1000, 2)} кг` : `${num(value, value < 10 ? 1 : 0)} г`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

export function portionLabel(factor: number): string {
  if (factor === 1) return '1 порция';
  return `${num(factor, 2)} ${plural(Math.ceil(factor), 'порция', 'порции', 'порций')}`;
}

export function minutes(total: number): string {
  if (total < 60) return `${total} мин`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
