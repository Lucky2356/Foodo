import { compareStr } from './basics';
import type {
  Catalog,
  CookingMethod,
  Menu,
  NutrientTargetSet,
  Product,
  Recipe,
  Reference,
  SkillLevel,
} from './types';

export interface CatalogSources {
  products: { products: Product[] };
  recipes: { recipes: Recipe[] };
  reference: Reference;
  targets: { sets: NutrientTargetSet[] };
}

export function buildCatalog(src: CatalogSources): Catalog {
  const products: Record<string, Product> = {};
  for (const p of src.products.products) products[p.id] = p;
  const recipes: Record<string, Recipe> = {};
  for (const r of src.recipes.recipes) recipes[r.id] = r;
  const targetSets: Record<string, NutrientTargetSet> = {};
  for (const s of src.targets.sets) targetSets[s.id] = s;
  return { products, recipes, reference: src.reference, targetSets };
}

/** Sorted recipe ids — the canonical iteration order for every deterministic algorithm. */
export function recipeIds(catalog: Catalog): string[] {
  return Object.keys(catalog.recipes).sort(compareStr);
}

/** The category itself plus all of its ancestors. */
export function categoryLineage(reference: Reference, categoryId: string): string[] {
  const byId = new Map(reference.categories.map((c) => [c.id, c]));
  const result: string[] = [];
  let current: string | null = categoryId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = byId.get(current)?.parent ?? null;
  }
  return result;
}

export interface ProductClosure {
  productIds: Set<string>;
  categories: Set<string>;
  allergens: Set<string>;
  compositionKnown: boolean;
  missingProducts: string[];
}

/**
 * Expands a product with everything it contains (recursively). Restrictions are checked against the
 * closure, so a ban on eggs also excludes mayonnaise made with eggs.
 */
export function productClosure(catalog: Catalog, productId: string): ProductClosure {
  const closure: ProductClosure = {
    productIds: new Set(),
    categories: new Set(),
    allergens: new Set(),
    compositionKnown: true,
    missingProducts: [],
  };
  const stack = [productId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (closure.productIds.has(id)) continue;
    closure.productIds.add(id);
    const product = catalog.products[id];
    if (!product) {
      closure.compositionKnown = false;
      closure.missingProducts.push(id);
      continue;
    }
    if (!product.composition_known) closure.compositionKnown = false;
    for (const c of categoryLineage(catalog.reference, product.category)) closure.categories.add(c);
    for (const a of product.allergens) closure.allergens.add(a);
    for (const child of product.contains) stack.push(child);
  }
  return closure;
}

export function techniqueRank(reference: Reference, techniqueId: string): number | null {
  const t = reference.techniques.find((x) => x.id === techniqueId);
  return t ? t.rank : null;
}

/**
 * Required skill rank of a recipe: the highest rank among its techniques. Duration does not affect it.
 * Unknown techniques (or a recipe without technique data) make the rank unknown (null).
 */
export function recipeSkillRank(reference: Reference, recipe: Recipe): number | null {
  if (!recipe.techniques || recipe.techniques.length === 0) return null;
  let rank = 0;
  for (const t of recipe.techniques) {
    const r = techniqueRank(reference, t);
    if (r === null) return null;
    if (r > rank) rank = r;
  }
  return rank;
}

/** beginner: only rank 1; confident: rank ≤ 2; any: everything including unknown complexity. */
export function skillAllows(level: SkillLevel, rank: number | null): boolean {
  if (level === 'any') return true;
  if (rank === null) return false;
  if (level === 'beginner') return rank <= 1;
  return rank <= 2;
}

/** First cooking method whose required equipment is all available. Methods without equipment always fit. */
export function selectMethod(recipe: Recipe, equipment: string[]): CookingMethod | null {
  const available = new Set(equipment);
  for (const method of recipe.methods) {
    if (method.equipment.every((e) => available.has(e))) return method;
  }
  return null;
}

export function findMethod(recipe: Recipe, methodId: string): CookingMethod | null {
  return recipe.methods.find((m) => m.id === methodId) ?? null;
}

/** Catalog view backed by a menu's own snapshot so later recipe edits never change a saved menu. */
export function snapshotCatalog(menu: Menu, base: Catalog): Catalog {
  return {
    products: { ...base.products, ...menu.snapshot.products },
    recipes: { ...base.recipes, ...menu.snapshot.recipes },
    reference: base.reference,
    targetSets: base.targetSets,
  };
}

/** Copies a recipe and every product it references (including composition) into a snapshot. */
export function addToSnapshot(snapshot: Menu['snapshot'], catalog: Catalog, recipeId: string): void {
  const recipe = catalog.recipes[recipeId];
  if (!recipe) return;
  if (!snapshot.recipes[recipeId]) snapshot.recipes[recipeId] = recipe;
  for (const ing of recipe.ingredients) {
    for (const pid of productClosure(catalog, ing.product).productIds) {
      const product = catalog.products[pid];
      if (product && !snapshot.products[pid]) snapshot.products[pid] = product;
    }
  }
}
