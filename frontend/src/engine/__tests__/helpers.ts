import { seedCatalog } from '../../data/seed';
import { DEFAULT_SETTINGS } from '../generator';
import type { Catalog, Member, PlanRequest, PlanSettings, Product, Recipe } from '../types';

export function catalog(): Catalog {
  return seedCatalog();
}

export function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    name: 'Аня',
    age: 34,
    sex: 'female',
    height_cm: 168,
    weight_kg: 62,
    activity: 'moderate',
    goal: 'maintain',
    portion_mode: 'simple',
    portion_factor: 1,
    kcal_target: null,
    restrictions: { products: [], categories: [], allergens: [] },
    preferences: { liked_recipes: [], disliked_products: [] },
    vitamin_targets_manual: null,
    ...overrides,
  };
}

export function settings(overrides: Partial<PlanSettings> = {}): PlanSettings {
  return structuredClone({ ...DEFAULT_SETTINGS, ...overrides });
}

export function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    start_date: '2026-10-19',
    days: 7,
    seed: 42,
    slots: ['breakfast', 'lunch', 'snack', 'dinner'],
    members: [member(), member({ id: 'm2', name: 'Борис', sex: 'male', age: 36, weight_kg: 80, height_cm: 182 })],
    settings: settings(),
    pins: [],
    pantry: [],
    prices: null,
    ...overrides,
  };
}

export function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    name: overrides.id,
    category: 'vegetables',
    department: 'Овощи и фрукты',
    state: 'raw',
    base_unit: 'g',
    edible_fraction: 1,
    allergens: [],
    contains: [],
    composition_known: true,
    source: 'test',
    nutrients: { kcal: 100, protein: 1, fat: 1, carbs: 20, fiber: 1, vit_a: 0, vit_c: 0, vit_d: 0, vit_e: 0, vit_b6: 0, vit_b12: 0, folate: 0 },
    ...overrides,
  };
}

export function recipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  return {
    version: 1,
    name: overrides.id,
    description: '',
    category: 'main',
    meal_types: ['lunch', 'dinner'],
    servings: 2,
    yield_g: 600,
    ingredients: [],
    methods: [{ id: 'stove', name: 'На плите', equipment: ['stove'], active_min: 10, total_min: 20, steps: ['Шаг'] }],
    techniques: ['boil'],
    diet_tags: [],
    container_ok: true,
    source: 'test',
    ...overrides,
  };
}

/** Catalog that contains only the given recipes/products plus the seed reference data. */
export function miniCatalog(recipes: Recipe[], products: Product[]): Catalog {
  const base = seedCatalog();
  return {
    reference: base.reference,
    targetSets: base.targetSets,
    products: Object.fromEntries(products.map((p) => [p.id, p])),
    recipes: Object.fromEntries(recipes.map((r) => [r.id, r])),
  };
}

export function recipesOf(menuBatches: { recipe_id: string }[]): string[] {
  return menuBatches.map((b) => b.recipe_id);
}
