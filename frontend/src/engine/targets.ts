import { VITAMIN_IDS } from './types';
import type { Catalog, Member, NutrientTarget, VitaminId } from './types';

export const ACTIVITY_FACTORS: Record<NonNullable<Member['activity']>, number> = {
  low: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

export const GOAL_FACTORS: Record<NonNullable<Member['goal']>, number> = {
  maintain: 1,
  lose: 0.85,
  gain: 1.1,
};

export interface EnergyEstimate {
  available: boolean;
  kcal: number | null;
  method: string;
  reason: string | null;
}

/**
 * Orientation estimate for adults (18+) by the Mifflin–St Jeor equation (1990) × activity factor
 * × goal factor. Not a medical prescription. Minors never get an automatic estimate or a deficit.
 */
export function estimateEnergy(member: Member): EnergyEstimate {
  const method = 'Миффлин — Сан Жеор (1990) × коэффициент активности × коэффициент цели (Foodo)';
  if (member.age === null || member.age < 18) {
    return {
      available: false,
      kcal: null,
      method,
      reason: 'Для детей и подростков автоматический расчёт не выполняется: используйте простые порции или задайте цель вручную после консультации со специалистом.',
    };
  }
  if (!member.sex || !member.weight_kg || !member.height_cm || !member.activity) {
    return { available: false, kcal: null, method, reason: 'Нужны пол, вес, рост и активность.' };
  }
  const base =
    10 * member.weight_kg + 6.25 * member.height_cm - 5 * member.age + (member.sex === 'male' ? 5 : -161);
  const goal = member.goal ? GOAL_FACTORS[member.goal] : 1;
  return { available: true, kcal: Math.round(base * ACTIVITY_FACTORS[member.activity] * goal), method, reason: null };
}

export type TargetStatus = 'ok' | 'no_target' | 'incompatible_form' | 'demo_not_allowed' | 'not_applicable';

export interface ResolvedVitaminTarget {
  nutrient: VitaminId;
  status: TargetStatus;
  daily: number | null;
  form: string | null;
  setId: string | null;
  setStatus: string | null;
  message: string;
}

function pickTarget(targets: NutrientTarget[], nutrient: VitaminId, member: Member): NutrientTarget | null {
  for (const t of targets) {
    if (t.nutrient !== nutrient) continue;
    if (t.sex && t.sex !== member.sex) continue;
    if (t.min_age !== undefined && (member.age === null || member.age < t.min_age)) continue;
    if (t.max_age !== undefined && (member.age === null || member.age > t.max_age)) continue;
    return t;
  }
  return null;
}

/**
 * Resolves the daily vitamin targets for one member. Manual targets win over the selected set.
 * Demo targets are applied only when the plan explicitly runs the demo scenario.
 * A target is usable only when its form matches the form stored in product data (no conversion
 * between RE/RAE or folate equivalents is ever performed).
 */
export function resolveVitaminTargets(
  catalog: Catalog,
  member: Member,
  setId: string | null,
  demoAllowed: boolean,
): ResolvedVitaminTarget[] {
  const set = setId ? (catalog.targetSets[setId] ?? null) : null;
  const dataForms = new Map(catalog.reference.nutrients.map((n) => [n.id, n.form]));
  const result: ResolvedVitaminTarget[] = [];
  for (const nutrient of VITAMIN_IDS) {
    const dataForm = dataForms.get(nutrient) ?? null;
    const manual = member.vitamin_targets_manual ? pickTarget(member.vitamin_targets_manual, nutrient, member) : null;
    if (manual) {
      result.push(
        manual.form === dataForm
          ? { nutrient, status: 'ok', daily: manual.value, form: manual.form, setId: 'manual', setStatus: 'manual', message: 'Цель задана вручную.' }
          : {
              nutrient, status: 'incompatible_form', daily: null, form: manual.form, setId: 'manual', setStatus: 'manual',
              message: `Форма цели (${manual.form}) не совпадает с формой данных продуктов (${dataForm ?? 'нет'}).`,
            },
      );
      continue;
    }
    if (!set) {
      result.push({ nutrient, status: 'no_target', daily: null, form: null, setId: null, setStatus: null, message: 'Целевая норма не выбрана.' });
      continue;
    }
    if (set.demo && !demoAllowed) {
      result.push({
        nutrient, status: 'demo_not_allowed', daily: null, form: null, setId: set.id, setStatus: set.status,
        message: 'Демонстрационные значения не применяются к реальным профилям.',
      });
      continue;
    }
    if (set.min_age !== null && (member.age === null || member.age < set.min_age)) {
      result.push({
        nutrient, status: 'not_applicable', daily: null, form: null, setId: set.id, setStatus: set.status,
        message: `Набор «${set.name}» рассчитан на возраст от ${set.min_age} лет.`,
      });
      continue;
    }
    const target = pickTarget(set.targets, nutrient, member);
    if (!target) {
      result.push({
        nutrient, status: 'no_target', daily: null, form: null, setId: set.id, setStatus: set.status,
        message: 'В выбранном наборе нет цели для этого участника.',
      });
      continue;
    }
    if (target.form !== dataForm) {
      result.push({
        nutrient, status: 'incompatible_form', daily: null, form: target.form, setId: set.id, setStatus: set.status,
        message: target.note ?? `Форма цели (${target.form}) не совпадает с формой данных продуктов (${dataForm ?? 'нет'}).`,
      });
      continue;
    }
    result.push({
      nutrient, status: 'ok', daily: target.value, form: target.form, setId: set.id, setStatus: set.status,
      message: set.status === 'unverified' ? 'Значение не сверено с первоисточником.' : set.status === 'demo' ? 'Демонстрационное значение, не норма.' : 'Значение из справочника.',
    });
  }
  return result;
}
