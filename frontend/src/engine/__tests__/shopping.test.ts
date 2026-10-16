import { describe, expect, it } from 'vitest';
import { generateMenu } from '../generator';
import { applyMenuOp } from '../menuOps';
import { computeShopping, emptyShoppingState, pantryAfterCooking } from '../shopping';
import type { Catalog, PriceProfile } from '../types';
import { catalog, member, miniCatalog, product, recipe, request, settings } from './helpers';

function potatoCatalog(): Catalog {
  return miniCatalog(
    [
      recipe({ id: 'mash', servings: 2, ingredients: [{ product: 'potato', qty: 800, unit: 'g' }, { product: 'salt', qty: 1, unit: 'tsp' }] }),
      recipe({ id: 'stew', servings: 2, ingredients: [{ product: 'potato', qty: 400, unit: 'g' }] }),
    ],
    [
      product({ id: 'potato', piece_g: 150, package: { size: 1000, unit: 'g' } }),
      product({ id: 'salt', category: 'spices', department: 'Масла и специи', spoon_g: { tsp: 6 } }),
    ],
  );
}

function menuWith(cat: Catalog, recipeIds: string[], days = recipeIds.length, slots = ['lunch']) {
  const pins = recipeIds.map((id, d) => ({ date: `2026-10-${String(19 + d).padStart(2, '0')}`, slot: 'lunch', recipe_id: id, method_id: 'stove', portions: { m1: 1, m2: 1 } }));
  const members = [member(), member({ id: 'm2', name: 'Борис' })];
  return generateMenu(
    request({ members, days, slots, pins, settings: settings({ repeat: { ...settings().repeat, mode: 'allow', max_uses: 5, min_gap_days: 0 } }) }),
    cat,
  ).menu;
}

describe('pantry and shopping', () => {
  it('800 g needed − 300 g at home = 500 g to buy; expired stock is not used (check 7)', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['mash']);
    const fresh = computeShopping(menu, cat, [{ id: 'p1', product_id: 'potato', qty: 300, unit: 'g', location: 'Кладовая', expires: '2026-10-25' }], null, emptyShoppingState());
    const line = fresh.lines.find((l) => l.product_id === 'potato')!;
    expect(line.needed).toBe(800);
    expect(line.from_pantry).toBe(300);
    expect(line.to_buy).toBe(500);
    expect(line.package).toEqual({ size: 1000, unit: 'g', count: 1 });

    const expired = computeShopping(menu, cat, [{ id: 'p1', product_id: 'potato', qty: 300, unit: 'g', location: null, expires: '2026-10-18' }], null, emptyShoppingState());
    const line2 = expired.lines.find((l) => l.product_id === 'potato')!;
    expect(line2.to_buy).toBe(800);
    expect(expired.expired_skipped).toEqual([{ pantry_id: 'p1', product_id: 'potato', expires: '2026-10-18', needed_on: '2026-10-19' }]);
  });

  it('allocates stock chronologically and never twice', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['mash', 'stew']);
    // 500 g at home: the first day's mash takes all of it, the stew on day 2 gets nothing.
    const list = computeShopping(menu, cat, [{ id: 'p1', product_id: 'potato', qty: 500, unit: 'g', location: null, expires: null }], null, emptyShoppingState());
    const line = list.lines.find((l) => l.product_id === 'potato')!;
    expect(line.needed).toBe(1200);
    expect(line.from_pantry).toBe(500);
    expect(line.to_buy).toBe(700);
    expect(list.allocations).toEqual([{ pantry_id: 'p1', batch_id: menu.batches[0]!.id, product_id: 'potato', qty: 500 }]);
    // A lot that expires between the two cook dates only covers the earlier one.
    const split = computeShopping(menu, cat, [
      { id: 'a', product_id: 'potato', qty: 1000, unit: 'g', location: null, expires: '2026-10-19' },
    ], null, emptyShoppingState());
    expect(split.lines.find((l) => l.product_id === 'potato')!.from_pantry).toBe(800);
  });

  it('separates usage cost from checkout cost and marks missing prices (check 11)', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['stew']);
    const prices: PriceProfile = { store_id: 'other', region: null, entries: [{ product_id: 'potato', price_kop: 9000, package_size: 1, package_unit: 'kg', currency: 'RUB', date: '2026-10-10', source: 'чек' }] };
    const list = computeShopping(menu, cat, [], prices, emptyShoppingState());
    const line = list.lines.find((l) => l.product_id === 'potato')!;
    expect(line.purchase_cost_kop).toBe(9000);
    expect(line.usage_cost_kop).toBe(3600);
    expect(list.totals.complete).toBe(true);

    const mash = menuWith(cat, ['mash']);
    const partial = computeShopping(mash, cat, [], prices, emptyShoppingState());
    expect(partial.totals.complete).toBe(false);
    expect(partial.totals.missing_prices).toEqual(['auto:salt:g']);
    expect(partial.lines.find((l) => l.product_id === 'salt')!.purchase_cost_kop).toBeNull();
  });

  it('two packages at 100 ₽ exceed a 150 ₽ limit even if usage is cheaper (check 25)', () => {
    const cat = miniCatalog(
      [recipe({ id: 'r', servings: 2, ingredients: [{ product: 'cheese', qty: 120, unit: 'g' }] })],
      [product({ id: 'cheese', category: 'cheese', department: 'Молочные продукты и яйца' })],
    );
    const prices: PriceProfile = { store_id: 'pyaterochka', region: null, entries: [{ product_id: 'cheese', price_kop: 10000, package_size: 100, package_unit: 'g', currency: 'RUB', date: '2026-10-10', source: 'вручную' }] };
    const req = request({
      members: [member()],
      days: 1,
      slots: ['lunch'],
      prices,
      pins: [{ date: '2026-10-19', slot: 'lunch', recipe_id: 'r', method_id: 'stove', portions: { m1: 2 } }],
      settings: settings({ budget: { limit_kop: 15000, currency: 'RUB' } }),
    });
    const { menu } = generateMenu(req, cat);
    const list = computeShopping(menu, cat, [], prices, emptyShoppingState());
    const line = list.lines[0]!;
    expect(line.package!.count).toBe(2);
    expect(line.usage_cost_kop).toBe(12000);
    expect(list.budget.purchase_kop).toBe(20000);
    expect(list.budget.status).toBe('exceeded');
    expect(menu.stats.budget_status).toBe('exceeded');
    expect(menu.conflicts.map((c) => c.code)).toContain('budget_exceeded');
  });

  it('unknown prices keep the budget unconfirmed; a store/price change recalculates (check 24)', () => {
    const cat = potatoCatalog();
    const base = menuWith(cat, ['mash']);
    const menu = { ...base, settings: { ...base.settings, budget: { limit_kop: 100000, currency: 'RUB' } } };
    const shopA: PriceProfile = { store_id: 'magnit', region: 'Казань', entries: [{ product_id: 'potato', price_kop: 5000, package_size: 1000, package_unit: 'g', currency: 'RUB', date: '2026-10-01', source: 'вручную' }] };
    expect(computeShopping(menu, cat, [], shopA, emptyShoppingState()).budget.status).toBe('unconfirmed');
    const withSalt: PriceProfile = { ...shopA, entries: [...shopA.entries, { product_id: 'salt', price_kop: 2500, package_size: 1000, package_unit: 'g', currency: 'RUB', date: '2026-10-01', source: 'вручную' }] };
    const a = computeShopping(menu, cat, [], withSalt, emptyShoppingState());
    expect(a.budget.status).toBe('ok');
    expect(a.budget.purchase_kop).toBe(7500);
    const shopB: PriceProfile = { store_id: 'lenta', region: 'Казань', entries: withSalt.entries.map((e) => ({ ...e, price_kop: e.price_kop * 2 })) };
    const b = computeShopping(menu, cat, [], shopB, emptyShoppingState());
    expect(b.budget.purchase_kop).toBe(15000);
    expect(computeShopping(menu, cat, [], null, emptyShoppingState()).budget.status).toBe('unconfirmed');
  });

  it('replacing a dish recalculates the list and keeps manual lines and marks (check 6)', () => {
    const cat = catalog();
    const req = request({ days: 3 });
    const { menu } = generateMenu(req, cat);
    const state = emptyShoppingState();
    state.manual_lines.push({ id: 'manual:1', name: 'Салфетки', qty: 1, unit: 'pcs', department: 'Другое', price_kop: null });
    const before = computeShopping(menu, cat, [], null, state);
    state.marks[before.lines[0]!.id] = { purchased: true };
    for (const l of before.lines) state.seen[l.id] = l.to_buy;
    const dinner = menu.meals.find((m) => m.slot === 'dinner')!;
    const next = applyMenuOp(menu, { op: 'replace', item_id: dinner.items[0]!.id, recipe_id: null }, { catalog: cat, members: req.members });
    expect(next.revision).toBe(menu.revision + 1);
    const after = computeShopping(next, cat, [], null, state);
    expect(after.manual_lines.map((m) => m.name)).toEqual(['Салфетки']);
    expect(after.lines.map((l) => [l.id, l.needed])).not.toEqual(before.lines.map((l) => [l.id, l.needed]));
    expect(after.lines.some((l) => l.changed) || after.lines.some((l) => l.previous_to_buy === null)).toBe(true);
    const kept = after.lines.find((l) => l.id === before.lines[0]!.id);
    if (kept) expect(kept.purchased).toBe(true);
  });

  it('cooking confirmation deducts only the batch needs from usable stock', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['mash', 'stew']);
    const pantry = [{ id: 'p1', product_id: 'potato', qty: 1, unit: 'pcs' as const, location: null, expires: null }, { id: 'p2', product_id: 'potato', qty: 900, unit: 'g' as const, location: null, expires: null }];
    const after = pantryAfterCooking(menu, cat, pantry, menu.batches[0]!.id);
    const total = after.pantry.reduce((s, p) => s + (p.unit === 'pcs' ? p.qty * 150 : p.qty), 0);
    expect(total).toBe(250);
  });

  it('water is not purchasable and a product without density stays in its own unit', () => {
    const cat = catalog();
    const pins = [{ date: '2026-10-19', slot: 'lunch', recipe_id: 'borshch-s-govyadinoy', method_id: 'stove', portions: { m1: 1 } }];
    const { menu } = generateMenu(request({ members: [member()], days: 1, slots: ['lunch'], pins }), cat);
    const list = computeShopping(menu, cat, [], null, emptyShoppingState());
    expect(list.lines.find((l) => l.product_id === 'water')).toBeUndefined();
    const oil = list.lines.find((l) => l.product_id === 'sunflower_oil')!;
    expect(oil.unit).toBe('ml');
    expect(oil.convertible).toBe(true);
  });
});

describe('price sources', () => {
  it('loose regional averages are costed by exact weight and marked as an estimate', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['stew']);
    const prices: PriceProfile = {
      store_id: 'none',
      city_id: 'kazan',
      region: 'Татарстан',
      entries: [{ product_id: 'potato', price_kop: 4500, package_size: 1, package_unit: 'kg', currency: 'RUB', date: '2026-09-30', source: 'Росстат', kind: 'rosstat', loose: true }],
    };
    const list = computeShopping({ ...menu, settings: { ...menu.settings, budget: { limit_kop: 5000, currency: 'RUB' } } }, cat, [], prices, emptyShoppingState());
    const line = list.lines[0]!;
    expect(line.package).toBeNull();
    expect(line.purchase_cost_kop).toBe(1800);
    expect(line.estimated).toBe(true);
    expect(list.budget.status).toBe('ok');
    expect(list.budget.estimated).toBe(true);
  });

  it('the user’s own newer receipt wins over an older price', () => {
    const cat = potatoCatalog();
    const menu = menuWith(cat, ['stew']);
    const prices: PriceProfile = {
      store_id: 'magnit',
      region: null,
      entries: [
        { product_id: 'potato', price_kop: 4500, package_size: 1, package_unit: 'kg', currency: 'RUB', date: '2026-09-30', source: 'Росстат', kind: 'rosstat', loose: true },
        { product_id: 'potato', price_kop: 7990, package_size: 2, package_unit: 'kg', currency: 'RUB', date: '2026-10-12', source: 'чек', kind: 'receipt' },
      ],
    };
    const line = computeShopping(menu, cat, [], prices, emptyShoppingState()).lines[0]!;
    expect(line.price_kind).toBe('receipt');
    expect(line.estimated).toBe(false);
    expect(line.purchase_cost_kop).toBe(7990);
  });
});
