import { NUTRIENT_IDS } from './types';
import type { Catalog, NutrientId, Recipe } from './types';
import { edibleGrams } from './units';

// Nutrition rules (docs/NUTRITION_RULES.md):
// contribution = edible mass, g × value per 100 g / 100; recipe = Σ contributions;
// per 100 g of the cooked dish = recipe total / yield × 100 (only when the yield is known);
// one serving = recipe total / base servings. Unknown values stay unknown: a total built from a
// partial set of ingredients is returned with complete = false and the missing products listed.

export interface NutrientAmount {
  value: number;
  complete: boolean;
  missing: string[];
}

export type NutrientTable = Record<NutrientId, NutrientAmount>;

export interface RecipeNutrition {
  scale: number;
  total: NutrientTable;
  perServing: NutrientTable;
  per100g: NutrientTable | null;
  yieldG: number | null;
  edibleMassG: number;
  unconvertible: string[];
}

function emptyTable(): NutrientTable {
  const table = {} as NutrientTable;
  for (const id of NUTRIENT_IDS) table[id] = { value: 0, complete: true, missing: [] };
  return table;
}

function scaleTable(table: NutrientTable, factor: number): NutrientTable {
  const out = {} as NutrientTable;
  for (const id of NUTRIENT_IDS) {
    const src = table[id];
    out[id] = { value: src.value * factor, complete: src.complete, missing: [...src.missing] };
  }
  return out;
}

/** Nutrition of a recipe cooked at `scale` × its base amount. */
export function recipeNutrition(catalog: Catalog, recipe: Recipe, scale = 1): RecipeNutrition {
  const total = emptyTable();
  const unconvertible: string[] = [];
  let edibleMassG = 0;
  for (const ing of recipe.ingredients) {
    const product = catalog.products[ing.product];
    const grams = product ? edibleGrams(product, ing.qty * scale, ing.unit) : null;
    if (grams === null) {
      unconvertible.push(ing.product);
      for (const id of NUTRIENT_IDS) {
        total[id].complete = false;
        if (!total[id].missing.includes(ing.product)) total[id].missing.push(ing.product);
      }
      continue;
    }
    edibleMassG += grams;
    for (const id of NUTRIENT_IDS) {
      const per100 = product?.nutrients[id];
      if (per100 === null || per100 === undefined) {
        total[id].complete = false;
        if (!total[id].missing.includes(ing.product)) total[id].missing.push(ing.product);
      } else {
        total[id].value += (grams * per100) / 100;
      }
    }
  }
  const yieldG = recipe.yield_g === null ? null : recipe.yield_g * scale;
  return {
    scale,
    total,
    perServing: scaleTable(total, 1 / (recipe.servings * scale)),
    per100g: yieldG ? scaleTable(total, 100 / yieldG) : null,
    yieldG,
    edibleMassG,
    unconvertible,
  };
}

/** Nutrition per standard serving, memoised per recipe id+version for the generator's hot loop. */
export class NutritionCache {
  private cache = new Map<string, NutrientTable>();
  constructor(private readonly catalog: Catalog) {}

  perServing(recipeId: string): NutrientTable {
    const recipe = this.catalog.recipes[recipeId];
    if (!recipe) throw new Error(`Неизвестный рецепт ${recipeId}`);
    const key = `${recipe.id}@${recipe.version}`;
    let table = this.cache.get(key);
    if (!table) {
      table = recipeNutrition(this.catalog, recipe, 1).perServing;
      this.cache.set(key, table);
    }
    return table;
  }
}

/** Standard serving mass in grams (yield / servings) or null if the yield is unknown. */
export function servingMassG(recipe: Recipe): number | null {
  return recipe.yield_g === null ? null : recipe.yield_g / recipe.servings;
}

export function addInto(target: NutrientTable, add: NutrientTable, factor: number): void {
  for (const id of NUTRIENT_IDS) {
    const t = target[id];
    const a = add[id];
    t.value += a.value * factor;
    if (!a.complete) {
      t.complete = false;
      for (const m of a.missing) if (!t.missing.includes(m)) t.missing.push(m);
    }
  }
}

export function newNutrientTable(): NutrientTable {
  return emptyTable();
}
