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

/** Adults are 18+ or of unknown age; children have an age under 18. */
export function isAdult(m: Pick<Member, 'age'>): boolean {
  return m.age === null || m.age >= 18;
}

function common(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  return lists[0]!.filter((x) => lists.every((l) => l.includes(x)));
}

/** A member's list after the questionnaire: shared items removed or added there, own items kept. */
function applyDiff(current: string[], initial: string[], next: string[]): string[] {
  const removed = new Set(initial.filter((x) => !next.includes(x)));
  const added = next.filter((x) => !initial.includes(x));
  return [...new Set([...current.filter((x) => !removed.has(x)), ...added])];
}

export function defaultAnswers(household: HouseholdView | null): Answers {
  const settings: HouseholdSettings | null = household?.settings ?? null;
  const plan: PlanSettings = settings?.plan ?? structuredClone(DEFAULT_SETTINGS);
  const members = household?.members ?? [];
  const adults = members.filter(isAdult);
  const kids = members.filter((m) => !isAdult(m));
  const first = adults[0] ?? members[0] ?? null;
  // Shared answers show what everyone has in common; a member's own bans and tastes are kept aside
  // and preserved when the questionnaire is taken again (see planHousehold).
  const allOf = (pick: (m: Member) => string[]) => common(members.map(pick));
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
    diet_types: allOf((m) => m.diet_types ?? []),
    restrictions: {
      products: allOf((m) => m.restrictions.products),
      categories: allOf((m) => m.restrictions.categories),
      allergens: allOf((m) => m.restrictions.allergens),
    },
    cuisines: plan.cuisines ?? [],
    liked_products: allOf((m) => m.preferences.liked_products ?? []),
    disliked_products: allOf((m) => m.preferences.disliked_products ?? []),
    spice: first && isAdult(first) ? (first.spice_tolerance ?? 1) : 1,
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
    // 0 ₽ means «no limit», the same as an empty field (the summary shows both as «Без лимита»).
    budget: { ...base.budget, limit_kop: a.budget_rub === null || a.budget_rub === 0 ? null : Math.round(a.budget_rub * 100) },
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

export interface HouseholdPlan {
  update: { member: Member; patch: Partial<Member> }[];
  add: MemberDraft[];
  remove: Member[];
}

/**
 * What taking the questionnaire again does to an existing family.
 * - Adults and children are matched separately, in their order; the last extra ones are removed
 *   (the summary names them before anything is saved).
 * - Shared answers apply as changes: a shared ban removed in the questionnaire is removed from
 *   everyone, a new one is added to everyone, a member's own bans, diet types and tastes stay.
 * - Spice applies to adults, and only when it was changed; children keep theirs.
 * - The calorie goal applies to the first adult; «Просто вкусно» switches their target off.
 * A family without members simply gets the drafts of memberDrafts().
 */
export function planHousehold(a: Answers, initial: Answers, members: Member[], timezone: string): HouseholdPlan {
  if (members.length === 0) return { update: [], add: memberDrafts(a, timezone), remove: [] };
  const drafts = memberDrafts(a, timezone);
  const adultDrafts = drafts.slice(0, a.adults);
  const childDrafts = drafts.slice(a.adults);
  const adults = members.filter(isAdult);
  const kids = members.filter((m) => !isAdult(m));
  const plan: HouseholdPlan = { update: [], add: [], remove: [] };

  const sharedPatch = (m: Member): Partial<Member> => {
    const liked = applyDiff(m.preferences.liked_products ?? [], initial.liked_products, a.liked_products);
    const disliked = applyDiff(m.preferences.disliked_products ?? [], initial.disliked_products, a.disliked_products);
    // A product just marked «люблю» leaves the member's «не люблю», and the other way round.
    const newlyLiked = new Set(a.liked_products.filter((x) => !initial.liked_products.includes(x)));
    const newlyDisliked = new Set(a.disliked_products.filter((x) => !initial.disliked_products.includes(x)));
    return {
      diet_types: applyDiff(m.diet_types ?? [], initial.diet_types, a.diet_types),
      restrictions: {
        products: applyDiff(m.restrictions.products, initial.restrictions.products, a.restrictions.products),
        categories: applyDiff(m.restrictions.categories, initial.restrictions.categories, a.restrictions.categories),
        allergens: applyDiff(m.restrictions.allergens, initial.restrictions.allergens, a.restrictions.allergens),
      },
      preferences: {
        ...m.preferences,
        liked_products: liked.filter((x) => !newlyDisliked.has(x)),
        disliked_products: disliked.filter((x) => !newlyLiked.has(x)),
      },
    };
  };

  adults.forEach((m, i) => {
    if (i >= a.adults) {
      plan.remove.push(m);
      return;
    }
    const patch = sharedPatch(m);
    if (a.spice !== initial.spice) patch.spice_tolerance = a.spice;
    if (i === 0) {
      const draft = adultDrafts[0]!;
      if (a.goal !== 'simple') {
        Object.assign(patch, a.me, { goal: a.goal, portion_mode: draft.portion_mode, kcal_target: draft.kcal_target });
      } else if (m.portion_mode === 'target' || m.goal) {
        Object.assign(patch, { goal: null, portion_mode: 'simple', kcal_target: null });
      }
    }
    plan.update.push({ member: m, patch });
  });
  for (let i = adults.length; i < a.adults; i += 1) {
    plan.add.push({ ...adultDrafts[i]!, name: i === 0 ? 'Я' : `Взрослый ${i + 1}` });
  }

  kids.forEach((m, i) => {
    const child = a.children[i];
    if (!child) {
      plan.remove.push(m);
      return;
    }
    const patch = sharedPatch(m);
    if (child.age !== m.age) {
      patch.age = child.age;
      if (m.portion_mode === 'simple') patch.portion_factor = childPortion(child.age);
    }
    plan.update.push({ member: m, patch });
  });
  for (let i = kids.length; i < a.children.length; i += 1) {
    plan.add.push({ ...childDrafts[i]!, name: a.children.length === 1 ? 'Ребёнок' : `Ребёнок ${i + 1}` });
  }
  return plan;
}
