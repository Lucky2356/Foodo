import { productClosure, recipeNutrition, recipeSkillRank, selectMethod } from '../engine';
import type { Catalog, CookingMethod, Recipe, RecipeUnit } from '../engine';
import type { NutrientTable } from '../engine/nutrition';

export const SLOT_NAMES: Record<string, string> = { breakfast: 'Завтрак', lunch: 'Обед', snack: 'Перекус', dinner: 'Ужин' };
export const CATEGORY_NAMES: Record<string, string> = { breakfast: 'Завтраки', soup: 'Супы', main: 'Вторые блюда', salad: 'Салаты', snack: 'Перекусы', dessert: 'Десерты', baking: 'Выпечка', drink: 'Напитки' };
export const SKILL_NAMES: Record<number, string> = { 1: 'Просто', 2: 'Нужен опыт', 3: 'Сложно' };

export interface RecipeSummary {
  recipe: Recipe;
  perServing: NutrientTable;
  totalMin: number;
  activeMin: number;
  skillRank: number | null;
  allergens: string[];
  compositionKnown: boolean;
  equipment: string[];
}

const cache = new WeakMap<Catalog, Map<string, RecipeSummary>>();

export function summarize(catalog: Catalog, recipe: Recipe): RecipeSummary {
  let byCatalog = cache.get(catalog);
  if (!byCatalog) {
    byCatalog = new Map();
    cache.set(catalog, byCatalog);
  }
  const key = `${recipe.id}@${recipe.version}`;
  const hit = byCatalog.get(key);
  if (hit) return hit;
  const allergens = new Set<string>();
  let known = true;
  for (const ing of recipe.ingredients) {
    const c = productClosure(catalog, ing.product);
    c.allergens.forEach((a) => allergens.add(a));
    known = known && c.compositionKnown;
  }
  const first = recipe.methods[0] as CookingMethod;
  const summary: RecipeSummary = {
    recipe,
    perServing: recipeNutrition(catalog, recipe, 1).perServing,
    totalMin: Math.min(...recipe.methods.map((m) => m.total_min)),
    activeMin: first.active_min,
    skillRank: recipeSkillRank(catalog.reference, recipe),
    allergens: [...allergens].sort(),
    compositionKnown: known,
    equipment: first.equipment,
  };
  byCatalog.set(key, summary);
  return summary;
}

export function methodFor(recipe: Recipe, equipment: string[]): CookingMethod {
  return selectMethod(recipe, equipment) ?? (recipe.methods[0] as CookingMethod);
}

export function allergenName(catalog: Catalog, id: string): string {
  return catalog.reference.allergens.find((a) => a.id === id)?.name ?? id;
}

export function equipmentName(catalog: Catalog, id: string): string {
  return catalog.reference.equipment.find((e) => e.id === id)?.name ?? id;
}

export function categoryName(catalog: Catalog, id: string): string {
  return catalog.reference.categories.find((c) => c.id === id)?.name ?? id;
}

export function isRecipeUnit(unit: string): unit is RecipeUnit {
  return ['g', 'kg', 'ml', 'l', 'pcs', 'tbsp', 'tsp', 'pinch'].includes(unit);
}

/** Quick exclusion chips used in onboarding and filters (ids, never names). */
export const QUICK_EXCLUSIONS: { id: string; label: string; categories?: string[]; allergens?: string[] }[] = [
  { id: 'rice', label: 'Без риса', categories: ['rice'] },
  { id: 'pasta', label: 'Без макарон', categories: ['pasta'] },
  { id: 'meat', label: 'Без мяса', categories: ['meat'] },
  { id: 'fish', label: 'Без рыбы', categories: ['fish_seafood'], allergens: ['fish', 'crustaceans', 'molluscs'] },
  { id: 'milk', label: 'Без молочного', categories: ['dairy'], allergens: ['milk'] },
  { id: 'eggs', label: 'Без яиц', categories: ['eggs'], allergens: ['eggs'] },
  { id: 'gluten', label: 'Без глютена', allergens: ['gluten'] },
  { id: 'nuts', label: 'Без орехов', allergens: ['tree_nuts', 'peanuts'] },
  { id: 'mushrooms', label: 'Без грибов', categories: ['mushrooms'] },
  { id: 'legumes', label: 'Без бобовых', categories: ['legumes'] },
  { id: 'soy', label: 'Без сои', allergens: ['soy'] },
  { id: 'sesame', label: 'Без кунжута', allergens: ['sesame'] },
];

export function quickExclusionsActive(restrictions: { categories: string[]; allergens: string[] }): Set<string> {
  const on = new Set<string>();
  for (const q of QUICK_EXCLUSIONS) {
    const cats = q.categories ?? [];
    const alls = q.allergens ?? [];
    if (cats.every((c) => restrictions.categories.includes(c)) && alls.every((a) => restrictions.allergens.includes(a)) && cats.length + alls.length > 0) on.add(q.id);
  }
  return on;
}

export function toggleQuickExclusion<T extends { products: string[]; categories: string[]; allergens: string[] }>(r: T, id: string, on: boolean): T {
  const q = QUICK_EXCLUSIONS.find((x) => x.id === id);
  if (!q) return r;
  const cats = new Set(r.categories);
  const alls = new Set(r.allergens);
  for (const c of q.categories ?? []) {
    if (on) cats.add(c);
    else cats.delete(c);
  }
  for (const a of q.allergens ?? []) {
    if (on) alls.add(a);
    else alls.delete(a);
  }
  return { ...r, categories: [...cats], allergens: [...alls] };
}
