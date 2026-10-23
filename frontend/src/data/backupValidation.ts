import { isIsoDate, toBase } from '../engine';
import type { Catalog, Member, Recipe } from '../engine';
import { MEMBER_LIMITS, rangeError } from '../lib/numbers';
import type { MemberLimitKey } from '../lib/numbers';
import { customRecipeErrors } from '../lib/recipeValidation';
import type { GuestExport } from './backup';

// Record-level checks of a backup file (CLAUDE.md §7: an import validates structure, links and
// units and reports errors). Everything is checked before anything is written, so a broken file
// never leaves the device half-restored.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isDateOrNull = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && isIsoDate(v));

function memberProblem(m: unknown): string | null {
  if (!isObj(m) || !isStr(m.id, 80)) return 'нет идентификатора';
  if (!isStr(m.name, 60)) return 'имя — от 1 до 60 символов';
  if (m.portion_mode !== 'simple' && m.portion_mode !== 'target') return 'неизвестный режим порций';
  if (!isNum(m.portion_factor, 0.25, 3)) return 'простая порция — от 0,25 до 3';
  const r = m.restrictions;
  if (!isObj(r) || !['products', 'categories', 'allergens'].every((k) => Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x === 'string'))) {
    return 'запреты повреждены';
  }
  if (!isObj(m.preferences)) return 'предпочтения повреждены';
  for (const key of Object.keys(MEMBER_LIMITS) as MemberLimitKey[]) {
    const v = m[key];
    if (v !== null && v !== undefined && typeof v !== 'number') return `${MEMBER_LIMITS[key].label.toLowerCase()} — не число`;
    const error = rangeError(key, v as number | null | undefined);
    if (error) return error;
  }
  return null;
}

function menuProblem(m: unknown): string | null {
  if (!isObj(m) || !isStr(m.id, 80)) return 'нет идентификатора';
  const menu = m.menu;
  if (!isObj(menu)) return 'нет данных меню';
  if (typeof menu.start_date !== 'string' || !isIsoDate(menu.start_date)) return 'неверная дата начала';
  if (!Number.isInteger(menu.days) || !isNum(menu.days, 1, 35)) return 'период — от 1 до 35 дней';
  if (!Number.isInteger(menu.revision) || !isNum(menu.revision, 0, 1e9)) return 'неверная версия меню';
  for (const key of ['meals', 'batches', 'slots', 'member_ids', 'unfilled', 'conflicts', 'warnings']) {
    if (!Array.isArray(menu[key])) return `раздел «${key}» повреждён`;
  }
  if (!isObj(menu.settings) || !isObj(menu.snapshot)) return 'настройки или снимок рецептов повреждены';
  const batches = new Set((menu.batches as unknown[]).map((b) => (isObj(b) ? b.id : null)));
  for (const meal of menu.meals as unknown[]) {
    if (!isObj(meal) || !Array.isArray(meal.items)) return 'приём пищи повреждён';
    for (const item of meal.items as unknown[]) {
      if (!isObj(item) || !isObj(item.portions) || !batches.has(item.batch_id)) return 'блюдо ссылается на несуществующую партию';
    }
  }
  return null;
}

function pantryProblem(p: unknown, catalog: Catalog): string | null {
  if (!isObj(p) || !isStr(p.id, 80)) return 'нет идентификатора';
  const product = typeof p.product_id === 'string' ? catalog.products[p.product_id] : undefined;
  if (!product) return `неизвестный продукт «${String(p.product_id)}»`;
  if (!isNum(p.qty, 0.000001, 1_000_000)) return 'количество — число больше нуля';
  if (p.unit !== product.base_unit) return `единица должна быть «${product.base_unit}»`;
  if (!isDateOrNull(p.expires)) return 'неверный срок годности';
  return null;
}

function priceProblem(p: unknown, catalog: Catalog): string | null {
  if (!isObj(p) || !isStr(p.id, 80)) return 'нет идентификатора';
  const product = typeof p.product_id === 'string' ? catalog.products[p.product_id] : undefined;
  if (!product) return `неизвестный продукт «${String(p.product_id)}»`;
  if (!Number.isInteger(p.price_kop) || !isNum(p.price_kop, 1, 10_000_000)) return 'цена — сумма в копейках больше нуля';
  if (!isNum(p.package_size, 0.000001, 100_000)) return 'размер упаковки — число больше нуля';
  if (!['g', 'kg', 'ml', 'l', 'pcs'].includes(p.package_unit as string)) return 'неизвестная единица упаковки';
  if (toBase(product, p.package_size, p.package_unit as 'g') === null) return 'единица упаковки не подходит продукту';
  if (typeof p.date !== 'string' || !isIsoDate(p.date)) return 'неверная дата цены';
  return null;
}

function waterProblem(w: unknown): string | null {
  if (!isObj(w) || !isStr(w.id, 80) || !isStr(w.member_id, 80)) return 'нет идентификатора';
  if (!Number.isInteger(w.amount_ml) || !isNum(w.amount_ml, 1, 10_000)) return 'объём — от 1 до 10 000 мл';
  if (typeof w.local_date !== 'string' || !isIsoDate(w.local_date)) return 'неверная дата';
  return null;
}

function habitProblem(h: unknown): string | null {
  if (!isObj(h) || !isStr(h.id, 80) || !isStr(h.member_id, 80)) return 'нет идентификатора';
  if (!isStr(h.name, 80)) return 'название — от 1 до 80 символов';
  if (!Array.isArray(h.marks) || !h.marks.every((d) => typeof d === 'string' && isIsoDate(d))) return 'отметки повреждены';
  return null;
}

/** Problems of a backup in Russian, «Раздел, запись N: что не так»; empty when the file is sound. */
export function backupProblems(data: GuestExport, catalog: Catalog): string[] {
  const out: string[] = [];
  const check = (section: string, list: unknown[], fn: (x: unknown) => string | null) => {
    list.forEach((x, i) => {
      const problem = fn(x);
      if (problem) out.push(`${section}, запись ${i + 1}: ${problem}`);
    });
  };
  check('Участники', data.members, memberProblem);
  check('Меню', data.menus, menuProblem);
  check('Остатки', data.pantry, (p) => pantryProblem(p, catalog));
  check('Цены', data.prices, (p) => priceProblem(p, catalog));
  check('Вода', data.water, waterProblem);
  check('Привычки', data.habits, habitProblem);
  if (!data.favorites.every((f) => typeof f === 'string')) out.push('Избранное: идентификаторы рецептов повреждены');
  const withOwn: Catalog = { ...catalog, recipes: { ...catalog.recipes } };
  for (const r of data.custom_recipes) if (isObj(r) && typeof r.id === 'string') withOwn.recipes[r.id] = r as unknown as Recipe;
  data.custom_recipes.forEach((r, i) => {
    if (!isObj(r) || !isStr(r.id, 80)) {
      out.push(`Свои рецепты, запись ${i + 1}: нет идентификатора`);
      return;
    }
    const errors = customRecipeErrors(r as unknown as Recipe, withOwn);
    if (errors.length > 0) out.push(`Свои рецепты, «${String(r.name ?? r.id)}»: ${errors[0]}`);
  });
  return out;
}

/** Ids of members in the file that are the same person as a member here (same name, any case). */
export function matchMembers(fileMembers: Member[], current: Member[]): Map<string, string> {
  const byName = new Map(current.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const out = new Map<string, string>();
  for (const m of fileMembers) {
    const same = byName.get(m.name.trim().toLowerCase());
    if (same && same !== m.id) out.set(m.id, same);
  }
  return out;
}
