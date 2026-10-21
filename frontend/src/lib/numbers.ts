/**
 * Number input: Russian users type a decimal comma («70,5»), spaces between thousands («10 000»).
 * Empty text is «no value» (null); anything that is not a number is NaN, so validation can reject
 * it instead of treating it as empty.
 */
export function parseNumberInput(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

export function formatNumberInput(value: number | null): string {
  return value === null || Number.isNaN(value) ? '' : String(value).replace('.', ',');
}

/** Allowed ranges for member data — the same as the server model (backend/households/models.py). */
export const MEMBER_LIMITS = {
  age: { min: 0, max: 120, integer: true, label: 'Возраст', unit: 'лет' },
  height_cm: { min: 40, max: 250, integer: false, label: 'Рост', unit: 'см' },
  weight_kg: { min: 2, max: 400, integer: false, label: 'Вес', unit: 'кг' },
  kcal_target: { min: 500, max: 6000, integer: true, label: 'Цель по калориям', unit: 'ккал' },
  water_goal_ml: { min: 100, max: 10000, integer: true, label: 'Норма воды', unit: 'мл' },
} as const;

export type MemberLimitKey = keyof typeof MEMBER_LIMITS;

/** An error message for a value outside its range, or null when it is fine (null = not given). */
export function rangeError(key: MemberLimitKey, value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const l = MEMBER_LIMITS[key];
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  if (!Number.isFinite(value) || value < l.min || value > l.max || (l.integer && !Number.isInteger(value))) {
    return `${l.label} — ${l.integer ? 'целое число ' : ''}от ${fmt(l.min)} до ${fmt(l.max)} ${l.unit}.`;
  }
  return null;
}

/** A non-negative amount of money in roubles, or null for «no limit». */
export function budgetError(value: number | null): string | null {
  if (value === null) return null;
  return Number.isFinite(value) && value >= 0 ? null : 'Бюджет — сумма в рублях, 0 или больше.';
}
