import {
  applyMenuOp,
  computeShopping,
  DEFAULT_SETTINGS,
  emptyShoppingState,
  EngineError,
  generateMenu,
  menuReport,
  pantryAfterCooking,
  rankCandidates,
} from '../engine';
import type { Catalog, Member, PlanRequest, PriceProfile, Recipe } from '../engine';
import { DEFAULT_TIMEZONE } from '../lib/config';
import { addDaysIso, deviceTimeZone, localDate } from '../lib/dates';
import { newId } from '../lib/format';
import { ApiError } from './api';
import { withCustomRecipes } from './catalogSource';
import { openGuestDb } from './localDb';
import type { GuestDb, GuestHousehold, StoredMenu } from './localDb';
import { fetchPublicPrices, mergePriceSources } from './prices';
import type {
  Gateway,
  GenerateParams,
  HabitView,
  HouseholdPatch,
  HouseholdSettings,
  HouseholdView,
  MenuRecord,
  MenuSummary,
  NewPrice,
  OwnPrice,
  PantryRecord,
  ShoppingView,
  WaterView,
} from './types';
import { MEMBER_LIMITS, rangeError } from '../lib/numbers';
import { customRecipeErrors } from '../lib/recipeValidation';
import type { MemberLimitKey } from '../lib/numbers';

export const DEFAULT_HOUSEHOLD_SETTINGS: HouseholdSettings = {
  slots: ['breakfast', 'lunch', 'snack', 'dinner'],
  days: 7,
  plan: structuredClone(DEFAULT_SETTINGS),
  slot_members: null,
  onboarded: false,
};

export function blankMember(name: string, position: number): Member & { position: number } {
  return {
    id: newId('m'),
    name,
    age: null,
    sex: null,
    height_cm: null,
    weight_kg: null,
    activity: null,
    goal: null,
    portion_mode: 'simple',
    portion_factor: 1,
    kcal_target: null,
    macro_targets: null,
    restrictions: { products: [], categories: [], allergens: [] },
    preferences: { liked_recipes: [], disliked_products: [] },
    vitamin_targets_manual: null,
    water_goal_ml: null,
    timezone: deviceTimeZone() || DEFAULT_TIMEZONE,
    position,
  };
}

function toError(e: unknown): never {
  if (e instanceof EngineError) throw new ApiError(e.code, e.message, 422, e.details);
  throw e;
}

function summary(m: StoredMenu): MenuSummary {
  return {
    id: m.id,
    title: m.title,
    start_date: m.start_date,
    days: m.days,
    revision: m.revision,
    is_favorite: m.is_favorite,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

function record(m: StoredMenu): MenuRecord {
  return { ...summary(m), menu: m.menu, shopping_revision: m.shopping_revision, cooked_batches: [...m.cooked_batches] };
}

/**
 * Guest mode: everything runs in this browser. Profiles, restrictions and menus never leave the
 * device; only public catalog/price data may be downloaded.
 */
export class GuestGateway implements Gateway {
  readonly mode = 'guest' as const;

  constructor(
    private readonly baseCatalog: () => Catalog,
    private readonly useServer: boolean,
    private readonly dbProvider: () => Promise<GuestDb> = () => openGuestDb(),
  ) {}

  private db(): Promise<GuestDb> {
    return this.dbProvider();
  }

  private async householdRow(): Promise<GuestHousehold> {
    const db = await this.db();
    const row = (await db.get('kv', 'household')) as GuestHousehold | undefined;
    if (row) return { ...row, settings: { ...DEFAULT_HOUSEHOLD_SETTINGS, ...row.settings, plan: { ...DEFAULT_SETTINGS, ...row.settings.plan } } };
    const fresh: GuestHousehold = { id: 'guest', name: 'Моя семья', settings: structuredClone(DEFAULT_HOUSEHOLD_SETTINGS), city: null, store_chain_id: null, share_prices: false };
    await db.put('kv', fresh, 'household');
    return fresh;
  }

  private async members(): Promise<Member[]> {
    const db = await this.db();
    const all = await db.getAll('members');
    return all.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  private async catalog(): Promise<Catalog> {
    const db = await this.db();
    return withCustomRecipes(this.baseCatalog(), await db.getAll('recipes'));
  }

  async getHousehold(): Promise<HouseholdView> {
    const h = await this.householdRow();
    return { ...h, role: 'owner', members: await this.members() };
  }

  async updateHousehold(patch: HouseholdPatch): Promise<HouseholdView> {
    const db = await this.db();
    const h = await this.householdRow();
    const next: GuestHousehold = { ...h };
    if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 100) || h.name;
    if (patch.settings !== undefined) next.settings = patch.settings;
    if (patch.store_chain_id !== undefined) next.store_chain_id = patch.store_chain_id;
    if (patch.share_prices !== undefined) next.share_prices = false; // nothing is shared from guest mode
    if (patch.city_id !== undefined) {
      if (patch.city_id === null) next.city = null;
      else {
        const { loadCities } = await import('./geo');
        const city = (await loadCities()).find((c) => c.id === patch.city_id);
        if (!city) throw new ApiError('not_found', 'Город не найден.', 404);
        next.city = { id: city.id, name: city.name, region: city.region, timezone: city.timezone };
      }
    }
    await db.put('kv', next, 'household');
    return this.getHousehold();
  }

  async addMember(data: Partial<Member> & { name: string }): Promise<Member> {
    const db = await this.db();
    const all = await db.getAll('members');
    const count = all.length;
    if (count >= 20) throw new ApiError('limit', 'В семье может быть не больше 20 участников.', 400);
    // After a removal positions have gaps: the next one goes after the last, never onto an existing one.
    const position = all.reduce((max, x) => Math.max(max, (x.position ?? 0) + 1), 0);
    const m = { ...blankMember(data.name, position), ...data, id: newId('m'), position };
    validateMember(m);
    await db.put('members', m);
    return m;
  }

  async updateMember(id: string, patch: Partial<Member>): Promise<Member> {
    const db = await this.db();
    const current = await db.get('members', id);
    if (!current) throw new ApiError('not_found', 'Участник не найден.', 404);
    const next = { ...current, ...patch, id };
    validateMember(next);
    await db.put('members', next);
    return next;
  }

  async deleteMember(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('members', id);
  }

  async listMenus(): Promise<MenuSummary[]> {
    const db = await this.db();
    const all = await db.getAll('menus');
    return all.map(summary).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at));
  }

  async getMenu(id: string): Promise<MenuRecord> {
    return record(await this.stored(id));
  }

  private async stored(id: string): Promise<StoredMenu> {
    const db = await this.db();
    const m = await db.get('menus', id);
    if (!m) throw new ApiError('not_found', 'Меню не найдено.', 404);
    return m;
  }

  async priceProfile(): Promise<PriceProfile> {
    const h = await this.householdRow();
    const db = await this.db();
    const own = (await db.getAll('prices')).filter((p) => p.chain_id === null || p.chain_id === h.store_chain_id);
    const publicEntries = h.city ? await fetchPublicPrices(h.city.id, h.store_chain_id, this.useServer, h.city.region) : [];
    return { store_id: h.store_chain_id ?? 'none', city_id: h.city?.id ?? null, region: h.city?.region ?? null, entries: mergePriceSources(own, publicEntries) };
  }

  async planRequest(params: GenerateParams): Promise<PlanRequest> {
    const h = await this.householdRow();
    const members = await this.members();
    if (members.length === 0) throw new ApiError('no_members', 'Добавьте хотя бы одного участника семьи.', 400);
    return {
      start_date: params.start_date,
      days: params.days ?? h.settings.days,
      seed: params.seed ?? crypto.getRandomValues(new Uint32Array(1))[0] as number,
      slots: h.settings.slots,
      members,
      slot_members: h.settings.slot_members,
      settings: h.settings.plan,
      pins: [],
      pantry: await this.listPantry(),
      prices: await this.priceProfile(),
    };
  }

  async generateMenu(params: GenerateParams): Promise<MenuRecord> {
    const req = await this.planRequest(params);
    const catalog = await this.catalog();
    let menu;
    try {
      menu = generateMenu(req, catalog).menu;
    } catch (e) {
      toError(e);
    }
    const now = new Date().toISOString();
    const stored: StoredMenu = {
      id: newId('menu'),
      title: params.title ?? '',
      start_date: menu.start_date,
      days: menu.days,
      revision: menu.revision,
      is_favorite: false,
      created_at: now,
      updated_at: now,
      menu,
      shopping_revision: 1,
      cooked_batches: [],
      shopping_state: emptyShoppingState(),
      transferred_lines: [],
    };
    const db = await this.db();
    await db.put('menus', stored);
    return record(stored);
  }

  async applyOp(menuId: string, op: unknown, expectedRevision: number | null): Promise<MenuRecord> {
    const stored = await this.stored(menuId);
    if (expectedRevision !== null && expectedRevision !== stored.revision) {
      throw new ApiError('revision_conflict', 'Меню изменилось в другой вкладке. Обновите страницу.', 409);
    }
    const catalog = await this.catalog();
    let menu;
    try {
      menu = applyMenuOp(stored.menu, op as Parameters<typeof applyMenuOp>[1], {
        catalog,
        members: await this.members(),
        pantry: await this.listPantry(),
        prices: await this.priceProfile(),
      });
    } catch (e) {
      toError(e);
    }
    const next: StoredMenu = { ...stored, menu, revision: menu.revision, updated_at: new Date().toISOString() };
    const db = await this.db();
    await db.put('menus', next);
    return record(next);
  }

  async updateMenuMeta(id: string, patch: { title?: string; is_favorite?: boolean }): Promise<void> {
    const stored = await this.stored(id);
    const db = await this.db();
    await db.put('menus', { ...stored, ...patch, updated_at: new Date().toISOString() });
  }

  async deleteMenu(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('menus', id);
  }

  async candidates(menuId: string, itemId: string) {
    const stored = await this.stored(menuId);
    const meal = stored.menu.meals.find((m) => m.items.some((i) => i.id === itemId));
    if (!meal) throw new ApiError('item_not_found', 'Блюдо не найдено в меню.', 404);
    const item = meal.items.find((i) => i.id === itemId);
    const members = (await this.members()).filter((m) => item && item.portions[m.id] !== undefined);
    const req = { ...(await this.planRequest({ start_date: stored.menu.start_date, days: stored.menu.days, seed: stored.menu.seed })), slots: stored.menu.slots, settings: stored.menu.settings };
    try {
      return rankCandidates(req, await this.catalog(), stored.menu, meal.date, meal.slot, members, itemId).slice(0, 30);
    } catch (e) {
      return toError(e);
    }
  }

  async getShopping(menuId: string): Promise<ShoppingView> {
    const stored = await this.stored(menuId);
    const list = computeShopping(stored.menu, await this.catalog(), await this.listPantry(), await this.priceProfile(), stored.shopping_state);
    const transferred = new Set(stored.transferred_lines);
    return { ...list, lines: list.lines.map((l) => ({ ...l, transferred: transferred.has(l.id) })), state: stored.shopping_state, shopping_revision: stored.shopping_revision };
  }

  async patchShopping(menuId: string, patch: Partial<ShoppingView['state']>, expectedRevision: number | null): Promise<ShoppingView> {
    const stored = await this.stored(menuId);
    if (expectedRevision !== null && expectedRevision !== stored.shopping_revision) {
      throw new ApiError('revision_conflict', 'Список покупок изменился в другой вкладке. Обновите страницу.', 409);
    }
    const state = { ...emptyShoppingState(), ...stored.shopping_state };
    if (patch.marks) {
      for (const [id, mark] of Object.entries(patch.marks)) {
        if (mark === null) delete state.marks[id];
        else state.marks[id] = mark;
      }
    }
    if (patch.manual_lines) state.manual_lines = patch.manual_lines.map((l) => ({ ...l, name: l.name.trim().slice(0, 120) })).filter((l) => l.name);
    if (patch.seen) state.seen = patch.seen;
    const db = await this.db();
    await db.put('menus', { ...stored, shopping_state: state, shopping_revision: stored.shopping_revision + 1 });
    return this.getShopping(menuId);
  }

  async transferPurchases(menuId: string, lineIds: string[]): Promise<{ added: string[]; skipped: string[] }> {
    const shopping = await this.getShopping(menuId);
    const db = await this.db();
    // One read-write transaction: the transferred-lines marker and pantry rows commit together.
    const tx = db.transaction(['menus', 'pantry'], 'readwrite');
    const stored = (await tx.objectStore('menus').get(menuId)) as StoredMenu;
    const done = new Set(stored.transferred_lines);
    const added: string[] = [];
    const skipped: string[] = [];
    for (const id of lineIds) {
      const line = shopping.lines.find((l) => l.id === id);
      if (!line || done.has(id) || !line.convertible || line.to_buy <= 0) {
        skipped.push(id);
        continue;
      }
      await tx.objectStore('pantry').put({ id: newId('p'), product_id: line.product_id, qty: line.to_buy, unit: line.unit as PantryRecord['unit'], location: 'Куплено', expires: null, created_at: new Date().toISOString() });
      done.add(id);
      added.push(id);
    }
    await tx.objectStore('menus').put({ ...stored, transferred_lines: [...done] });
    await tx.done;
    return { added, skipped };
  }

  async cook(menuId: string, batchId: string): Promise<{ created: boolean }> {
    const catalog = await this.catalog();
    const db = await this.db();
    const tx = db.transaction(['menus', 'pantry'], 'readwrite');
    const stored = (await tx.objectStore('menus').get(menuId)) as StoredMenu | undefined;
    if (!stored) throw new ApiError('not_found', 'Меню не найдено.', 404);
    if (stored.cooked_batches.includes(batchId)) {
      await tx.done;
      return { created: false };
    }
    const pantryRows = await tx.objectStore('pantry').getAll();
    const { pantry } = pantryAfterCooking(stored.menu, catalog, pantryRows, batchId);
    const keep = new Map(pantry.map((p) => [p.id, p]));
    for (const row of pantryRows) {
      const next = keep.get(row.id);
      if (!next) await tx.objectStore('pantry').delete(row.id);
      else if (next.qty !== row.qty || next.unit !== row.unit) await tx.objectStore('pantry').put({ ...row, qty: next.qty, unit: next.unit as PantryRecord['unit'] });
    }
    await tx.objectStore('menus').put({ ...stored, cooked_batches: [...stored.cooked_batches, batchId] });
    await tx.done;
    return { created: true };
  }

  async getReport(menuId: string) {
    const stored = await this.stored(menuId);
    return menuReport(stored.menu, await this.catalog(), await this.members());
  }

  async listPantry(): Promise<PantryRecord[]> {
    const db = await this.db();
    const rows = await db.getAll('pantry');
    return rows
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map(({ created_at: _created, ...rest }) => rest);
  }

  async addPantry(item: Omit<PantryRecord, 'id'>): Promise<PantryRecord> {
    if (!(item.qty > 0)) throw new ApiError('validation_error', 'Количество — положительное число.', 400);
    const db = await this.db();
    const row = { ...item, id: newId('p'), created_at: new Date().toISOString() };
    await db.put('pantry', row);
    return { ...item, id: row.id };
  }

  async updatePantry(id: string, patch: Partial<PantryRecord>): Promise<PantryRecord> {
    const db = await this.db();
    const row = await db.get('pantry', id);
    if (!row) throw new ApiError('not_found', 'Запись не найдена.', 404);
    const next = { ...row, ...patch, id };
    if (!(next.qty > 0)) throw new ApiError('validation_error', 'Количество — положительное число.', 400);
    await db.put('pantry', next);
    const { created_at: _c, ...rest } = next;
    return rest;
  }

  async deletePantry(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('pantry', id);
  }

  async listPrices(): Promise<{ own: OwnPrice[]; profile: PriceProfile }> {
    const db = await this.db();
    return { own: await db.getAll('prices'), profile: await this.priceProfile() };
  }

  async addPrices(entries: NewPrice[]): Promise<{ shared: number }> {
    const db = await this.db();
    const h = await this.householdRow();
    for (const e of entries) {
      if (!(Number.isInteger(e.price_kop) && e.price_kop > 0 && e.package_size > 0)) throw new ApiError('validation_error', 'Цена и размер упаковки должны быть положительными.', 400);
      await db.put('prices', {
        id: newId('price'),
        product_id: e.product_id,
        price_kop: e.price_kop,
        package_size: e.package_size,
        package_unit: e.package_unit,
        loose: Boolean(e.loose),
        currency: 'RUB',
        date: e.date ?? localDate(deviceTimeZone()),
        source: e.source ?? 'вручную',
        kind: e.kind ?? 'manual',
        chain_id: e.chain_id ?? h.store_chain_id,
      });
    }
    return { shared: 0 };
  }

  async deletePrice(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('prices', id);
  }

  async listFavorites(): Promise<string[]> {
    const db = await this.db();
    return ((await db.get('kv', 'favorites')) as string[] | undefined) ?? [];
  }

  async setFavorite(recipeId: string, on: boolean): Promise<string[]> {
    const db = await this.db();
    const current = new Set(await this.listFavorites());
    if (on) current.add(recipeId);
    else current.delete(recipeId);
    const list = [...current];
    await db.put('kv', list, 'favorites');
    return list;
  }

  async listCustomRecipes(): Promise<Recipe[]> {
    const db = await this.db();
    return db.getAll('recipes');
  }

  async saveCustomRecipe(recipe: Recipe): Promise<Recipe> {
    const errors = customRecipeErrors(recipe, this.baseCatalog());
    if (errors.length > 0) throw new ApiError('validation_error', errors.join(' '), 400);
    const db = await this.db();
    const existing = recipe.id ? await db.get('recipes', recipe.id) : undefined;
    const saved: Recipe = { ...recipe, id: existing?.id ?? (recipe.id?.startsWith('u-') ? recipe.id : newId('u')), version: (existing?.version ?? 0) + 1, visibility: 'private', source: 'user' };
    await db.put('recipes', saved);
    return saved;
  }

  async deleteCustomRecipe(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('recipes', id);
  }

  async water(memberId: string, days = 14): Promise<WaterView> {
    const db = await this.db();
    const member = await db.get('members', memberId);
    if (!member) throw new ApiError('not_found', 'Участник не найден.', 404);
    const today = localDate(member.timezone ?? DEFAULT_TIMEZONE);
    const since = addDaysIso(today, -(days - 1));
    const entries = (await db.getAllFromIndex('water', 'by_member', memberId)).filter((e) => e.local_date >= since);
    const totals: Record<string, number> = {};
    for (const e of entries) totals[e.local_date] = (totals[e.local_date] ?? 0) + e.amount_ml;
    return { member_id: memberId, today, goal_ml: member.water_goal_ml ?? null, totals, entries: entries.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  }

  async addWater(memberId: string, amountMl: number): Promise<void> {
    const db = await this.db();
    const member = await db.get('members', memberId);
    if (!member) throw new ApiError('not_found', 'Участник не найден.', 404);
    if (!(Number.isInteger(amountMl) && amountMl >= 1 && amountMl <= 5000)) throw new ApiError('validation_error', 'Объём — от 1 до 5000 мл.', 400);
    await db.put('water', { id: newId('w'), member_id: memberId, amount_ml: amountMl, local_date: localDate(member.timezone ?? DEFAULT_TIMEZONE), created_at: new Date().toISOString() });
  }

  async deleteWater(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('water', id);
  }

  async habits(): Promise<HabitView[]> {
    const db = await this.db();
    return (await db.getAll('habits')).filter((h) => !h.archived);
  }

  async addHabit(memberId: string, name: string): Promise<HabitView> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new ApiError('validation_error', 'Название привычки — от 1 до 80 символов.', 400);
    const habit: HabitView = { id: newId('h'), member_id: memberId, name: trimmed, archived: false, marks: [] };
    const db = await this.db();
    await db.put('habits', habit);
    return habit;
  }

  async deleteHabit(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('habits', id);
  }

  async markHabit(id: string, localDateValue: string, done: boolean): Promise<HabitView> {
    const db = await this.db();
    const habit = await db.get('habits', id);
    if (!habit) throw new ApiError('not_found', 'Привычка не найдена.', 404);
    const marks = new Set(habit.marks);
    if (done) marks.add(localDateValue);
    else marks.delete(localDateValue);
    const next = { ...habit, marks: [...marks].sort() };
    await db.put('habits', next);
    return next;
  }
}

function validateMember(m: Member): void {
  if (!m.name.trim() || m.name.length > 60) throw new ApiError('validation_error', 'Имя или псевдоним — от 1 до 60 символов.', 400);
  if (!(m.portion_factor >= 0.25 && m.portion_factor <= 3)) throw new ApiError('validation_error', 'Простая порция — от 0,25 до 3.', 400);
  // Same ranges as the server model; NaN (text that is not a number) fails them too.
  for (const key of Object.keys(MEMBER_LIMITS) as MemberLimitKey[]) {
    const error = rangeError(key, m[key]);
    if (error) throw new ApiError('validation_error', error, 400);
  }
  if (m.portion_mode === 'target' && m.age !== null && m.age < 18 && m.goal === 'lose') {
    throw new ApiError('validation_error', 'Для несовершеннолетних цель «снижение веса» не рассчитывается автоматически. Используйте простые порции.', 400);
  }
  const tol = m.spice_tolerance;
  if (tol !== undefined && !(Number.isInteger(tol) && tol >= 0 && tol <= 2)) throw new ApiError('validation_error', 'Острота — от 0 до 2.', 400);
  const types = m.diet_types;
  if (types !== undefined && !(Array.isArray(types) && types.length <= 10 && types.every((t) => typeof t === 'string'))) {
    throw new ApiError('validation_error', 'Типы питания — не больше 10.', 400);
  }
}
