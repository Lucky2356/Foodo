import { describe, expect, it } from 'vitest';
import { generateMenu } from '../../engine';
import { catalog, request, settings } from '../../engine/__tests__/helpers';
import { cookingPlan } from '../cooking';

describe('cooking plan', () => {
  const cat = catalog();

  it('lists every batch once, on its cook day, with the meals it feeds', () => {
    const { menu } = generateMenu(request({ days: 3 }), cat);
    const plan = cookingPlan(menu, []);
    const tasks = plan.flatMap((d) => d.tasks);
    expect(new Set(tasks.map((t) => t.batchId)).size).toBe(tasks.length);
    expect(tasks.length).toBe(menu.batches.filter((b) => menu.meals.some((m) => m.items.some((i) => i.batch_id === b.id))).length);
    for (const day of plan) {
      expect(day.tasks.every((t) => t.cookDate === day.date)).toBe(true);
      expect(day.activeMin).toBe(day.tasks.reduce((s, t) => s + (t.activeMin ?? 0), 0));
    }
    expect(plan.map((d) => d.date)).toEqual([...plan.map((d) => d.date)].sort());
    // Without batch cooking each dish is eaten the day it is cooked: nothing goes to the fridge.
    expect(tasks.every((t) => t.leftoverPortions === 0 && t.lastMealDate === t.cookDate)).toBe(true);
  });

  it('a batch for two days: portions for later days go to the fridge until the last planned meal', () => {
    const { menu } = generateMenu(
      request({ days: 3, slots: ['lunch'], settings: settings({ repeat: { mode: 'batch', max_uses: 2, min_gap_days: 0, cook_days: [1], batch_days: 2, batch_slots: ['lunch'] } }) }),
      cat,
    );
    const tasks = cookingPlan(menu, []).flatMap((d) => d.tasks);
    const shared = tasks.find((t) => t.meals.length > 1);
    expect(shared).toBeDefined();
    const later = shared!.meals.filter((m) => m.date > shared!.cookDate).reduce((s, m) => s + m.portions, 0);
    expect(shared!.leftoverPortions).toBeCloseTo(later, 2);
    expect(shared!.leftoverPortions).toBeGreaterThan(0);
    expect(shared!.lastMealDate > shared!.cookDate).toBe(true);
  });

  it('marks cooked batches and skips batches no meal uses any more', () => {
    const { menu } = generateMenu(request({ days: 2 }), cat);
    const first = menu.batches[0]!;
    expect(cookingPlan(menu, [first.id]).flatMap((d) => d.tasks).find((t) => t.batchId === first.id)?.cooked).toBe(true);
    const orphan = { ...menu, meals: menu.meals.map((m) => ({ ...m, items: m.items.filter((i) => i.batch_id !== first.id) })) };
    expect(cookingPlan(orphan, []).flatMap((d) => d.tasks).some((t) => t.batchId === first.id)).toBe(false);
  });
});
