import { productClosure, recipeSkillRank, selectMethod, skillAllows } from './catalog';
import type { Catalog, CookingMethod, Member, Recipe, Restrictions, SkillLevel } from './types';

// Hard restrictions are evaluated on product ids, categories (with ancestors) and allergens of the
// whole composition closure — never on recipe names. A recipe that contains a product with unknown
// composition cannot be confirmed safe for any active restriction.

export interface RestrictionViolation {
  code: 'product' | 'category' | 'allergen' | 'composition_unknown';
  target: string;
  via: string;
}

export function hasRestrictions(r: Restrictions): boolean {
  return r.products.length + r.categories.length + r.allergens.length > 0;
}

export function mergeRestrictions(list: Restrictions[]): Restrictions {
  const products = new Set<string>();
  const categories = new Set<string>();
  const allergens = new Set<string>();
  for (const r of list) {
    r.products.forEach((x) => products.add(x));
    r.categories.forEach((x) => categories.add(x));
    r.allergens.forEach((x) => allergens.add(x));
  }
  return {
    products: [...products].sort(),
    categories: [...categories].sort(),
    allergens: [...allergens].sort(),
  };
}

export function recipeViolations(catalog: Catalog, recipe: Recipe, restrictions: Restrictions): RestrictionViolation[] {
  const violations: RestrictionViolation[] = [];
  if (!hasRestrictions(restrictions)) return violations;
  for (const ing of recipe.ingredients) {
    const closure = productClosure(catalog, ing.product);
    for (const p of restrictions.products) {
      if (closure.productIds.has(p)) violations.push({ code: 'product', target: p, via: ing.product });
    }
    for (const c of restrictions.categories) {
      if (closure.categories.has(c)) violations.push({ code: 'category', target: c, via: ing.product });
    }
    for (const a of restrictions.allergens) {
      if (closure.allergens.has(a)) violations.push({ code: 'allergen', target: a, via: ing.product });
    }
    if (!closure.compositionKnown) {
      violations.push({ code: 'composition_unknown', target: '*', via: ing.product });
    }
  }
  return violations;
}

export function isRecipeSafeFor(catalog: Catalog, recipe: Recipe, member: Member): boolean {
  return recipeViolations(catalog, recipe, member.restrictions).length === 0;
}

export function recipeHasDislikedProduct(catalog: Catalog, recipe: Recipe, member: Member): boolean {
  if (member.preferences.disliked_products.length === 0) return false;
  for (const ing of recipe.ingredients) {
    const closure = productClosure(catalog, ing.product);
    for (const p of member.preferences.disliked_products) if (closure.productIds.has(p)) return true;
  }
  return false;
}

export type KitchenReason = 'meal_type' | 'equipment' | 'skill' | 'skill_unknown' | 'time' | 'container';

export interface KitchenCheck {
  method: CookingMethod | null;
  reasons: KitchenReason[];
}

export interface KitchenContext {
  slot: string;
  equipment: string[];
  skill: SkillLevel;
  maxTotalMin: number | null;
  container: boolean;
}

/** Household-level checks: meal type, equipment, required skill, time limit and container lunches. */
export function kitchenCheck(catalog: Catalog, recipe: Recipe, ctx: KitchenContext): KitchenCheck {
  const reasons: KitchenReason[] = [];
  if (!recipe.meal_types.includes(ctx.slot)) reasons.push('meal_type');
  const method = selectMethod(recipe, ctx.equipment);
  if (!method) reasons.push('equipment');
  const rank = recipeSkillRank(catalog.reference, recipe);
  if (!skillAllows(ctx.skill, rank)) reasons.push(rank === null ? 'skill_unknown' : 'skill');
  if (method && ctx.maxTotalMin !== null && method.total_min > ctx.maxTotalMin) reasons.push('time');
  if (ctx.container && !recipe.container_ok) reasons.push('container');
  return { method: reasons.length === 0 ? method : null, reasons };
}

export const REASON_MESSAGES: Record<string, string> = {
  meal_type: 'не подходит для этого приёма пищи',
  equipment: 'нужна техника, которой нет',
  skill: 'нужен более высокий уровень готовки',
  skill_unknown: 'сложность рецепта не проверена',
  time: 'готовится дольше заданного лимита',
  container: 'не подходит для обеда в контейнере',
  restriction: 'содержит запрещённый продукт, категорию или аллерген',
  composition_unknown: 'состав ингредиента неизвестен, безопасность не подтверждена',
  repeat: 'уже использован (режим повторов)',
};
