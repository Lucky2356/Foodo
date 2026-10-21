import { describe, expect, it } from 'vitest';
import type { Member } from '../../engine';
import { defaultAnswers, planHousehold } from '../questionnaire';
import type { HouseholdView } from '../../data/types';

function member(id: string, name: string, extra: Partial<Member> = {}): Member {
  return {
    id,
    name,
    age: null,
    sex: null,
    height_cm: null,
    weight_kg: null,
    activity: null,
    goal: null,
    portion_mode: 'simple',
    portion_factor: 1,
    kcal_target: null,
    restrictions: { products: [], categories: [], allergens: [] },
    preferences: { liked_recipes: [], disliked_products: [], liked_products: [] },
    diet_types: [],
    spice_tolerance: 1,
    vitamin_targets_manual: null,
    timezone: 'Europe/Moscow',
    ...extra,
  } as Member;
}

function household(members: Member[]): HouseholdView {
  return { id: 'h', name: 'Семья', role: 'owner', settings: undefined as never, city: null, store_chain_id: null, share_prices: false, members };
}

describe('taking the questionnaire again', () => {
  const me = member('a', 'Я', { restrictions: { products: [], categories: ['meat'], allergens: [] } });
  const mom = member('b', 'Мама', { restrictions: { products: [], categories: ['meat'], allergens: ['milk'] } });
  const kid = member('c', 'Ребёнок', { age: 8, portion_factor: 0.7, spice_tolerance: 0, restrictions: { products: [], categories: ['meat'], allergens: ['tree_nuts'] } });
  const family = [me, mom, kid];

  it('keeps each member’s own bans when nothing is changed', () => {
    const initial = defaultAnswers(household(family));
    expect(initial.restrictions.categories).toEqual(['meat']);
    expect(initial.restrictions.allergens).toEqual([]);
    const plan = planHousehold(initial, initial, family, 'Europe/Moscow');
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([]);
    const byId = new Map(plan.update.map((u) => [u.member.id, u.patch]));
    expect(byId.get('b')!.restrictions!.allergens).toEqual(['milk']);
    expect(byId.get('c')!.restrictions!.allergens).toEqual(['tree_nuts']);
    expect(byId.get('c')!.spice_tolerance).toBeUndefined();
  });

  it('removes a shared ban from everyone and adds a new one to everyone', () => {
    const initial = defaultAnswers(household(family));
    const next = { ...initial, restrictions: { products: [], categories: [], allergens: ['soy'] } };
    const plan = planHousehold(next, initial, family, 'Europe/Moscow');
    for (const u of plan.update) {
      expect(u.patch.restrictions!.categories).not.toContain('meat');
      expect(u.patch.restrictions!.allergens).toContain('soy');
    }
    expect(plan.update.find((u) => u.member.id === 'c')!.patch.restrictions!.allergens).toContain('tree_nuts');
  });

  it('removes the extra adult, not the child, and updates a child’s age and portion', () => {
    const initial = defaultAnswers(household(family));
    const next = { ...initial, adults: 1, children: [{ age: 5 }] };
    const plan = planHousehold(next, initial, family, 'Europe/Moscow');
    expect(plan.remove.map((m) => m.name)).toEqual(['Мама']);
    const child = plan.update.find((u) => u.member.id === 'c')!.patch;
    expect(child.age).toBe(5);
    expect(child.portion_factor).toBe(0.5);
  });

  it('«Просто вкусно» switches off a calorie target set earlier', () => {
    const dieting = member('a', 'Я', { goal: 'lose', portion_mode: 'target', kcal_target: 1838, age: 35 });
    const initial = { ...defaultAnswers(household([dieting])), goal: 'lose' as const };
    const plan = planHousehold({ ...initial, goal: 'simple' }, initial, [dieting], 'Europe/Moscow');
    expect(plan.update[0]!.patch).toMatchObject({ goal: null, portion_mode: 'simple', kcal_target: null });
  });
});
