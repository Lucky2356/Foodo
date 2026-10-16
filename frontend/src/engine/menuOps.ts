import { compareStr, isIsoDate } from './basics';
import { addToSnapshot, findMethod, selectMethod, recipeSkillRank, skillAllows, snapshotCatalog } from './catalog';
import { generateMenu, menuViolations, rankCandidates } from './generator';
import { recipeViolations } from './restrictions';
import { EngineError } from './types';
import type { Catalog, Member, Menu, MenuBatch, MenuItem, MenuMeal, PlanRequest, PriceProfile, PantryItem } from './types';

// Editing operations on a saved menu. Each operation returns a new menu (revision + 1) and never
// mutates its input. Hard restrictions, equipment and skill are re-checked for every dish the user
// picks by hand; batch portions stay consistent with the meals that eat from them.

export type MenuOp =
  | { op: 'replace'; item_id: string; recipe_id: string | null; method_id?: string | null }
  | { op: 'set_portion'; item_id: string; member_id: string; portion: number }
  | { op: 'move'; from: { date: string; slot: string }; to: { date: string; slot: string } }
  | { op: 'pin'; item_id: string; pinned: boolean }
  | { op: 'split'; item_id: string; member_id: string; recipe_id: string | null }
  | { op: 'add'; date: string; slot: string; recipe_id: string; member_ids: string[]; method_id?: string | null }
  | { op: 'remove'; item_id: string }
  | { op: 'regenerate'; seed: number };

export interface OpContext {
  catalog: Catalog;
  members: Member[];
  pantry?: PantryItem[];
  prices?: PriceProfile | null;
}

function clone(menu: Menu): Menu {
  return JSON.parse(JSON.stringify(menu)) as Menu;
}

function nextId(prefix: string, ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const n = Number(id.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

function allItems(menu: Menu): { meal: MenuMeal; item: MenuItem }[] {
  const out: { meal: MenuMeal; item: MenuItem }[] = [];
  for (const meal of menu.meals) for (const item of meal.items) out.push({ meal, item });
  return out;
}

function findItem(menu: Menu, itemId: string): { meal: MenuMeal; item: MenuItem } {
  const found = allItems(menu).find((x) => x.item.id === itemId);
  if (!found) throw new EngineError('item_not_found', 'Блюдо не найдено в меню.');
  return found;
}

function findMeal(menu: Menu, date: string, slot: string): MenuMeal {
  const meal = menu.meals.find((m) => m.date === date && m.slot === slot);
  if (!meal) throw new EngineError('meal_not_found', 'Приём пищи не найден в меню.');
  return meal;
}

function batchOf(menu: Menu, item: MenuItem): MenuBatch {
  const batch = menu.batches.find((b) => b.id === item.batch_id);
  if (!batch) throw new EngineError('batch_not_found', 'Партия блюда не найдена.');
  return batch;
}

function itemTotal(item: MenuItem): number {
  let total = 0;
  for (const key of Object.keys(item.portions).sort(compareStr)) total += item.portions[key] as number;
  return total;
}

/** Recomputes batch portions from the meals and drops batches nobody eats from. */
function normaliseBatches(menu: Menu): void {
  const totals = new Map<string, number>();
  for (const { item } of allItems(menu)) totals.set(item.batch_id, (totals.get(item.batch_id) ?? 0) + itemTotal(item));
  menu.batches = menu.batches.filter((b) => (totals.get(b.id) ?? 0) > 0);
  for (const b of menu.batches) b.portions = totals.get(b.id) ?? 0;
}

function memberMap(members: Member[]): Map<string, Member> {
  return new Map(members.map((m) => [m.id, m]));
}

/** Validates a dish chosen by hand for the given people: restrictions, equipment and skill. */
function checkManualChoice(menu: Menu, catalog: Catalog, recipeId: string, methodId: string | null | undefined, people: Member[]) {
  const recipe = catalog.recipes[recipeId];
  if (!recipe) throw new EngineError('recipe_not_found', 'Рецепт не найден.');
  for (const m of people) {
    const v = recipeViolations(catalog, recipe, m.restrictions);
    if (v.length > 0) {
      throw new EngineError('restriction_violation', `«${recipe.name}» нельзя участнику «${m.name}»: блюдо нарушает его запреты или его состав не проверен.`, {
        member_id: m.id,
        violations: v,
      });
    }
  }
  const method = methodId ? findMethod(recipe, methodId) : selectMethod(recipe, menu.settings.equipment);
  if (!method || !method.equipment.every((e) => menu.settings.equipment.includes(e))) {
    throw new EngineError('equipment_missing', `Для «${recipe.name}» нужна техника, которой нет в настройках кухни.`);
  }
  if (!skillAllows(menu.settings.skill, recipeSkillRank(catalog.reference, recipe))) {
    throw new EngineError('skill_too_high', `«${recipe.name}» требует более высокого уровня готовки, чем выбран в настройках.`);
  }
  return { recipe, method };
}

function newBatchFor(menu: Menu, catalog: Catalog, recipeId: string, methodId: string, date: string, slot: string): MenuBatch {
  const recipe = catalog.recipes[recipeId];
  if (!recipe) throw new EngineError('recipe_not_found', 'Рецепт не найден.');
  const batch: MenuBatch = {
    id: nextId('b', menu.batches.map((b) => b.id)),
    recipe_id: recipeId,
    recipe_version: recipe.version,
    method_id: methodId,
    cook_date: date,
    slot,
    portions: 0,
  };
  menu.batches.push(batch);
  addToSnapshot(menu.snapshot, catalog, recipeId);
  return batch;
}

function planRequestFromMenu(menu: Menu, ctx: OpContext, seed: number): PlanRequest {
  return {
    start_date: menu.start_date,
    days: menu.days,
    seed,
    slots: [...menu.slots],
    members: ctx.members.filter((m) => menu.member_ids.includes(m.id)),
    settings: menu.settings,
    pins: [],
    pantry: ctx.pantry ?? [],
    prices: ctx.prices ?? null,
  };
}

export function applyMenuOp(menu: Menu, op: MenuOp, ctx: OpContext): Menu {
  const members = memberMap(ctx.members);
  let next = clone(menu);

  switch (op.op) {
    case 'replace': {
      const { meal, item } = findItem(next, op.item_id);
      const people = Object.keys(item.portions).map((id) => members.get(id)).filter((m): m is Member => Boolean(m));
      const current = batchOf(next, item);
      let recipeId = op.recipe_id;
      let methodId = op.method_id ?? null;
      if (recipeId === null) {
        const ranked = rankCandidates(planRequestFromMenu(next, ctx, next.seed), ctx.catalog, next, meal.date, meal.slot, people, item.id);
        const pick = ranked.find((c) => c.recipe_id !== current.recipe_id);
        if (!pick) throw new EngineError('no_replacement', 'Нет другого подходящего блюда с учётом запретов, техники и режима повторов.');
        recipeId = pick.recipe_id;
        methodId = pick.method_id;
      }
      const { method } = checkManualChoice(next, ctx.catalog, recipeId, methodId, people);
      const batch = newBatchFor(next, ctx.catalog, recipeId, method.id, meal.date, meal.slot);
      item.batch_id = batch.id;
      break;
    }
    case 'set_portion': {
      const { item } = findItem(next, op.item_id);
      if (item.portions[op.member_id] === undefined) throw new EngineError('member_not_in_item', 'Участник не ест это блюдо.');
      if (!(op.portion >= 0.25 && op.portion <= 3)) throw new EngineError('invalid_portion', 'Порция должна быть от 0,25 до 3 стандартных порций.');
      item.portions[op.member_id] = op.portion;
      break;
    }
    case 'move': {
      if (!isIsoDate(op.to.date)) throw new EngineError('invalid_date', 'Некорректная дата.');
      const from = findMeal(next, op.from.date, op.from.slot);
      const to = findMeal(next, op.to.date, op.to.slot);
      const moving = [...from.items];
      const back = [...to.items];
      for (const item of moving) checkMoveDate(next, item, to.date);
      for (const item of back) checkMoveDate(next, item, from.date);
      from.items = back;
      to.items = moving;
      for (const item of moving) retargetSingleUseBatch(next, item, to);
      for (const item of back) retargetSingleUseBatch(next, item, from);
      break;
    }
    case 'pin': {
      const { item } = findItem(next, op.item_id);
      item.pinned = op.pinned;
      break;
    }
    case 'split': {
      const { meal, item } = findItem(next, op.item_id);
      const member = members.get(op.member_id);
      if (!member || item.portions[op.member_id] === undefined) throw new EngineError('member_not_in_item', 'Участник не ест это блюдо.');
      if (Object.keys(item.portions).length < 2) throw new EngineError('nothing_to_split', 'Блюдо и так приготовлено только для одного участника.');
      let recipeId = op.recipe_id;
      let methodId: string | null = null;
      if (recipeId === null) {
        const current = batchOf(next, item);
        const ranked = rankCandidates(planRequestFromMenu(next, ctx, next.seed), ctx.catalog, next, meal.date, meal.slot, [member], item.id);
        const pick = ranked.find((c) => c.recipe_id !== current.recipe_id);
        if (!pick) throw new EngineError('no_replacement', 'Не найдено отдельного блюда для участника.');
        recipeId = pick.recipe_id;
        methodId = pick.method_id;
      }
      const { method } = checkManualChoice(next, ctx.catalog, recipeId, methodId, [member]);
      const portion = item.portions[op.member_id] as number;
      delete item.portions[op.member_id];
      const batch = newBatchFor(next, ctx.catalog, recipeId, method.id, meal.date, meal.slot);
      meal.items.push({
        id: nextId('i', allItems(next).map((x) => x.item.id)),
        batch_id: batch.id,
        portions: { [op.member_id]: portion },
        pinned: false,
        alternative_for: item.id,
      });
      break;
    }
    case 'add': {
      const meal = findMeal(next, op.date, op.slot);
      const people = op.member_ids.map((id) => members.get(id)).filter((m): m is Member => Boolean(m));
      if (people.length === 0) throw new EngineError('no_members', 'Выберите, для кого это блюдо.');
      const { method } = checkManualChoice(next, ctx.catalog, op.recipe_id, op.method_id, people);
      const batch = newBatchFor(next, ctx.catalog, op.recipe_id, method.id, meal.date, meal.slot);
      const portions: Record<string, number> = {};
      for (const m of people) portions[m.id] = m.portion_mode === 'simple' ? Math.min(3, Math.max(0.25, m.portion_factor)) : 1;
      meal.items.push({ id: nextId('i', allItems(next).map((x) => x.item.id)), batch_id: batch.id, portions, pinned: false, alternative_for: null });
      next.unfilled = next.unfilled.filter((u) => !(u.date === meal.date && u.slot === meal.slot));
      break;
    }
    case 'remove': {
      const { meal } = findItem(next, op.item_id);
      meal.items = meal.items.filter((i) => i.id !== op.item_id);
      break;
    }
    case 'regenerate': {
      const req = planRequestFromMenu(next, ctx, op.seed);
      req.pins = [];
      for (const { meal, item } of allItems(next)) {
        if (!item.pinned) continue;
        const batch = batchOf(next, item);
        req.pins.push({ date: meal.date, slot: meal.slot, recipe_id: batch.recipe_id, method_id: batch.method_id, portions: { ...item.portions } });
      }
      // Pinned dishes must keep their saved recipe version: generate against the snapshot catalog.
      const fresh = generateMenu(req, { ...ctx.catalog, recipes: { ...ctx.catalog.recipes, ...pinnedRecipes(next) } }).menu;
      fresh.revision = next.revision;
      next = fresh;
      break;
    }
  }

  normaliseBatches(next);
  next.revision = menu.revision + 1;
  const violations = menuViolations(next, snapshotCatalog(next, ctx.catalog), ctx.members);
  if (violations.length > 0) throw new EngineError('restriction_violation', violations[0] as string, { violations });
  return next;
}

function pinnedRecipes(menu: Menu): Record<string, Menu['snapshot']['recipes'][string]> {
  const out: Record<string, Menu['snapshot']['recipes'][string]> = {};
  for (const { item } of allItems(menu)) {
    if (!item.pinned) continue;
    const batch = batchOf(menu, item);
    const recipe = menu.snapshot.recipes[batch.recipe_id];
    if (recipe) out[recipe.id] = recipe;
  }
  return out;
}

function checkMoveDate(menu: Menu, item: MenuItem, date: string): void {
  const batch = batchOf(menu, item);
  const shared = allItems(menu).filter((x) => x.item.batch_id === batch.id).length > 1;
  if (shared && date < batch.cook_date) {
    throw new EngineError('move_before_cook', 'Нельзя перенести блюдо из партии на день раньше её приготовления.');
  }
}

function retargetSingleUseBatch(menu: Menu, item: MenuItem, meal: MenuMeal): void {
  const batch = batchOf(menu, item);
  const uses = allItems(menu).filter((x) => x.item.batch_id === batch.id).length;
  if (uses === 1) {
    batch.cook_date = meal.date;
    batch.slot = meal.slot;
  }
}
