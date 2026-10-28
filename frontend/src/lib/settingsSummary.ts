// One-line summaries of the settings screens for the profile hub: what is set now, in plain words.

import type { HouseholdView } from '../data/types';
import { plural } from './format';

const REPEAT = { unique: 'каждый день новое', allow: 'блюда могут повторяться', batch: 'готовлю на 2–3 дня' } as const;
const SKILL = { beginner: 'простые блюда', confident: 'обычные домашние блюда', any: 'любые блюда' } as const;
const DIET = { regular: 'обычное питание', balanced: 'ПП', high_protein: 'больше белка' } as const;

function daysLabel(days: number): string {
  if (days === 7) return 'неделя';
  if (days === 14) return '2 недели';
  if (days % 7 === 0) return `${days / 7} ${plural(days / 7, 'неделя', 'недели', 'недель')}`;
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

function minutes(t: number | null): string {
  return t === null ? 'время любое' : `до ${t} мин в будни`;
}

export function menuSummary(h: HouseholdView): string {
  const n = h.settings.slots.length;
  return [`${n} ${plural(n, 'приём', 'приёма', 'приёмов')} пищи`, daysLabel(h.settings.days), REPEAT[h.settings.plan.repeat.mode]].join(' · ');
}

export function kitchenSummary(h: HouseholdView): string {
  const p = h.settings.plan;
  const n = p.equipment.length;
  return [SKILL[p.skill], n === 0 ? 'без техники' : `${n} ${plural(n, 'прибор', 'прибора', 'приборов')}`, minutes(p.max_total_min)].join(' · ');
}

export function foodSummary(h: HouseholdView): string {
  const p = h.settings.plan;
  const cuisines = p.cuisines?.length ?? 0;
  return [DIET[p.diet_mode], cuisines ? `${cuisines} ${plural(cuisines, 'любимая кухня', 'любимые кухни', 'любимых кухонь')}` : null, p.vitamins.enabled ? 'с учётом витаминов' : null]
    .filter(Boolean)
    .join(' · ');
}

export function shoppingSummary(h: HouseholdView, chainName: string | null, formatRub: (kop: number) => string): string {
  const limit = h.settings.plan.budget.limit_kop;
  return [h.city ? h.city.name : 'город не выбран — цен нет', h.city ? (chainName ?? 'любой магазин') : null, limit === null ? 'без бюджета' : `бюджет ${formatRub(limit)}`]
    .filter(Boolean)
    .join(' · ');
}
