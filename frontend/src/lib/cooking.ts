// «Готовка»: the cooking plan of a menu — which batch to cook on which day, for how many portions,
// which meals it feeds and what goes to the fridge. Kept free of React so it can be tested.

import type { Menu, Recipe } from '../engine';

export interface CookTask {
  batchId: string;
  recipeId: string;
  recipe: Recipe | null;
  methodName: string | null;
  totalMin: number | null;
  activeMin: number | null;
  cookDate: string;
  /** Portions of the whole batch (the recipe is scaled to them). */
  portions: number;
  /** Meals the batch feeds, in date order. */
  meals: { date: string; slot: string; portions: number }[];
  /** Portions eaten on later days: they are kept in the fridge. */
  leftoverPortions: number;
  /** The last day the menu plans to eat this batch — a plan, not a food-safety limit. */
  lastMealDate: string;
  cooked: boolean;
}

export interface CookDay {
  date: string;
  tasks: CookTask[];
  /** Hands-on time of the day's dishes, when every dish has it. */
  activeMin: number | null;
}

const SLOT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };

export function cookingPlan(menu: Menu, cooked: string[]): CookDay[] {
  const byBatch = new Map<string, CookTask['meals']>();
  for (const meal of menu.meals) {
    for (const item of meal.items) {
      const eaten = Object.values(item.portions).reduce((s, p) => s + p, 0);
      const list = byBatch.get(item.batch_id) ?? [];
      list.push({ date: meal.date, slot: meal.slot, portions: eaten });
      byBatch.set(item.batch_id, list);
    }
  }
  const tasks: CookTask[] = [];
  for (const b of menu.batches) {
    const meals = (byBatch.get(b.id) ?? []).sort((x, y) => x.date.localeCompare(y.date) || (SLOT_ORDER[x.slot] ?? 9) - (SLOT_ORDER[y.slot] ?? 9));
    // A batch no meal uses any more (the dish was replaced) is not cooked at all.
    if (meals.length === 0) continue;
    const recipe = menu.snapshot.recipes[b.recipe_id] ?? null;
    const method = recipe?.methods.find((m) => m.id === b.method_id) ?? null;
    const later = meals.filter((m) => m.date > b.cook_date).reduce((s, m) => s + m.portions, 0);
    tasks.push({
      batchId: b.id,
      recipeId: b.recipe_id,
      recipe,
      methodName: method?.name ?? null,
      totalMin: method?.total_min ?? null,
      activeMin: method?.active_min ?? null,
      cookDate: b.cook_date,
      portions: b.portions,
      meals,
      leftoverPortions: Math.round(later * 100) / 100,
      lastMealDate: meals[meals.length - 1]!.date,
      cooked: cooked.includes(b.id),
    });
  }
  const days = new Map<string, CookTask[]>();
  for (const t of tasks) days.set(t.cookDate, [...(days.get(t.cookDate) ?? []), t]);
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const sorted = list.sort((x, y) => (SLOT_ORDER[x.meals[0]!.slot] ?? 9) - (SLOT_ORDER[y.meals[0]!.slot] ?? 9));
      const known = sorted.every((t) => t.activeMin !== null);
      return { date, tasks: sorted, activeMin: known ? sorted.reduce((s, t) => s + (t.activeMin ?? 0), 0) : null };
    });
}
