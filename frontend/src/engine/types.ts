// Shared data contracts of the Foodo engine. Field names are snake_case because the same JSON
// documents are read by the Python engine (backend/engine) and stored by the Django API.

export const NUTRIENT_IDS = [
  'kcal',
  'protein',
  'fat',
  'carbs',
  'fiber',
  'vit_a',
  'vit_c',
  'vit_d',
  'vit_e',
  'vit_b6',
  'vit_b12',
  'folate',
] as const;
export type NutrientId = (typeof NUTRIENT_IDS)[number];

export const VITAMIN_IDS = ['vit_a', 'vit_c', 'vit_d', 'vit_e', 'vit_b6', 'vit_b12', 'folate'] as const;
export type VitaminId = (typeof VITAMIN_IDS)[number];

export type NutrientValues = Partial<Record<NutrientId, number | null>>;

export type BaseUnit = 'g' | 'ml' | 'pcs';
export type RecipeUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'tbsp' | 'tsp' | 'pinch';
export const RECIPE_UNITS: readonly RecipeUnit[] = ['g', 'kg', 'ml', 'l', 'pcs', 'tbsp', 'tsp', 'pinch'];

export interface PackageSize {
  size: number;
  unit: BaseUnit | 'kg' | 'l';
}

export interface Product {
  id: string;
  name: string;
  category: string;
  department: string;
  state: 'raw' | 'dry' | 'cooked' | 'processed';
  base_unit: BaseUnit;
  edible_fraction: number;
  piece_g?: number | null;
  density_g_ml?: number | null;
  spoon_g?: Partial<Record<'tbsp' | 'tsp' | 'pinch', number>> | null;
  package?: PackageSize | null;
  allergens: string[];
  contains: string[];
  composition_known: boolean;
  purchasable?: boolean;
  source: string;
  nutrients: NutrientValues;
}

export interface Ingredient {
  product: string;
  qty: number;
  unit: RecipeUnit;
  note?: string | null;
}

export interface CookingMethod {
  id: string;
  name: string;
  equipment: string[];
  active_min: number;
  total_min: number;
  steps: string[];
}

export interface Recipe {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  meal_types: string[];
  servings: number;
  yield_g: number | null;
  ingredients: Ingredient[];
  methods: CookingMethod[];
  techniques: string[] | null;
  diet_tags: string[];
  container_ok: boolean;
  tip?: string | null;
  storage?: { fridge_days?: number | null; freezer_ok?: boolean | null; source?: string } | null;
  image?: { url: string; source: string; license: string } | null;
  source: string;
  visibility?: 'public' | 'private';
  owner?: string | null;
}

export interface CategoryRef {
  id: string;
  name: string;
  parent: string | null;
}

export interface TechniqueRef {
  id: string;
  name: string;
  rank: number;
}

export interface MealSlotRef {
  id: string;
  name: string;
  energy_share: number;
}

export interface NutrientRef {
  id: NutrientId;
  name: string;
  unit: string;
  form: string;
  form_name?: string;
  kind: 'energy' | 'macro' | 'fiber' | 'vitamin' | 'mineral';
}

export interface Reference {
  sources: { id: string; name: string; verified: boolean; date: string; basis: string; note?: string }[];
  nutrients: NutrientRef[];
  allergens: { id: string; name: string }[];
  categories: CategoryRef[];
  departments: string[];
  equipment: { id: string; name: string }[];
  skill_levels: { id: SkillLevel; rank: number; name: string }[];
  techniques: TechniqueRef[];
  diet_modes: { id: DietMode; name: string }[];
  diet_tags: { id: string; name: string }[];
  diet_rules: { version: string; balanced: Record<string, number>; regular: Record<string, number> };
  meal_slots: MealSlotRef[];
  recipe_categories: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}

export interface NutrientTarget {
  nutrient: VitaminId;
  value: number;
  form: string;
  sex?: 'male' | 'female';
  min_age?: number;
  max_age?: number;
  note?: string;
}

export interface NutrientTargetSet {
  id: string;
  name: string;
  status: 'verified' | 'unverified' | 'demo' | 'manual';
  demo: boolean;
  version: string;
  source: string;
  source_note?: string;
  min_age: number | null;
  targets: NutrientTarget[];
}

export interface Catalog {
  products: Record<string, Product>;
  recipes: Record<string, Recipe>;
  reference: Reference;
  targetSets: Record<string, NutrientTargetSet>;
}

export type SkillLevel = 'beginner' | 'confident' | 'any';
export type DietMode = 'regular' | 'balanced';
export type RepeatMode = 'unique' | 'allow' | 'batch';

export interface Restrictions {
  products: string[];
  categories: string[];
  allergens: string[];
}

export interface Preferences {
  liked_recipes: string[];
  disliked_products: string[];
}

export interface Member {
  id: string;
  name: string;
  age: number | null;
  sex: 'male' | 'female' | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity: 'low' | 'light' | 'moderate' | 'high' | 'very_high' | null;
  goal: 'maintain' | 'lose' | 'gain' | null;
  portion_mode: 'simple' | 'target';
  portion_factor: number;
  kcal_target: number | null;
  macro_targets?: { protein?: number | null; fat?: number | null; carbs?: number | null } | null;
  restrictions: Restrictions;
  preferences: Preferences;
  vitamin_targets_manual?: NutrientTarget[] | null;
  water_goal_ml?: number | null;
  timezone?: string | null;
}

export interface RepeatSettings {
  mode: RepeatMode;
  max_uses: number;
  min_gap_days: number;
  cook_days: number[];
  batch_days: number;
  batch_slots: string[];
}

export interface PlanSettings {
  skill: SkillLevel;
  diet_mode: DietMode;
  equipment: string[];
  max_total_min: number | null;
  repeat: RepeatSettings;
  container_days: number[];
  vitamins: { enabled: boolean; target_set: string | null; demo: boolean };
  budget: { limit_kop: number | null; currency: string };
  tolerances: { energy_pct: number; macro_pct: number };
  portion_min: number;
  portion_max: number;
}

/**
 * Where a price comes from. `manual` and `receipt` are the user's own prices; `community` is the
 * median of prices shared by Foodo users for a chain in a city; `scraped` was collected from a
 * chain's public website; `rosstat` is an official regional average (not a store price) and is
 * therefore treated as an estimate.
 */
export type PriceKind = 'manual' | 'receipt' | 'community' | 'scraped' | 'rosstat';

export interface PriceEntry {
  product_id: string;
  price_kop: number;
  package_size: number;
  package_unit: BaseUnit | 'kg' | 'l';
  currency: string;
  date: string;
  source: string;
  kind?: PriceKind;
  /** Sold by weight/volume: checkout cost follows the exact quantity, no package rounding. */
  loose?: boolean;
  available?: boolean | null;
}

export const ESTIMATED_PRICE_KINDS: readonly PriceKind[] = ['rosstat'];

export interface PriceProfile {
  store_id: string;
  city_id?: string | null;
  region: string | null;
  entries: PriceEntry[];
}

export interface PantryItem {
  id: string;
  product_id: string;
  qty: number;
  unit: BaseUnit;
  location: string | null;
  expires: string | null;
}

export interface PinnedItem {
  date: string;
  slot: string;
  recipe_id: string;
  method_id: string;
  portions: Record<string, number>;
}

export interface PlanRequest {
  start_date: string;
  days: number;
  seed: number;
  slots: string[];
  members: Member[];
  slot_members?: Record<string, string[]> | null;
  settings: PlanSettings;
  pins?: PinnedItem[];
  pantry?: PantryItem[];
  prices?: PriceProfile | null;
}

export interface MenuBatch {
  id: string;
  recipe_id: string;
  recipe_version: number;
  method_id: string;
  cook_date: string;
  slot: string;
  portions: number;
}

export interface MenuItem {
  id: string;
  batch_id: string;
  portions: Record<string, number>;
  pinned: boolean;
  alternative_for: string | null;
}

export interface MenuMeal {
  date: string;
  slot: string;
  items: MenuItem[];
}

export interface Unfilled {
  date: string;
  slot: string;
  member_ids: string[];
  code: string;
  message: string;
}

export interface Conflict {
  code: string;
  message: string;
  suggestion: string;
}

export interface Menu {
  format: 'foodo-menu';
  format_version: 1;
  start_date: string;
  days: number;
  seed: number;
  revision: number;
  slots: string[];
  member_ids: string[];
  settings: PlanSettings;
  batches: MenuBatch[];
  meals: MenuMeal[];
  unfilled: Unfilled[];
  conflicts: Conflict[];
  warnings: string[];
  snapshot: { recipes: Record<string, Recipe>; products: Record<string, Product> };
  stats: { attempts: number; evaluated: number; score: number; budget_status: BudgetStatus };
}

export type BudgetStatus = 'none' | 'ok' | 'exceeded' | 'unconfirmed';

export class EngineError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
