import { addDays, clamp, compareStr, isIsoDate, isoWeekday, Rng } from './basics';
import { addToSnapshot, findMethod, recipeIds } from './catalog';
import { NutritionCache } from './nutrition';
import type { NutrientTable } from './nutrition';
import {
  effectiveRestrictions,
  isRecipeSafeFor,
  kitchenCheck,
  REASON_MESSAGES,
  recipeHasDislikedProduct,
  recipeHasLikedProduct,
  recipeSpice,
  recipeViolations,
  spiceTolerance,
} from './restrictions';
import type { KitchenCheck } from './restrictions';
import { computeShopping, emptyShoppingState, unitPriceKop } from './shopping';
import { resolveVitaminTargets } from './targets';
import { EngineError, VITAMIN_IDS } from './types';
import type {
  BudgetStatus,
  Catalog,
  Conflict,
  Member,
  Menu,
  MenuBatch,
  MenuItem,
  MenuMeal,
  PlanRequest,
  Recipe,
  Unfilled,
  VitaminId,
} from './types';
import { toBase } from './units';

// Menu generator. The algorithm is deliberately simple and fully deterministic for a given seed so the
// browser (guest) and the server (account) produce identical menus — see docs/ARCHITECTURE.md.
//
// 1. Filter: hard restrictions of every participant (composition closure), meal type, equipment,
//    skill, time, container lunches and the repeat mode.
// 2. Score the remaining candidates: diet mode rules, likes/dislikes (recipes and products),
//    preferred cuisines, child-friendly dishes when children eat, variety, shared ingredients,
//    cooking time, estimated cost (when a budget is set) and vitamin coverage gain (when enabled),
//    plus a small seeded jitter.
// 3. Portions: simple factor, or the member's energy target split across meal slots, clamped to the
//    configured realistic range.
// 4. Several seeded attempts; the best objective wins. A known budget overrun or an unfilled slot
//    is penalised but never hidden.
// 5. The final menu is re-validated against hard restrictions before it is returned.

export const SCORE = {
  liked: 1.5,
  disliked: -2,
  likedProduct: 0.6,
  cuisine: 0.8,
  kidFriendly: 0.6,
  sameCategorySameDay: -0.5,
  repeatUse: -1,
  sharedIngredient: 0.15,
  sharedIngredientCap: 1,
  timePer120Min: 1,
  vitamins: 1,
  jitter: 0.35,
  unfilledPenalty: 100,
  budgetExceededPenalty: 1000,
  maxEvaluations: 250000,
} as const;

export const DEFAULT_SETTINGS: PlanRequest['settings'] = {
  skill: 'any',
  diet_mode: 'regular',
  equipment: ['stove', 'oven', 'microwave'],
  max_total_min: null,
  max_total_min_weekend: null,
  cuisines: [],
  repeat: { mode: 'unique', max_uses: 2, min_gap_days: 2, cook_days: [], batch_days: 2, batch_slots: ['lunch', 'dinner'] },
  container_days: [],
  vitamins: { enabled: false, target_set: null, demo: false },
  budget: { limit_kop: null, currency: 'RUB' },
  tolerances: { energy_pct: 10, macro_pct: 20 },
  portion_min: 0.5,
  portion_max: 2,
};

export interface SlotDiagnostics {
  total: number;
  kitchen_ok: number;
  excluded: Record<string, number>;
}

export interface PlanResult {
  menu: Menu;
  diagnostics: Record<string, SlotDiagnostics>;
}

export function validatePlanRequest(req: PlanRequest, catalog: Catalog): void {
  if (!isIsoDate(req.start_date)) throw new EngineError('invalid_date', 'Некорректная дата начала меню.');
  if (!Number.isInteger(req.days) || req.days < 1 || req.days > 35) {
    throw new EngineError('invalid_days', 'Период меню должен быть от 1 до 35 дней.');
  }
  if (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 4294967295) {
    throw new EngineError('invalid_seed', 'Seed должен быть целым числом от 0 до 4294967295.');
  }
  if (req.slots.length === 0) throw new EngineError('no_slots', 'Выберите хотя бы один приём пищи.');
  const known = new Set(catalog.reference.meal_slots.map((s) => s.id));
  for (const s of req.slots) {
    if (!known.has(s)) throw new EngineError('unknown_slot', `Неизвестный приём пищи: ${s}.`);
  }
  if (new Set(req.slots).size !== req.slots.length) throw new EngineError('duplicate_slot', 'Приёмы пищи повторяются.');
  if (req.members.length === 0) throw new EngineError('no_members', 'Добавьте хотя бы одного участника.');
  if (req.members.length > 20) throw new EngineError('too_many_members', 'В одной семье может быть не больше 20 участников.');
  const s = req.settings;
  if (!(s.portion_min > 0 && s.portion_max >= s.portion_min && s.portion_max <= 5)) {
    throw new EngineError('invalid_portion_range', 'Некорректный диапазон порций.');
  }
  if (s.repeat.mode !== 'unique' && (s.repeat.max_uses < 1 || s.repeat.min_gap_days < 0)) {
    throw new EngineError('invalid_repeat', 'Некорректные параметры повторов.');
  }
  if (s.repeat.mode === 'batch' && (s.repeat.batch_days < 1 || s.repeat.batch_days > 7)) {
    throw new EngineError('invalid_batch_days', 'Партия может использоваться от 1 до 7 дней.');
  }
  if (s.budget.limit_kop !== null && (!Number.isInteger(s.budget.limit_kop) || s.budget.limit_kop < 0)) {
    throw new EngineError('invalid_budget', 'Бюджет должен быть неотрицательной суммой.');
  }
  if (!catalog.reference.diet_modes.some((m) => m.id === s.diet_mode)) {
    throw new EngineError('unknown_diet_mode', 'Неизвестный режим питания.');
  }
  for (const limit of [s.max_total_min, s.max_total_min_weekend ?? null]) {
    if (limit !== null && (!Number.isInteger(limit) || limit < 5 || limit > 1440)) {
      throw new EngineError('invalid_time_limit', 'Лимит времени готовки должен быть от 5 до 1440 минут.');
    }
  }
  const cuisines = new Set((catalog.reference.cuisines ?? []).map((c) => c.id));
  for (const c of s.cuisines ?? []) {
    if (!cuisines.has(c)) throw new EngineError('unknown_cuisine', `Неизвестная кухня: ${c}.`);
  }
  const dietTypes = new Set((catalog.reference.diet_types ?? []).map((t) => t.id));
  for (const m of req.members) {
    for (const t of m.diet_types ?? []) {
      if (!dietTypes.has(t)) throw new EngineError('unknown_diet_type', `Неизвестный тип питания у участника «${m.name}»: ${t}.`);
    }
    const tol = m.spice_tolerance;
    if (tol !== undefined && tol !== null && (!Number.isInteger(tol) || tol < 0 || tol > 2)) {
      throw new EngineError('invalid_spice_tolerance', `Допустимая острота у участника «${m.name}» должна быть 0, 1 или 2.`);
    }
  }
  if (s.vitamins.enabled && s.vitamins.target_set) {
    const set = catalog.targetSets[s.vitamins.target_set];
    if (!set) throw new EngineError('unknown_target_set', 'Выбранный набор целевых значений не найден.');
    if (set.demo && !s.vitamins.demo) {
      throw new EngineError('demo_targets_not_allowed', 'Демонстрационные нормы можно использовать только в демонстрационном сценарии.');
    }
  }
}

interface Participant {
  member: Member;
  index: number;
}

interface BatchPlan {
  batch: MenuBatch;
  untilDay: number;
  memberIds: string[];
}

interface BuildState {
  uses: Map<string, number>;
  lastDay: Map<string, number>;
  products: Set<string>;
  vitHave: Map<string, Map<VitaminId, number>>;
  categoriesByDay: Map<number, Set<string>>;
  batches: MenuBatch[];
  meals: MenuMeal[];
  unfilled: Unfilled[];
  conflicts: Conflict[];
  warnings: string[];
  activeBatch: Map<string, BatchPlan>;
  score: number;
  batchSeq: number;
  itemSeq: number;
}

class Planner {
  readonly recipes: string[];
  readonly nutrition: NutritionCache;
  readonly dates: string[];
  readonly slotShare: Map<string, number>;
  readonly kitchenCache = new Map<string, KitchenCheck>();
  readonly safeCache = new Map<string, boolean>();
  readonly recipeProducts = new Map<string, string[]>();
  readonly unitPrices = new Map<string, number | null>();
  readonly vitTargets = new Map<string, Map<VitaminId, number>>();
  readonly kcalTargets = new Map<string, number | null>();
  readonly memberOrder: Map<string, number>;
  evaluated = 0;

  constructor(
    readonly req: PlanRequest,
    readonly catalog: Catalog,
  ) {
    this.recipes = recipeIds(catalog);
    this.nutrition = new NutritionCache(catalog);
    this.dates = [];
    for (let d = 0; d < req.days; d += 1) this.dates.push(addDays(req.start_date, d));
    let shareSum = 0;
    for (const s of req.slots) shareSum += this.slotRef(s).energy_share;
    this.slotShare = new Map(req.slots.map((s) => [s, this.slotRef(s).energy_share / shareSum]));
    this.memberOrder = new Map(req.members.map((m, i) => [m.id, i]));
    for (const id of this.recipes) {
      const recipe = catalog.recipes[id] as Recipe;
      const products: string[] = [];
      for (const ing of recipe.ingredients) {
        const p = catalog.products[ing.product];
        if (p && p.purchasable !== false && !products.includes(p.id)) products.push(p.id);
      }
      this.recipeProducts.set(id, products);
    }
    for (const m of req.members) {
      this.kcalTargets.set(m.id, m.portion_mode === 'target' && m.kcal_target ? m.kcal_target : null);
      const vit = new Map<VitaminId, number>();
      if (req.settings.vitamins.enabled) {
        for (const t of resolveVitaminTargets(catalog, m, req.settings.vitamins.target_set, req.settings.vitamins.demo)) {
          if (t.status === 'ok' && t.daily !== null && t.daily > 0) vit.set(t.nutrient, t.daily * req.days);
        }
      }
      this.vitTargets.set(m.id, vit);
    }
  }

  slotRef(slot: string) {
    const ref = this.catalog.reference.meal_slots.find((s) => s.id === slot);
    if (!ref) throw new EngineError('unknown_slot', `Неизвестный приём пищи: ${slot}.`);
    return ref;
  }

  participants(slot: string): Participant[] {
    const ids = this.req.slot_members?.[slot] ?? null;
    const list: Participant[] = [];
    this.req.members.forEach((member, index) => {
      if (ids === null || ids.includes(member.id)) list.push({ member, index });
    });
    return list;
  }

  /** Saturday and Sunday may have their own cooking time limit. */
  isWeekend(day: number): boolean {
    return isoWeekday(this.dates[day] as string) >= 6;
  }

  timeLimit(weekend: boolean): number | null {
    const s = this.req.settings;
    // A missing weekend limit (older settings) means «same as weekdays»; null means «no limit».
    return weekend && s.max_total_min_weekend !== undefined ? s.max_total_min_weekend : s.max_total_min;
  }

  kitchen(recipeId: string, slot: string, container: boolean, weekend = false): KitchenCheck {
    const key = `${recipeId}|${slot}|${container ? 1 : 0}|${weekend ? 1 : 0}`;
    let check = this.kitchenCache.get(key);
    if (!check) {
      const s = this.req.settings;
      check = kitchenCheck(this.catalog, this.catalog.recipes[recipeId] as Recipe, {
        slot,
        equipment: s.equipment,
        skill: s.skill,
        maxTotalMin: this.timeLimit(weekend),
        container,
        mainCourse: this.mainCourse(recipeId, slot),
      });
      this.kitchenCache.set(key, check);
    }
    return check;
  }

  /**
   * Lunch and dinner are built around a main course: a soup or a main dish, or another dish that is
   * hearty enough on its own (a Caesar salad with chicken, not a radish salad). A partial nutrient
   * total is a lower bound, so reaching the threshold with it still proves the dish is hearty.
   */
  mainCourse(recipeId: string, slot: string): boolean {
    const rule = this.slotRef(slot).main_course;
    if (!rule) return true;
    const recipe = this.catalog.recipes[recipeId] as Recipe;
    if (rule.categories.includes(recipe.category)) return true;
    const serving = this.perServing(recipeId);
    return serving.kcal.value >= rule.hearty_kcal && serving.protein.value >= rule.hearty_protein;
  }

  safe(recipeId: string, member: Member): boolean {
    const key = `${recipeId}|${member.id}`;
    let ok = this.safeCache.get(key);
    if (ok === undefined) {
      ok = isRecipeSafeFor(this.catalog, this.catalog.recipes[recipeId] as Recipe, member);
      this.safeCache.set(key, ok);
    }
    return ok;
  }

  unitPrice(productId: string): number | null {
    if (!this.unitPrices.has(productId)) {
      const product = this.catalog.products[productId];
      this.unitPrices.set(productId, product ? unitPriceKop(this.req.prices, product) : null);
    }
    return this.unitPrices.get(productId) ?? null;
  }

  perServing(recipeId: string): NutrientTable {
    return this.nutrition.perServing(recipeId);
  }

  portion(member: Member, recipeId: string, slot: string): number {
    const s = this.req.settings;
    const kcalTarget = this.kcalTargets.get(member.id) ?? null;
    if (kcalTarget !== null) {
      const mealKcal = kcalTarget * (this.slotShare.get(slot) ?? 0);
      const serving = this.perServing(recipeId).kcal.value;
      if (serving > 0) return clamp(Math.floor((mealKcal / serving) * 20 + 0.5) / 20, s.portion_min, s.portion_max);
      return clamp(1, s.portion_min, s.portion_max);
    }
    return clamp(member.portion_factor, 0.25, 3);
  }

  repeatAllowed(state: BuildState, recipeId: string, day: number): boolean {
    const r = this.req.settings.repeat;
    const uses = state.uses.get(recipeId) ?? 0;
    if (r.mode === 'unique') return uses === 0;
    if (uses >= r.max_uses) return false;
    const last = state.lastDay.get(recipeId);
    return last === undefined || day - last >= r.min_gap_days;
  }

  estimateCost(recipeId: string, totalPortions: number): number {
    const recipe = this.catalog.recipes[recipeId] as Recipe;
    const scale = totalPortions / recipe.servings;
    let cost = 0;
    for (const ing of recipe.ingredients) {
      const product = this.catalog.products[ing.product];
      if (!product || product.purchasable === false) continue;
      const price = this.unitPrice(product.id);
      if (price === null) continue;
      const base = toBase(product, ing.qty * scale, ing.unit);
      if (base === null) continue;
      cost += base * price;
    }
    return cost;
  }

  vitaminGain(state: BuildState, recipeId: string, portions: Map<string, number>, people: Participant[]): number {
    const meals = this.req.days * this.req.slots.length;
    let gain = 0;
    const serving = this.perServing(recipeId);
    for (const p of people) {
      const targets = this.vitTargets.get(p.member.id) as Map<VitaminId, number>;
      const have = state.vitHave.get(p.member.id) as Map<VitaminId, number>;
      const factor = portions.get(p.member.id) ?? 0;
      for (const vit of VITAMIN_IDS) {
        const period = targets.get(vit);
        if (period === undefined) continue;
        const amount = serving[vit];
        if (!amount.complete) continue;
        const current = have.get(vit) ?? 0;
        const add = amount.value * factor;
        // Newly covered part of the period target, in «fair per-meal shares», capped at one share.
        const shares = ((Math.min(period, current + add) - Math.min(period, current)) / period) * meals;
        gain += Math.min(1, shares);
      }
    }
    return gain;
  }

  score(
    state: BuildState,
    recipeId: string,
    people: Participant[],
    day: number,
    slot: string,
    container: boolean,
    costWeight: number,
    budgetPerMeal: number,
  ): number {
    const recipe = this.catalog.recipes[recipeId] as Recipe;
    const s = this.req.settings;
    let score = 0;
    const rules = this.catalog.reference.diet_rules[s.diet_mode] ?? {};
    for (const tag of recipe.diet_tags) {
      const w = rules[tag];
      if (w !== undefined) score += w;
    }
    for (const p of people) {
      if (p.member.preferences.liked_recipes.includes(recipeId)) score += SCORE.liked;
      if (recipeHasDislikedProduct(this.catalog, recipe, p.member)) score += SCORE.disliked;
      if (recipeHasLikedProduct(this.catalog, recipe, p.member)) score += SCORE.likedProduct;
      if (recipe.kid_friendly === true && p.member.age !== null && p.member.age < 12) score += SCORE.kidFriendly;
    }
    const cuisines = s.cuisines ?? [];
    if (cuisines.length > 0 && recipe.cuisine && cuisines.includes(recipe.cuisine)) score += SCORE.cuisine;
    if (state.categoriesByDay.get(day)?.has(recipe.category)) score += SCORE.sameCategorySameDay;
    score += SCORE.repeatUse * (state.uses.get(recipeId) ?? 0);
    let shared = 0;
    for (const pid of this.recipeProducts.get(recipeId) ?? []) if (state.products.has(pid)) shared += 1;
    score += Math.min(shared * SCORE.sharedIngredient, SCORE.sharedIngredientCap);
    const method = this.kitchen(recipeId, slot, container, this.isWeekend(day)).method;
    if (method) score -= (method.total_min / 120) * SCORE.timePer120Min;
    const portions = new Map<string, number>();
    let total = 0;
    for (const p of people) {
      const f = this.portion(p.member, recipeId, slot);
      portions.set(p.member.id, f);
      total += f;
    }
    if (costWeight > 0 && budgetPerMeal > 0) {
      score -= (costWeight * this.estimateCost(recipeId, total)) / budgetPerMeal;
    }
    if (s.vitamins.enabled) {
      // Averaged per participant. Coverage above the target adds nothing (the gain saturates).
      score += (SCORE.vitamins * this.vitaminGain(state, recipeId, portions, people)) / people.length;
    }
    return score;
  }

  pickBest(
    state: BuildState,
    candidates: string[],
    people: Participant[],
    day: number,
    slot: string,
    container: boolean,
    rng: Rng,
    costWeight: number,
    budgetPerMeal: number,
  ): { recipeId: string; score: number } | null {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const id of candidates) {
      this.evaluated += 1;
      if (this.evaluated > SCORE.maxEvaluations) {
        throw new EngineError('search_limit', 'Превышен лимит перебора. Сократите период или число участников.');
      }
      const value = this.score(state, id, people, day, slot, container, costWeight, budgetPerMeal) + SCORE.jitter * rng.next();
      if (value > bestScore) {
        bestScore = value;
        best = id;
      }
    }
    return best === null ? null : { recipeId: best, score: bestScore };
  }

  candidatesFor(state: BuildState, people: Participant[], day: number, slot: string, container: boolean): string[] {
    const out: string[] = [];
    for (const id of this.recipes) {
      if (this.kitchen(id, slot, container, this.isWeekend(day)).method === null) continue;
      if (!people.every((p) => this.safe(id, p.member))) continue;
      if (!this.repeatAllowed(state, id, day)) continue;
      out.push(id);
    }
    return out;
  }

  explainEmpty(state: BuildState, people: Participant[], day: number, slot: string, container: boolean): { code: string; message: string } {
    const counts: Record<string, number> = {};
    let repeatOnly = 0;
    for (const id of this.recipes) {
      const check = this.kitchen(id, slot, container, this.isWeekend(day));
      if (check.reasons.length > 0) {
        for (const r of check.reasons) counts[r] = (counts[r] ?? 0) + 1;
        continue;
      }
      const blocked = people.filter((p) => !this.safe(id, p.member));
      if (blocked.length > 0) {
        const recipe = this.catalog.recipes[id] as Recipe;
        for (const p of blocked) {
          const tooSpicy = recipeSpice(recipe) > spiceTolerance(p.member);
          const key = `${tooSpicy ? 'spicy' : 'restriction'}:${p.member.name}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
        continue;
      }
      if (!this.repeatAllowed(state, id, day)) {
        counts.repeat = (counts.repeat ?? 0) + 1;
        repeatOnly += 1;
      }
    }
    const parts: string[] = [];
    for (const key of Object.keys(counts).sort(compareStr)) {
      const n = counts[key] as number;
      if (key.startsWith('restriction:')) parts.push(`${n} — запреты участника «${key.slice(12)}»`);
      else if (key.startsWith('spicy:')) parts.push(`${n} — острее, чем допускает участник «${key.slice(6)}»`);
      else parts.push(`${n} — ${REASON_MESSAGES[key] ?? key}`);
    }
    const slotName = this.slotRef(slot).name;
    // A recipe can fail several checks, so the counts may add up to more than the catalogue size.
    const message = `На ${slotName.toLowerCase()} не нашлось подходящего блюда. Причины отсева среди ${this.recipes.length} рецептов (у рецепта их может быть несколько): ${parts.join('; ')}.`;
    return { code: repeatOnly > 0 ? 'repeat_exhausted' : 'no_candidates', message };
  }

  newBatch(state: BuildState, recipeId: string, methodId: string, date: string, slot: string): MenuBatch {
    state.batchSeq += 1;
    const recipe = this.catalog.recipes[recipeId] as Recipe;
    const batch: MenuBatch = { id: `b${state.batchSeq}`, recipe_id: recipeId, recipe_version: recipe.version, method_id: methodId, cook_date: date, slot, portions: 0 };
    state.batches.push(batch);
    return batch;
  }

  addItem(
    state: BuildState,
    meal: MenuMeal,
    batch: MenuBatch,
    people: Participant[],
    day: number,
    pinned: boolean,
    countUse: boolean,
    fixedPortions: Record<string, number> | null,
  ): MenuItem {
    state.itemSeq += 1;
    const portions: Record<string, number> = {};
    for (const p of people) {
      const f = fixedPortions?.[p.member.id] ?? this.portion(p.member, batch.recipe_id, meal.slot);
      portions[p.member.id] = f;
      batch.portions += f;
      const have = state.vitHave.get(p.member.id) as Map<VitaminId, number>;
      const serving = this.perServing(batch.recipe_id);
      for (const vit of VITAMIN_IDS) {
        const amount = serving[vit];
        if (amount.complete) have.set(vit, (have.get(vit) ?? 0) + amount.value * f);
      }
    }
    const item: MenuItem = { id: `i${state.itemSeq}`, batch_id: batch.id, portions, pinned, alternative_for: null };
    meal.items.push(item);
    const recipe = this.catalog.recipes[batch.recipe_id] as Recipe;
    if (countUse) {
      state.uses.set(recipe.id, (state.uses.get(recipe.id) ?? 0) + 1);
      for (const pid of this.recipeProducts.get(recipe.id) ?? []) state.products.add(pid);
    }
    state.lastDay.set(recipe.id, day);
    let cats = state.categoriesByDay.get(day);
    if (!cats) {
      cats = new Set();
      state.categoriesByDay.set(day, cats);
    }
    cats.add(recipe.category);
    return item;
  }

  batchUntil(day: number): number {
    const r = this.req.settings.repeat;
    let until = Math.min(day + r.batch_days - 1, this.req.days - 1);
    if (r.cook_days.length > 0) {
      for (let d = day + 1; d <= until; d += 1) {
        if (r.cook_days.includes(isoWeekday(this.dates[d] as string))) {
          until = d - 1;
          break;
        }
      }
    }
    return until;
  }

  emptyState(): BuildState {
    return {
      uses: new Map(),
      lastDay: new Map(),
      products: new Set(),
      vitHave: new Map(this.req.members.map((m) => [m.id, new Map()])),
      categoriesByDay: new Map(),
      batches: [],
      meals: [],
      unfilled: [],
      conflicts: [],
      warnings: [],
      activeBatch: new Map(),
      score: 0,
      batchSeq: 0,
      itemSeq: 0,
    };
  }

  build(rng: Rng, costWeight: number): BuildState {
    const req = this.req;
    const s = req.settings;
    const state = this.emptyState();
    const budgetPerMeal = s.budget.limit_kop !== null ? s.budget.limit_kop / (req.days * req.slots.length) : 0;
    const pins = new Map<string, NonNullable<PlanRequest['pins']>>();
    for (const pin of req.pins ?? []) {
      const key = `${pin.date}|${pin.slot}`;
      const list = pins.get(key) ?? [];
      list.push(pin);
      pins.set(key, list);
    }
    const pinnedRecipeUses = new Map<string, number>();

    for (let day = 0; day < req.days; day += 1) {
      const date = this.dates[day] as string;
      const weekday = isoWeekday(date);
      for (const slot of req.slots) {
        const meal: MenuMeal = { date, slot, items: [] };
        let people = this.participants(slot);
        const container = slot === 'lunch' && s.container_days.includes(weekday);

        for (const pin of pins.get(`${date}|${slot}`) ?? []) {
          const recipe = this.catalog.recipes[pin.recipe_id];
          const method = recipe ? findMethod(recipe, pin.method_id) : null;
          const pinPeople = people.filter((p) => pin.portions[p.member.id] !== undefined);
          const unsafe = recipe ? pinPeople.filter((p) => !this.safe(recipe.id, p.member)) : pinPeople;
          if (!recipe || !method || unsafe.length > 0 || pinPeople.length === 0) {
            state.conflicts.push({
              code: 'pin_invalid',
              message: `Закреплённое блюдо на ${date} (${this.slotRef(slot).name}) нельзя сохранить: ${!recipe ? 'рецепт удалён' : !method ? 'способ приготовления недоступен' : unsafe.length > 0 ? `оно нарушает запреты участника «${unsafe.map((p) => p.member.name).join('», «')}»` : 'участники не входят в этот приём пищи'}.`,
              suggestion: 'Снимите закрепление или замените блюдо вручную.',
            });
            continue;
          }
          const used = pinnedRecipeUses.get(recipe.id) ?? 0;
          pinnedRecipeUses.set(recipe.id, used + 1);
          if (s.repeat.mode === 'unique' && used > 0) {
            state.conflicts.push({
              code: 'pins_repeat',
              message: `Блюдо «${recipe.name}» закреплено несколько раз, а выбран режим «Разные блюда каждый день».`,
              suggestion: 'Снимите одно из закреплений или включите режим «Повторы разрешены».',
            });
          }
          const batch = this.newBatch(state, recipe.id, method.id, date, slot);
          this.addItem(state, meal, batch, pinPeople, day, true, true, pin.portions);
          people = people.filter((p) => pin.portions[p.member.id] === undefined);
        }

        if (people.length > 0 && s.repeat.mode === 'batch' && s.repeat.batch_slots.includes(slot)) {
          const active = state.activeBatch.get(slot);
          const sameGroup = active ? active.memberIds.join(',') === people.map((p) => p.member.id).join(',') : false;
          if (active && day <= active.untilDay && sameGroup && !(container && !(this.catalog.recipes[active.batch.recipe_id] as Recipe).container_ok)) {
            this.addItem(state, meal, active.batch, people, day, false, false, null);
            people = [];
          }
        }

        if (people.length > 0) {
          const candidates = this.candidatesFor(state, people, day, slot, container);
          const best = this.pickBest(state, candidates, people, day, slot, container, rng, costWeight, budgetPerMeal);
          if (best) {
            const method = this.kitchen(best.recipeId, slot, container, this.isWeekend(day)).method;
            const batch = this.newBatch(state, best.recipeId, method?.id ?? '', date, slot);
            this.addItem(state, meal, batch, people, day, false, true, null);
            state.score += best.score;
            if (s.repeat.mode === 'batch' && s.repeat.batch_slots.includes(slot)) {
              state.activeBatch.set(slot, { batch, untilDay: this.batchUntil(day), memberIds: people.map((p) => p.member.id) });
            }
          } else if (people.length > 1) {
            // No dish is safe for everyone: give each participant a separate safe dish.
            const split: string[] = [];
            for (const p of people) {
              const own = this.candidatesFor(state, [p], day, slot, container);
              const pick = this.pickBest(state, own, [p], day, slot, container, rng, costWeight, budgetPerMeal);
              if (pick) {
                const method = this.kitchen(pick.recipeId, slot, container, this.isWeekend(day)).method;
                const batch = this.newBatch(state, pick.recipeId, method?.id ?? '', date, slot);
                this.addItem(state, meal, batch, [p], day, false, true, null);
                state.score += pick.score;
                split.push(p.member.name);
              } else {
                const why = this.explainEmpty(state, [p], day, slot, container);
                state.unfilled.push({ date, slot, member_ids: [p.member.id], code: why.code, message: why.message });
              }
            }
            if (split.length > 0) {
              state.warnings.push(`${date}, ${this.slotRef(slot).name}: общего блюда для всех нет, подобраны отдельные блюда (${split.join(', ')}).`);
            }
          } else {
            const why = this.explainEmpty(state, people, day, slot, container);
            state.unfilled.push({ date, slot, member_ids: people.map((p) => p.member.id), code: why.code, message: why.message });
          }
        }
        state.meals.push(meal);
      }
    }

    if (state.unfilled.some((u) => u.code === 'repeat_exhausted')) {
      state.conflicts.push({
        code: s.repeat.mode === 'unique' ? 'unique_mode_catalog_too_small' : 'repeat_limit_too_strict',
        message:
          s.repeat.mode === 'unique'
            ? 'Подходящих рецептов не хватает, чтобы не повторять блюда весь период.'
            : 'Ограничения на повторы не позволяют заполнить все приёмы пищи.',
        suggestion:
          s.repeat.mode === 'unique'
            ? 'Выберите «Повторы разрешены», сократите период или ослабьте мягкие условия (время, технику, уровень).'
            : 'Увеличьте допустимое число повторов или уменьшите интервал между ними.',
      });
    }
    if (s.repeat.mode === 'batch' && state.meals.some((m) => m.items.some((i) => (state.batches.find((b) => b.id === i.batch_id) as MenuBatch).cook_date !== m.date))) {
      state.warnings.push('Блюда из партии едят в другие дни: сроки хранения рецептов не проверены, ориентируйтесь на собственные правила хранения.');
    }
    return state;
  }
}

export interface RankedCandidate {
  recipe_id: string;
  method_id: string;
  score: number;
}

/**
 * Ranks replacement candidates for one meal of an existing menu (no jitter, deterministic). The state
 * of the rest of the menu (uses, shared products, vitamin coverage) is rebuilt without the item
 * being replaced, so repeat rules and scoring match the generator.
 */
export function rankCandidates(
  req: PlanRequest,
  catalog: Catalog,
  menu: Menu,
  date: string,
  slot: string,
  people: Member[],
  excludeItemId: string | null,
): RankedCandidate[] {
  const planner = new Planner(req, catalog);
  const state = planner.emptyState();
  const day = planner.dates.indexOf(date);
  if (day < 0) throw new EngineError('meal_not_found', 'Дата вне периода меню.');
  const batches = new Map(menu.batches.map((b) => [b.id, b]));
  const counted = new Set<string>();
  menu.meals.forEach((meal) => {
    const d = planner.dates.indexOf(meal.date);
    for (const item of meal.items) {
      if (item.id === excludeItemId) continue;
      const batch = batches.get(item.batch_id);
      if (!batch || !catalog.recipes[batch.recipe_id]) continue;
      if (!counted.has(batch.id)) {
        counted.add(batch.id);
        state.uses.set(batch.recipe_id, (state.uses.get(batch.recipe_id) ?? 0) + 1);
        for (const pid of planner.recipeProducts.get(batch.recipe_id) ?? []) state.products.add(pid);
      }
      const last = state.lastDay.get(batch.recipe_id);
      if (last === undefined || d > last) state.lastDay.set(batch.recipe_id, d);
      let cats = state.categoriesByDay.get(d);
      if (!cats) {
        cats = new Set();
        state.categoriesByDay.set(d, cats);
      }
      cats.add((catalog.recipes[batch.recipe_id] as Recipe).category);
      const serving = planner.perServing(batch.recipe_id);
      for (const memberId of Object.keys(item.portions).sort(compareStr)) {
        const have = state.vitHave.get(memberId);
        if (!have) continue;
        for (const vit of VITAMIN_IDS) {
          const amount = serving[vit];
          if (amount.complete) have.set(vit, (have.get(vit) ?? 0) + amount.value * (item.portions[memberId] as number));
        }
      }
    }
  });
  const participants: Participant[] = [];
  req.members.forEach((member, index) => {
    if (people.some((p) => p.id === member.id)) participants.push({ member, index });
  });
  const weekday = isoWeekday(date);
  const container = slot === 'lunch' && req.settings.container_days.includes(weekday);
  const s = req.settings;
  const budgetPerMeal = s.budget.limit_kop !== null ? s.budget.limit_kop / (req.days * req.slots.length) : 0;
  const ranked: RankedCandidate[] = [];
  for (const id of planner.candidatesFor(state, participants, day, slot, container)) {
    const method = planner.kitchen(id, slot, container, planner.isWeekend(day)).method;
    if (!method) continue;
    ranked.push({ recipe_id: id, method_id: method.id, score: planner.score(state, id, participants, day, slot, container, s.budget.limit_kop !== null ? 0.75 : 0, budgetPerMeal) });
  }
  ranked.sort((a, b) => b.score - a.score || compareStr(a.recipe_id, b.recipe_id));
  return ranked;
}

function attemptsFor(days: number): number {
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  return 3;
}

/** Hard-restriction check of a finished menu; returns human-readable violations (empty if valid). */
export function menuViolations(menu: Menu, catalog: Catalog, members: Member[]): string[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const batches = new Map(menu.batches.map((b) => [b.id, b]));
  const errors: string[] = [];
  for (const meal of menu.meals) {
    for (const item of meal.items) {
      const batch = batches.get(item.batch_id);
      const recipe = batch ? catalog.recipes[batch.recipe_id] : undefined;
      if (!batch || !recipe) {
        errors.push(`${meal.date}: блюдо ссылается на неизвестный рецепт.`);
        continue;
      }
      for (const memberId of Object.keys(item.portions)) {
        const member = byId.get(memberId);
        if (!member) {
          errors.push(`${meal.date}: порция для неизвестного участника.`);
          continue;
        }
        const v = recipeViolations(catalog, recipe, effectiveRestrictions(catalog, member));
        if (v.length > 0) errors.push(`${meal.date}: «${recipe.name}» нарушает запреты участника «${member.name}».`);
        else if (recipeSpice(recipe) > spiceTolerance(member)) errors.push(`${meal.date}: «${recipe.name}» острее, чем допускает участник «${member.name}».`);
      }
    }
  }
  for (const batch of menu.batches) {
    let eaten = 0;
    for (const meal of menu.meals) for (const item of meal.items) if (item.batch_id === batch.id) for (const v of Object.values(item.portions)) eaten += v;
    if (eaten > batch.portions + 1e-9) errors.push(`Сумма порций превышает объём партии ${batch.id}.`);
  }
  return errors;
}

export function generateMenu(req: PlanRequest, catalog: Catalog): PlanResult {
  validatePlanRequest(req, catalog);
  const planner = new Planner(req, catalog);
  const rng = new Rng(req.seed);
  const attempts = attemptsFor(req.days);
  const budget = req.settings.budget.limit_kop !== null;
  let best: { state: BuildState; objective: number; status: BudgetStatus } | null = null;
  for (let a = 0; a < attempts; a += 1) {
    const costWeight = budget ? a * 0.75 : 0;
    const state = planner.build(rng, costWeight);
    let status: BudgetStatus = 'none';
    if (budget) {
      const draft = assemble(req, catalog, state, planner.evaluated, a + 1, 'none');
      status = computeShopping(draft, catalog, req.pantry ?? [], req.prices ?? null, emptyShoppingState()).budget.status;
    }
    const objective =
      state.score - SCORE.unfilledPenalty * state.unfilled.length - (status === 'exceeded' ? SCORE.budgetExceededPenalty : 0);
    if (best === null || objective > best.objective) best = { state, objective, status };
  }
  const chosen = best as { state: BuildState; objective: number; status: BudgetStatus };
  const menu = assemble(req, catalog, chosen.state, planner.evaluated, attempts, chosen.status);
  if (chosen.status === 'exceeded') {
    menu.conflicts.push({
      code: 'budget_exceeded',
      message: 'В пределах текущего поиска и известных цен не найдено меню, укладывающееся в бюджет.',
      suggestion: 'Увеличьте лимит, добавьте остатки дома, разрешите повторы или выберите более простые блюда.',
    });
  }
  const violations = menuViolations(menu, catalog, req.members);
  if (violations.length > 0) {
    throw new EngineError('internal_violation', 'Внутренняя ошибка: меню нарушает ограничения.', { violations });
  }
  const diagnostics: Record<string, SlotDiagnostics> = {};
  for (const slot of req.slots) {
    const excluded: Record<string, number> = {};
    let kitchenOk = 0;
    for (const id of planner.recipes) {
      const check = planner.kitchen(id, slot, false);
      if (check.reasons.length === 0) kitchenOk += 1;
      for (const r of check.reasons) excluded[r] = (excluded[r] ?? 0) + 1;
    }
    diagnostics[slot] = { total: planner.recipes.length, kitchen_ok: kitchenOk, excluded };
  }
  return { menu, diagnostics };
}

function assemble(
  req: PlanRequest,
  catalog: Catalog,
  state: BuildState,
  evaluated: number,
  attempts: number,
  status: BudgetStatus,
): Menu {
  const snapshot: Menu['snapshot'] = { recipes: {}, products: {} };
  for (const b of state.batches) addToSnapshot(snapshot, catalog, b.recipe_id);
  return {
    format: 'foodo-menu',
    format_version: 1,
    start_date: req.start_date,
    days: req.days,
    seed: req.seed,
    revision: 1,
    slots: [...req.slots],
    member_ids: req.members.map((m) => m.id),
    settings: req.settings,
    batches: state.batches.map((b) => ({ ...b })),
    meals: state.meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, portions: { ...i.portions } })) })),
    unfilled: [...state.unfilled],
    conflicts: [...state.conflicts],
    warnings: [...state.warnings],
    snapshot,
    stats: { attempts, evaluated, score: state.score, budget_status: status },
  };
}

