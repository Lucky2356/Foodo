import { cleanQty, compareStr, roundKop } from './basics';
import { ESTIMATED_PRICE_KINDS } from './types';
import type {
  BudgetStatus,
  Catalog,
  Menu,
  PantryItem,
  PriceEntry,
  PriceProfile,
  Product,
  Recipe,
} from './types';
import { toBase } from './units';
import { snapshotCatalog } from './catalog';

// Shopping rules (docs/ARCHITECTURE.md, «Покупки»):
// - raw ingredients are needed once per cooking batch (a batch may feed several meals);
// - pantry lots are allocated chronologically by cook date, only if not expired on that date,
//   and each lot is consumed at most once;
// - the list never deducts anything physically — it only reserves (plans) pantry use;
// - packages are rounded per product; checkout cost (packages) and usage cost are separate;
// - unknown prices make totals incomplete and the budget unconfirmed.

export interface ManualLine {
  id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  department: string;
  price_kop: number | null;
}

export interface ShoppingMark {
  purchased?: boolean;
  at_home?: boolean;
}

export interface ShoppingState {
  manual_lines: ManualLine[];
  marks: Record<string, ShoppingMark>;
  seen: Record<string, number>;
}

export function emptyShoppingState(): ShoppingState {
  return { manual_lines: [], marks: {}, seen: {} };
}

export interface LineSource {
  batch_id: string;
  recipe_id: string;
  recipe_name: string;
  cook_date: string;
  qty: number;
}

export interface ShoppingLine {
  id: string;
  product_id: string;
  name: string;
  department: string;
  unit: string;
  convertible: boolean;
  needed: number;
  from_pantry: number;
  to_buy: number;
  /** What is actually bought, in base units: whole packages when the product is sold in them. */
  buy_qty: number;
  package: { size: number; unit: string; count: number } | null;
  package_note: string | null;
  price_kop: number | null;
  /** What price_kop is paid for: a package, or a weight for loose goods (e.g. 1 kg). */
  price_per: { size: number; unit: string; loose: boolean } | null;
  price_date: string | null;
  price_source: string | null;
  price_kind: string | null;
  estimated: boolean;
  purchase_cost_kop: number | null;
  usage_cost_kop: number | null;
  sources: LineSource[];
  purchased: boolean;
  at_home: boolean;
  previous_to_buy: number | null;
  changed: boolean;
}

export interface PantryAllocation {
  pantry_id: string;
  batch_id: string;
  product_id: string;
  qty: number;
}

export interface ExpiredSkip {
  pantry_id: string;
  product_id: string;
  expires: string;
  needed_on: string;
}

export interface ShoppingList {
  lines: ShoppingLine[];
  manual_lines: (ManualLine & { purchased: boolean; at_home: boolean })[];
  totals: { purchase_kop: number; usage_kop: number; complete: boolean; estimated: boolean; missing_prices: string[] };
  budget: { limit_kop: number | null; purchase_kop: number; diff_kop: number | null; status: BudgetStatus; estimated: boolean };
  allocations: PantryAllocation[];
  expired_skipped: ExpiredSkip[];
}

interface Need {
  key: string;
  product: Product;
  unit: string;
  convertible: boolean;
  qty: number;
  batch_id: string;
  recipe: Recipe;
  cook_date: string;
}

export function latestPrice(prices: PriceProfile | null | undefined, productId: string): PriceEntry | null {
  if (!prices) return null;
  let best: PriceEntry | null = null;
  for (const e of prices.entries) {
    if (e.product_id !== productId) continue;
    if (best === null || e.date >= best.date) best = e;
  }
  return best;
}

/** Price in kopecks per base unit (g, ml or pcs) of a product, or null if unknown/incompatible. */
export function unitPriceKop(prices: PriceProfile | null | undefined, product: Product): number | null {
  const entry = latestPrice(prices, product.id);
  if (!entry) return null;
  const size = toBase(product, entry.package_size, entry.package_unit);
  if (size === null || size <= 0) return null;
  return entry.price_kop / size;
}

/** Raw ingredient needs of a menu, one entry per batch ingredient, in chronological batch order. */
export function batchNeeds(menu: Menu, catalog: Catalog, onlyBatchId: string | null = null): Need[] {
  const order = menu.batches.map((b, index) => ({ b, index }));
  order.sort((x, y) => compareStr(x.b.cook_date, y.b.cook_date) || x.index - y.index);
  const needs: Need[] = [];
  for (const { b } of order) {
    if (onlyBatchId !== null && b.id !== onlyBatchId) continue;
    const recipe = catalog.recipes[b.recipe_id];
    if (!recipe || b.portions <= 0) continue;
    const scale = b.portions / recipe.servings;
    for (const ing of recipe.ingredients) {
      const product = catalog.products[ing.product];
      if (!product || product.purchasable === false) continue;
      const base = toBase(product, ing.qty * scale, ing.unit);
      if (base !== null) {
        needs.push({ key: `${product.id}:${product.base_unit}`, product, unit: product.base_unit, convertible: true, qty: base, batch_id: b.id, recipe, cook_date: b.cook_date });
      } else {
        needs.push({ key: `${product.id}:${ing.unit}`, product, unit: ing.unit, convertible: false, qty: ing.qty * scale, batch_id: b.id, recipe, cook_date: b.cook_date });
      }
    }
  }
  return needs;
}

interface Lot {
  item: PantryItem;
  remaining: number;
}

/**
 * Pantry lots per product, converted to base units, sorted by expiry (unknown expiry last), then id.
 * `reserved` (base units per product) is taken off the end of each product's lots first: purchases
 * of this very menu moved to the pantry are not counted as «already at home» for its own list.
 */
function pantryLots(catalog: Catalog, pantry: PantryItem[], reserved: Record<string, number> = {}): Map<string, Lot[]> {
  const lots = new Map<string, Lot[]>();
  for (const item of pantry) {
    const product = catalog.products[item.product_id];
    if (!product || item.qty <= 0) continue;
    const qty = toBase(product, item.qty, item.unit);
    if (qty === null) continue;
    const list = lots.get(item.product_id) ?? [];
    list.push({ item, remaining: qty });
    lots.set(item.product_id, list);
  }
  for (const list of lots.values()) {
    list.sort((a, b) => {
      const ea = a.item.expires;
      const eb = b.item.expires;
      if (ea !== eb) {
        if (ea === null) return 1;
        if (eb === null) return -1;
        return compareStr(ea, eb);
      }
      return compareStr(a.item.id, b.item.id);
    });
  }
  for (const [productId, qty] of Object.entries(reserved)) {
    let left = qty;
    const list = lots.get(productId) ?? [];
    for (let i = list.length - 1; i >= 0 && left > 1e-9; i -= 1) {
      const lot = list[i] as Lot;
      const take = Math.min(lot.remaining, left);
      lot.remaining -= take;
      left -= take;
    }
  }
  return lots;
}

/** Plans pantry use for needs in order. Returns per-need covered amounts and the allocations. */
export function allocatePantry(
  catalog: Catalog,
  needs: Need[],
  pantry: PantryItem[],
  reserved: Record<string, number> = {},
): { covered: number[]; allocations: PantryAllocation[]; expired: ExpiredSkip[] } {
  const lots = pantryLots(catalog, pantry, reserved);
  const covered: number[] = [];
  const allocations: PantryAllocation[] = [];
  const expired: ExpiredSkip[] = [];
  const expiredSeen = new Set<string>();
  for (const need of needs) {
    let remaining = need.qty;
    let got = 0;
    if (need.convertible) {
      for (const lot of lots.get(need.product.id) ?? []) {
        if (remaining <= 1e-9) break;
        if (lot.remaining <= 1e-9) continue;
        if (lot.item.expires !== null && lot.item.expires < need.cook_date) {
          if (!expiredSeen.has(lot.item.id)) {
            expiredSeen.add(lot.item.id);
            expired.push({ pantry_id: lot.item.id, product_id: need.product.id, expires: lot.item.expires, needed_on: need.cook_date });
          }
          continue;
        }
        const take = Math.min(lot.remaining, remaining);
        lot.remaining -= take;
        remaining -= take;
        got += take;
        allocations.push({ pantry_id: lot.item.id, batch_id: need.batch_id, product_id: need.product.id, qty: cleanQty(take) });
      }
    }
    covered.push(got);
  }
  return { covered, allocations, expired };
}

function departmentIndex(catalog: Catalog, department: string): number {
  const i = catalog.reference.departments.indexOf(department);
  return i < 0 ? catalog.reference.departments.length : i;
}

export function computeShopping(
  menu: Menu,
  baseCatalog: Catalog,
  pantry: PantryItem[],
  prices: PriceProfile | null,
  state: ShoppingState,
  /** The household's current budget; the menu's saved one is used only when it is not given. */
  budget?: { limit_kop: number | null },
  /** Base quantities per product bought for this menu and already moved to the pantry. */
  transferred: Record<string, number> = {},
): ShoppingList {
  // Saved menus are calculated from their own recipe snapshot, never from later catalog edits.
  const catalog = snapshotCatalog(menu, baseCatalog);
  const needs = batchNeeds(menu, catalog);
  const { covered, allocations, expired } = allocatePantry(catalog, needs, pantry, transferred);

  const byKey = new Map<string, ShoppingLine>();
  const keys: string[] = [];
  needs.forEach((need, index) => {
    let line = byKey.get(need.key);
    if (!line) {
      line = {
        id: `auto:${need.key}`,
        product_id: need.product.id,
        name: need.product.name,
        department: need.product.department,
        unit: need.unit,
        convertible: need.convertible,
        needed: 0,
        from_pantry: 0,
        to_buy: 0,
        buy_qty: 0,
        package: null,
        package_note: null,
        price_kop: null,
        price_per: null,
        price_date: null,
        price_source: null,
        price_kind: null,
        estimated: false,
        purchase_cost_kop: null,
        usage_cost_kop: null,
        sources: [],
        purchased: false,
        at_home: false,
        previous_to_buy: null,
        changed: false,
      };
      byKey.set(need.key, line);
      keys.push(need.key);
    }
    line.needed += need.qty;
    line.from_pantry += covered[index] ?? 0;
    line.sources.push({ batch_id: need.batch_id, recipe_id: need.recipe.id, recipe_name: need.recipe.name, cook_date: need.cook_date, qty: cleanQty(need.qty) });
  });

  const missing: string[] = [];
  let estimated = false;
  let purchaseKop = 0;
  let usageKop = 0;
  const lines: ShoppingLine[] = [];
  for (const key of keys) {
    const line = byKey.get(key) as ShoppingLine;
    const product = catalog.products[line.product_id] as Product;
    line.needed = cleanQty(line.needed);
    line.from_pantry = cleanQty(line.from_pantry);
    line.to_buy = cleanQty(Math.max(0, line.needed - line.from_pantry));
    const mark = state.marks[line.id] ?? {};
    line.purchased = Boolean(mark.purchased);
    line.at_home = Boolean(mark.at_home);
    const seen = state.seen[line.id];
    line.previous_to_buy = seen === undefined ? null : seen;
    line.changed = seen !== undefined && Math.abs(seen - line.to_buy) > 1e-6;
    const effective = line.at_home ? 0 : line.to_buy;
    line.buy_qty = effective;

    const entry = latestPrice(prices, product.id);
    const pkg = entry ? { size: entry.package_size, unit: entry.package_unit } : (product.package ?? null);
    if (line.convertible && pkg) {
      const sizeBase = toBase(product, pkg.size, pkg.unit);
      if (sizeBase !== null && sizeBase > 0) {
        // A price per kilogram (Rosstat averages) still buys the product in its usual package when it
        // has one (pasta, flour); only a product without a package is bought by weight.
        const loose = Boolean(entry?.loose);
        const own = loose && product.package ? product.package : null;
        const ownBase = own ? toBase(product, own.size, own.unit) : null;
        const buyPkg = loose ? (own && ownBase !== null && ownBase > 0 ? { ...own, base: ownBase } : null) : { ...pkg, base: sizeBase };
        const count = buyPkg && effective > 0 ? Math.ceil(effective / buyPkg.base - 1e-9) : 0;
        line.package = buyPkg ? { size: buyPkg.size, unit: buyPkg.unit, count } : null;
        if (buyPkg) line.buy_qty = cleanQty(count * buyPkg.base);
        if (entry) {
          line.price_kop = entry.price_kop;
          line.price_per = { size: entry.package_size, unit: entry.package_unit, loose };
          line.price_date = entry.date;
          line.price_source = entry.source;
          line.price_kind = entry.kind ?? 'manual';
          line.estimated = ESTIMATED_PRICE_KINDS.includes(entry.kind ?? 'manual');
          if (!loose) line.purchase_cost_kop = count * entry.price_kop;
          else if (buyPkg) line.purchase_cost_kop = roundKop((count * buyPkg.base * entry.price_kop) / sizeBase);
          else line.purchase_cost_kop = roundKop((effective * entry.price_kop) / sizeBase);
          line.usage_cost_kop = roundKop((line.needed * entry.price_kop) / sizeBase);
        }
      } else {
        line.package_note = 'Нет коэффициента для перевода упаковки в единицы рецепта';
      }
    } else if (!line.convertible) {
      line.package_note = 'Количество не переведено: для продукта нет нужного коэффициента';
    }
    if (line.purchase_cost_kop !== null) purchaseKop += line.purchase_cost_kop;
    if (line.estimated && effective > 0) estimated = true;
    if (line.usage_cost_kop !== null) usageKop += line.usage_cost_kop;
    if (effective > 0 && line.purchase_cost_kop === null) missing.push(line.id);
    lines.push(line);
  }

  const manual = state.manual_lines.map((m) => {
    const mark = state.marks[m.id] ?? {};
    return { ...m, purchased: Boolean(mark.purchased), at_home: Boolean(mark.at_home) };
  });
  for (const m of manual) {
    if (m.at_home) continue;
    if (m.price_kop === null) missing.push(m.id);
    else purchaseKop += m.price_kop;
  }

  lines.sort(
    (a, b) =>
      departmentIndex(catalog, a.department) - departmentIndex(catalog, b.department) ||
      compareStr(a.name, b.name) ||
      compareStr(a.id, b.id),
  );

  const limit = budget ? budget.limit_kop : menu.settings.budget.limit_kop;
  let status: BudgetStatus = 'none';
  if (limit !== null) {
    // Known prices alone already over the limit is an overrun, whatever the missing prices add.
    if (purchaseKop > limit) status = 'exceeded';
    else status = missing.length > 0 ? 'unconfirmed' : 'ok';
  }
  return {
    lines,
    manual_lines: manual,
    totals: { purchase_kop: purchaseKop, usage_kop: usageKop, complete: missing.length === 0, estimated, missing_prices: missing },
    budget: { limit_kop: limit, purchase_kop: purchaseKop, diff_kop: limit === null ? null : limit - purchaseKop, status, estimated },
    allocations,
    expired_skipped: expired,
  };
}

/**
 * Pantry after confirming that a batch was cooked: the batch's raw needs are deducted from lots
 * usable on its cook date. The caller is responsible for idempotency (a batch is confirmed once).
 */
export function pantryAfterCooking(menu: Menu, baseCatalog: Catalog, pantry: PantryItem[], batchId: string): {
  pantry: PantryItem[];
  allocations: PantryAllocation[];
} {
  const catalog = snapshotCatalog(menu, baseCatalog);
  const needs = batchNeeds(menu, catalog, batchId);
  const { allocations } = allocatePantry(catalog, needs, pantry);
  const used = new Map<string, number>();
  for (const a of allocations) used.set(a.pantry_id, (used.get(a.pantry_id) ?? 0) + a.qty);
  const next: PantryItem[] = [];
  for (const item of pantry) {
    const take = used.get(item.id);
    if (take === undefined) {
      next.push(item);
      continue;
    }
    const product = catalog.products[item.product_id];
    const base = product ? toBase(product, item.qty, item.unit) : null;
    if (base === null || !product) {
      next.push(item);
      continue;
    }
    const left = cleanQty(base - take);
    if (left > 1e-6) next.push({ ...item, qty: left, unit: product.base_unit });
  }
  return { pantry: next, allocations };
}
