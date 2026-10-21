// The «Анкета» that comes before the first menu: answers, their defaults (pre-filled from an
// existing household) and how they become household settings and member fields. Kept free of React
// so the conversion can be tested on its own.

import { DEFAULT_SETTINGS, estimateEnergy } from '../engine';
import type { DietMode, Member, PlanSettings, RepeatMode, Restrictions, SkillLevel } from '../engine';
import type { HouseholdSettings, HouseholdView } from '../data/types';

export type Goal = 'simple' | 'maintain' | 'lose' | 'gain';

export interface ChildAnswer {
  age: number;
}

export interface Answers {
  adults: number;
  children: ChildAnswer[];
  goal: Goal;
  me: { sex: 'male' | 'female' | null; age: number | null; height_cm: number | null; weight_kg: number | null; activity: Member['activity'] };
  diet_mode: DietMode;
  diet_types: string[];
  restrictions: Restrictions;
  cuisines: string[];
  liked_products: string[];
  disliked_products: string[];
  spice: number;
  skill: SkillLevel;
  equipment: string[];
  weekday_min: number | null;
  /** «same» — the weekday limit applies on weekends too. */
  weekend_min: number | null | 'same';
  slots: string[];
  days: number;
  repeat: RepeatMode;
  container_days: number[];
  budget_rub: number | null;
  vitamins: boolean;
}

export const SLOT_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

/** Popular products offered as «люблю / не люблю» chips; only ids present in the catalog are shown. */
export const TASTE_PRODUCTS = [
  'chicken_breast',
  'beef',
  'pork',
  'turkey_mince',
  'salmon_fillet',
  'cod_fillet',
  'shrimp',
  'eggs',
  'cottage_cheese',
  'cheese_hard',
  'champignons',
  'potato',
  'buckwheat_dry',
  'rice_white_dry',
  'pasta_dry',
  'pumpkin',
  'broccoli',
  'zucchini',
  'eggplant',
  'cabbage',
  'beet',
  'avocado',
  'chickpeas_canned',
  'red_lentils_dry',
  'apple',
  'banana',
  'blueberries_frozen',
  'olives',
] as const;

export function defaultAnswers(household: HouseholdView | null): Answers {
  const settings: HouseholdSettings | null = household?.settings ?? null;
  const plan: PlanSettings = settings?.plan ?? structuredClone(DEFAULT_SETTINGS);
  const members = household?.members ?? [];
  const adults = members.filter((m) => m.age === null || m.age >= 18);
  const kids = members.filter((m) => m.age !== null && m.age < 18);
  const first = adults[0] ?? members[0] ?? null;
  const goal: Goal = first?.portion_mode === 'target' && first.goal ? first.goal : 'simple';
  const weekend: number | null | 'same' =
    plan.max_total_min_weekend === undefined || plan.max_total_min_weekend === plan.max_total_min ? 'same' : plan.max_total_min_weekend;
  return {
    adults: members.length > 0 ? adults.length : 2,
    children: kids.map((k) => ({ age: k.age ?? 8 })),
    goal,
    me: {
      sex: first?.sex ?? null,
      age: first?.age ?? null,
      height_cm: first?.height_cm ?? null,
      weight_kg: first?.weight_kg ?? null,
      activity: first?.activity ?? 'moderate',
    },
    diet_mode: plan.diet_mode,
    diet_types: first?.diet_types ?? [],
    restrictions: first ? structuredClone(first.restrictions) : { products: [], categories: [], allergens: [] },
    cuisines: plan.cuisines ?? [],
    liked_products: first?.preferences.liked_products ?? [],
    disliked_products: first?.preferences.disliked_products ?? [],
    spice: first?.spice_tolerance ?? 1,
    skill: plan.skill,
    equipment: [...plan.equipment],
    weekday_min: plan.max_total_min,
    weekend_min: weekend,
    slots: settings?.slots ?? ['breakfast', 'lunch', 'snack', 'dinner'],
    days: settings?.days ?? 7,
    repeat: plan.repeat.mode,
    container_days: [...plan.container_days],
    budget_rub: plan.budget.limit_kop === null ? null : Math.round(plan.budget.limit_kop / 100),
    vitamins: plan.vitamins.enabled,
  };
}

/** Simple portion for a child; children never get a calorie deficit or hot food by default. */
export function childPortion(age: number): number {
  if (age < 4) return 0.4;
  if (age < 8) return 0.5;
  if (age < 12) return 0.7;
  return 0.9;
}

export function planSettings(a: Answers, base: PlanSettings): PlanSettings {
  return {
    ...base,
    diet_mode: a.diet_mode,
    skill: a.skill,
    equipment: [...a.equipment],
    max_total_min: a.weekday_min,
    max_total_min_weekend: a.weekend_min === 'same' ? a.weekday_min : a.weekend_min,
    cuisines: [...a.cuisines],
    repeat: { ...base.repeat, mode: a.repeat },
    container_days: a.slots.includes('lunch') ? [...a.container_days].sort() : [],
    budget: { ...base.budget, limit_kop: a.budget_rub === null ? null : Math.round(a.budget_rub * 100) },
    vitamins: { ...base.vitamins, enabled: a.vitamins },
  };
}

export type MemberDraft = Partial<Member> & { name: string };

/**
 * Member fields from the answers. The shared answers (diet types, bans, likes) apply to everyone;
 * the calorie goal applies to the first adult only, and only when their data allows an estimate.
 */
export function memberDrafts(a: Answers, timezone: string): MemberDraft[] {
  const shared = {
    diet_types: [...a.diet_types],
    restrictions: structuredClone(a.restrictions),
    preferences: { liked_recipes: [], disliked_products: [...a.disliked_products], liked_products: [...a.liked_products] },
    timezone,
  };
  const out: MemberDraft[] = [];
  for (let i = 0; i < a.adults; i += 1) {
    const isMe = i === 0;
    const base: MemberDraft = {
      ...shared,
      name: a.adults === 1 ? 'Я' : isMe ? 'Я' : `Взрослый ${i + 1}`,
      age: null,
      portion_mode: 'simple',
      portion_factor: 1,
      kcal_target: null,
      spice_tolerance: a.spice,
    };
    if (isMe && a.goal !== 'simple') {
      const draft = { ...base, ...a.me, goal: a.goal } as Member;
      const estimate = estimateEnergy(draft);
      Object.assign(base, a.me, { goal: a.goal });
      if (estimate.available && estimate.kcal !== null) {
        base.portion_mode = 'target';
        base.kcal_target = estimate.kcal;
      }
    }
    out.push(base);
  }
  a.children.forEach((c, i) => {
    out.push({
      ...shared,
      name: a.children.length === 1 ? 'Ребёнок' : `Ребёнок ${i + 1}`,
      age: c.age,
      portion_mode: 'simple',
      portion_factor: childPortion(c.age),
      kcal_target: null,
      goal: null,
      spice_tolerance: 0,
    });
  });
  return out;
}

export function slotsInOrder(slots: string[]): string[] {
  return SLOT_ORDER.filter((s) => slots.includes(s));
}
