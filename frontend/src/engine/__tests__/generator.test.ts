import { describe, expect, it } from 'vitest';
import { generateMenu, rankCandidates } from '../generator';
import { applyMenuOp } from '../menuOps';
import { productClosure } from '../catalog';
import { computeShopping, emptyShoppingState } from '../shopping';
import { menuReport } from '../report';
import { recipeNutrition } from '../nutrition';
import type { Catalog, Menu, Recipe } from '../types';
import { catalog, member, miniCatalog, product, recipe, request, settings } from './helpers';

function menuRecipes(menu: Menu, cat: Catalog): Recipe[] {
  return menu.batches.map((b) => cat.recipes[b.recipe_id]!);
}

function itemsFor(menu: Menu, memberId: string): { recipe_id: string; portion: number }[] {
  const batches = new Map(menu.batches.map((b) => [b.id, b]));
  const out: { recipe_id: string; portion: number }[] = [];
  for (const meal of menu.meals) for (const item of meal.items) {
    const p = item.portions[memberId];
    if (p !== undefined) out.push({ recipe_id: batches.get(item.batch_id)!.recipe_id, portion: p });
  }
  return out;
}

function containsProductOrCategory(cat: Catalog, r: Recipe, id: string): boolean {
  return r.ingredients.some((ing) => {
    const c = productClosure(cat, ing.product);
    return c.productIds.has(id) || c.categories.has(id);
  });
}

describe('generator: guest family scenario (check 1)', () => {
  it('builds a 7-day menu for two adults with all slots filled', () => {
    const cat = catalog();
    const { menu } = generateMenu(request(), cat);
    expect(menu.meals).toHaveLength(28);
    expect(menu.unfilled).toEqual([]);
    for (const meal of menu.meals) {
      const eaters = meal.items.flatMap((i) => Object.keys(i.portions)).sort();
      expect(eaters).toEqual(['m1', 'm2']);
    }
    const shopping = computeShopping(menu, cat, [], null, emptyShoppingState());
    expect(shopping.lines.length).toBeGreaterThan(10);
    expect(shopping.lines.find((l) => l.product_id === 'water')).toBeUndefined();
  });

  it('is reproducible by seed', () => {
    const cat = catalog();
    const a = generateMenu(request({ seed: 7 }), cat).menu;
    const b = generateMenu(request({ seed: 7 }), cat).menu;
    const c = generateMenu(request({ seed: 8 }), cat).menu;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.batches)).not.toBe(JSON.stringify(c.batches));
  });
});

describe('meal structure', () => {
  it('lunch and dinner are a soup, a main dish or a hearty dish, never a light salad', () => {
    const cat = catalog();
    const { menu } = generateMenu(request({ days: 14 }), cat);
    const batches = new Map(menu.batches.map((b) => [b.id, b]));
    let checked = 0;
    for (const meal of menu.meals.filter((m) => m.slot === 'lunch' || m.slot === 'dinner')) {
      for (const item of meal.items) {
        const r = cat.recipes[batches.get(item.batch_id)!.recipe_id]!;
        checked += 1;
        if (r.category === 'main' || r.category === 'soup') continue;
        const serving = recipeNutrition(cat, r, 1).perServing;
        expect(serving.kcal.value, r.id).toBeGreaterThanOrEqual(350);
        expect(serving.protein.value, r.id).toBeGreaterThanOrEqual(20);
      }
    }
    expect(checked).toBe(28);
  });
});

describe('hard restrictions', () => {
  it('rice and pasta bans exclude them regardless of dish names (check 2)', () => {
    const cat = catalog();
    const ban = { products: [], categories: ['rice', 'pasta'], allergens: [] };
    const req = request({ members: [member({ restrictions: ban }), member({ id: 'm2', name: 'Борис', restrictions: ban })], days: 7 });
    const { menu } = generateMenu(req, cat);
    for (const r of menuRecipes(menu, cat)) {
      expect(containsProductOrCategory(cat, r, 'rice')).toBe(false);
      expect(containsProductOrCategory(cat, r, 'pasta')).toBe(false);
    }
    // «Плов» has no rice in its name, but must still be excluded.
    expect(menu.batches.some((b) => b.recipe_id === 'plov-s-govyadinoy')).toBe(false);
    const shopping = computeShopping(menu, cat, [], null, emptyShoppingState());
    expect(shopping.lines.some((l) => ['rice_white_dry', 'pasta_dry', 'spaghetti_dry', 'egg_noodles_dry'].includes(l.product_id))).toBe(false);
    // Replacement suggestions respect the ban as well.
    const item = menu.meals.find((m) => m.slot === 'dinner')!.items[0]!;
    const ranked = rankCandidates(req, cat, menu, menu.meals.find((m) => m.slot === 'dinner')!.date, 'dinner', req.members, item.id);
    for (const c of ranked) {
      expect(containsProductOrCategory(cat, cat.recipes[c.recipe_id]!, 'rice')).toBe(false);
      expect(containsProductOrCategory(cat, cat.recipes[c.recipe_id]!, 'pasta')).toBe(false);
    }
    const replaced = applyMenuOp(menu, { op: 'replace', item_id: item.id, recipe_id: null }, { catalog: cat, members: req.members });
    for (const r of menuRecipes(replaced, cat)) expect(containsProductOrCategory(cat, r, 'rice')).toBe(false);
  });

  it('one member’s allergen is excluded from shared dishes and alternatives (check 3)', () => {
    const cat = catalog();
    const kid = member({ id: 'kid', name: 'Миша', age: 8, restrictions: { products: [], categories: [], allergens: ['eggs'] } });
    const req = request({ members: [member(), kid] });
    const { menu } = generateMenu(req, cat);
    for (const { recipe_id } of itemsFor(menu, 'kid')) {
      const r = cat.recipes[recipe_id]!;
      expect(r.ingredients.some((i) => productClosure(cat, i.product).allergens.has('eggs'))).toBe(false);
    }
    // Mayonnaise contains eggs through its composition.
    expect(productClosure(cat, 'mayonnaise').allergens.has('eggs')).toBe(true);
    // Manually adding an egg dish for the child is refused; a separate alternative must be safe.
    const meal = menu.meals.find((m) => m.slot === 'breakfast')!;
    expect(() =>
      applyMenuOp(menu, { op: 'add', date: meal.date, slot: meal.slot, recipe_id: 'omlet-s-pomidorami', member_ids: ['kid'] }, { catalog: cat, members: req.members }),
    ).toThrow(/нельзя участнику/);
    const shared = menu.meals.find((m) => m.slot === 'dinner' && m.items.some((i) => Object.keys(i.portions).length === 2))!;
    const sharedItem = shared.items.find((i) => Object.keys(i.portions).length === 2)!;
    const split = applyMenuOp(menu, { op: 'split', item_id: sharedItem.id, member_id: 'kid', recipe_id: null }, { catalog: cat, members: req.members });
    const alt = split.meals.flatMap((m) => m.items).find((i) => i.alternative_for === sharedItem.id)!;
    const altRecipe = cat.recipes[split.batches.find((b) => b.id === alt.batch_id)!.recipe_id]!;
    expect(altRecipe.ingredients.some((i) => productClosure(cat, i.product).allergens.has('eggs'))).toBe(false);
    expect(Object.keys(alt.portions)).toEqual(['kid']);
  });

  it('a dish with unknown composition is never treated as allergen-safe', () => {
    const cat = catalog();
    const m1 = member({ restrictions: { products: [], categories: [], allergens: ['soy'] } });
    const { menu } = generateMenu(request({ members: [m1], days: 21, settings: settings({ repeat: { ...settings().repeat, mode: 'allow' } }) }), cat);
    expect(menu.batches.some((b) => b.recipe_id === 'kuritsa-teriyaki-s-risom')).toBe(false);
  });

  it('incompatible restrictions produce an explanation, not forbidden food (check 10)', () => {
    const cat = catalog();
    // Every root category is banned, so no dish of the catalog can be safe.
    const roots = cat.reference.categories.filter((c) => c.parent === null).map((c) => c.id);
    const strict = member({ restrictions: { products: [], categories: roots, allergens: [] } });
    const { menu } = generateMenu(request({ members: [strict], days: 2 }), cat);
    expect(menu.batches).toEqual([]);
    expect(menu.unfilled).toHaveLength(8);
    expect(menu.unfilled[0]!.message).toMatch(/запреты участника «Аня»/);
  });
});

describe('portions and nutrition', () => {
  it('family members get different portions and nutrients; batch equals their sum (check 5)', () => {
    const cat = catalog();
    const a = member({ portion_mode: 'target', kcal_target: 1600 });
    const b = member({ id: 'm2', name: 'Борис', portion_mode: 'target', kcal_target: 2600 });
    const req = request({ members: [a, b] });
    const { menu } = generateMenu(req, cat);
    const report = menuReport(menu, cat, req.members);
    const kA = report[0]!.period.kcal.value;
    const kB = report[1]!.period.kcal.value;
    expect(kB).toBeGreaterThan(kA);
    for (const batch of menu.batches) {
      let eaten = 0;
      for (const meal of menu.meals) for (const item of meal.items) if (item.batch_id === batch.id) eaten += Object.values(item.portions).reduce((x, y) => x + y, 0);
      expect(eaten).toBeCloseTo(batch.portions, 9);
    }
    for (const { portion } of itemsFor(menu, 'm1')) {
      expect(portion).toBeGreaterThanOrEqual(0.5);
      expect(portion).toBeLessThanOrEqual(2);
    }
  });

  it('simple portions need no anthropometry', () => {
    const cat = catalog();
    const kid = member({ id: 'kid', name: 'Миша', age: 6, weight_kg: null, height_cm: null, sex: null, activity: null, portion_factor: 0.5 });
    const { menu } = generateMenu(request({ members: [kid] }), cat);
    expect(itemsFor(menu, 'kid').every((x) => x.portion === 0.5)).toBe(true);
  });

  it('a saved menu keeps its recipe version after the catalog changes (check 19)', () => {
    const cat = catalog();
    const req = request({ members: [member()], days: 3 });
    const { menu } = generateMenu(req, cat);
    const before = computeShopping(menu, cat, [], null, emptyShoppingState());
    const reportBefore = menuReport(menu, cat, req.members);
    const edited = structuredClone(cat);
    for (const r of Object.values(edited.recipes)) {
      r.version += 1;
      r.ingredients = r.ingredients.map((i) => ({ ...i, qty: i.qty * 3 }));
    }
    const after = computeShopping(menu, edited, [], null, emptyShoppingState());
    expect(after.lines.map((l) => [l.id, l.needed])).toEqual(before.lines.map((l) => [l.id, l.needed]));
    expect(menuReport(menu, edited, req.members)[0]!.period.kcal.value).toBeCloseTo(reportBefore[0]!.period.kcal.value, 9);
  });
});

describe('kitchen settings', () => {
  it('a beginner with only a stove gets stove-only, rank-1 dishes (check 21)', () => {
    const cat = catalog();
    const req = request({ members: [member()], days: 14, settings: settings({ skill: 'beginner', equipment: ['stove'], repeat: { ...settings().repeat, mode: 'allow' } }) });
    const { menu } = generateMenu(req, cat);
    for (const b of menu.batches) {
      const r = cat.recipes[b.recipe_id]!;
      const method = r.methods.find((m) => m.id === b.method_id)!;
      expect(method.equipment.every((e) => e === 'stove')).toBe(true);
      expect(r.techniques).not.toBeNull();
      expect(r.techniques!.some((t) => ['batter', 'forming', 'sauce_emulsion', 'yeast_dough'].includes(t))).toBe(false);
    }
    expect(menu.batches.some((b) => b.recipe_id === 'syrniki' || b.recipe_id === 'lenivye-golubtsy')).toBe(false);
    const item = menu.meals[1]!.items[0]!;
    expect(() => applyMenuOp(menu, { op: 'replace', item_id: item.id, recipe_id: 'losos-s-brokkoli' }, { catalog: cat, members: req.members })).toThrow(/техника/);
    expect(() => applyMenuOp(menu, { op: 'replace', item_id: item.id, recipe_id: 'kotlety-iz-indeyki' }, { catalog: cat, members: req.members })).toThrow(/уровня готовки/);
  });

  it('an alternative appliance switches to its own steps and time (check 21)', () => {
    const cat = catalog();
    const req = request({ members: [member()], days: 1, slots: ['dinner'] });
    const ranked = rankCandidates({ ...req, settings: settings({ equipment: ['airfryer'] }) }, cat, generateMenu(req, cat).menu, req.start_date, 'dinner', req.members, null);
    const salmon = ranked.find((c) => c.recipe_id === 'losos-s-brokkoli')!;
    expect(salmon.method_id).toBe('airfryer');
    const method = cat.recipes['losos-s-brokkoli']!.methods.find((m) => m.id === 'airfryer')!;
    expect(method.total_min).toBe(22);
    expect(method.steps.join(' ')).toMatch(/185 °C/);
  });

  it('no-heat dishes are available with an empty equipment list', () => {
    const cat = catalog();
    const { menu } = generateMenu(request({ members: [member()], days: 2, settings: settings({ equipment: [], repeat: { ...settings().repeat, mode: 'allow' } }) }), cat);
    expect(menu.batches.length).toBeGreaterThan(0);
    for (const b of menu.batches) expect(cat.recipes[b.recipe_id]!.methods.find((m) => m.id === b.method_id)!.equipment).toEqual([]);
  });

  it('container lunches exclude soups', () => {
    const cat = catalog();
    const { menu } = generateMenu(request({ settings: settings({ container_days: [1, 2, 3, 4, 5] }) }), cat);
    for (const meal of menu.meals.filter((m) => m.slot === 'lunch')) {
      const wd = new Date(`${meal.date}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (const item of meal.items) expect(cat.recipes[menu.batches.find((b) => b.id === item.batch_id)!.recipe_id]!.container_ok).toBe(true);
    }
  });
});

describe('diet mode', () => {
  it('balanced mode changes the ranking but never lifts hard bans (check 22)', () => {
    const cat = miniCatalog(
      [
        recipe({ id: 'fried', diet_tags: ['fried', 'white_flour'], ingredients: [{ product: 'p', qty: 100, unit: 'g' }] }),
        recipe({ id: 'grain', diet_tags: ['whole_grain', 'vegetable_rich'], ingredients: [{ product: 'p', qty: 100, unit: 'g' }] }),
        recipe({ id: 'banned', diet_tags: ['whole_grain', 'vegetable_rich', 'legumes'], ingredients: [{ product: 'egg', qty: 100, unit: 'g' }] }),
      ],
      [product({ id: 'p' }), product({ id: 'egg', category: 'eggs', allergens: ['eggs'] })],
    );
    const m = member({ restrictions: { products: [], categories: [], allergens: ['eggs'] } });
    const base = request({ members: [m], days: 1, slots: ['lunch'] });
    const menu = generateMenu(base, cat).menu;
    const itemId = menu.meals[0]!.items[0]!.id;
    const regular = rankCandidates({ ...base, settings: settings({ diet_mode: 'regular' }) }, cat, menu, base.start_date, 'lunch', [m], itemId);
    const balanced = rankCandidates({ ...base, settings: settings({ diet_mode: 'balanced' }) }, cat, menu, base.start_date, 'lunch', [m], itemId);
    expect(regular.map((c) => c.recipe_id)).toEqual(['fried', 'grain']);
    expect(balanced.map((c) => c.recipe_id)).toEqual(['grain', 'fried']);
    expect(balanced.some((c) => c.recipe_id === 'banned')).toBe(false);
  });
});

describe('repeat modes', () => {
  it('unique mode never repeats a recipe within the period (check 23)', () => {
    const cat = catalog();
    const { menu } = generateMenu(request({ days: 7 }), cat);
    const ids = menu.batches.map((b) => b.recipe_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unique mode explains a too-small catalog instead of repeating (check 23)', () => {
    // A deliberately small catalog: 40 recipes cannot fill 35 days × 4 meals without repeats.
    const full = catalog();
    const cat = { ...full, recipes: Object.fromEntries(Object.entries(full.recipes).slice(0, 40)) };
    const { menu } = generateMenu(request({ days: 35, members: [member()] }), cat);
    const ids = menu.batches.map((b) => b.recipe_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(menu.unfilled.length).toBeGreaterThan(0);
    expect(menu.unfilled.some((u) => u.code === 'repeat_exhausted')).toBe(true);
    expect(menu.conflicts.map((c) => c.code)).toContain('unique_mode_catalog_too_small');
  });

  it('pinned duplicates in unique mode are reported as a conflict', () => {
    const cat = catalog();
    const pins = [
      { date: '2026-10-19', slot: 'lunch', recipe_id: 'borshch-s-govyadinoy', method_id: 'stove', portions: { m1: 1 } },
      { date: '2026-10-20', slot: 'lunch', recipe_id: 'borshch-s-govyadinoy', method_id: 'stove', portions: { m1: 1 } },
    ];
    const { menu } = generateMenu(request({ members: [member()], pins }), cat);
    expect(menu.conflicts.map((c) => c.code)).toContain('pins_repeat');
  });

  it('a 35-day menu is built within a bounded time (check 20)', () => {
    const cat = catalog();
    const started = performance.now();
    const { menu } = generateMenu(request({ days: 35, settings: settings({ repeat: { ...settings().repeat, mode: 'allow', max_uses: 4, min_gap_days: 3 } }) }), cat);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(menu.meals).toHaveLength(140);
    expect(menu.stats.evaluated).toBeLessThan(250000);
  });

  it('a batch for two lunches is bought once but eaten twice (check 8)', () => {
    const cat = catalog();
    const req = request({
      members: [member()],
      days: 2,
      slots: ['lunch'],
      settings: settings({ repeat: { mode: 'batch', max_uses: 2, min_gap_days: 0, cook_days: [1], batch_days: 2, batch_slots: ['lunch'] } }),
    });
    const { menu } = generateMenu(req, cat);
    expect(menu.batches).toHaveLength(1);
    expect(menu.meals.every((m) => m.items[0]!.batch_id === menu.batches[0]!.id)).toBe(true);
    expect(menu.batches[0]!.portions).toBe(2);
    const shopping = computeShopping(menu, cat, [], null, emptyShoppingState());
    for (const line of shopping.lines) expect(new Set(line.sources.map((s) => s.batch_id)).size).toBe(1);
    const single = generateMenu({ ...req, days: 1 }, cat).menu;
    const report = menuReport(menu, cat, req.members)[0]!;
    expect(report.days).toHaveLength(2);
    expect(report.days[0]!.totals.kcal.value).toBeCloseTo(report.days[1]!.totals.kcal.value, 9);
    expect(single.batches[0]!.portions).toBe(1);
    expect(menu.warnings.join(' ')).toMatch(/сроки хранения/);
  });
});

describe('vitamins', () => {
  // Two otherwise identical dishes; only vitamin C differs. Complete demo data.
  function vitCatalog(): Catalog {
    const full = { kcal: 100, protein: 5, fat: 3, carbs: 12, fiber: 2, vit_a: 0, vit_d: 0, vit_e: 0, vit_b6: 0, vit_b12: 0, folate: 0 };
    return miniCatalog(
      [
        recipe({ id: 'a-low-c', ingredients: [{ product: 'low', qty: 200, unit: 'g' }] }),
        recipe({ id: 'b-high-c', ingredients: [{ product: 'high', qty: 200, unit: 'g' }] }),
        recipe({ id: 'c-high-c', ingredients: [{ product: 'high', qty: 200, unit: 'g' }] }),
        recipe({ id: 'd-low-c', ingredients: [{ product: 'low', qty: 200, unit: 'g' }] }),
      ],
      [product({ id: 'low', nutrients: { ...full, vit_c: 1 } }), product({ id: 'high', nutrients: { ...full, vit_c: 60 } })],
    );
  }

  it('enabling the vitamin mode picks the menu with better coverage (check 26)', () => {
    const cat = vitCatalog();
    const base = request({ members: [member()], days: 1, slots: ['lunch', 'dinner'] });
    const cov = (m: Menu) => menuReport(m, cat, base.members)[0]!.vitamins.find((v) => v.nutrient === 'vit_c')!.coverage_pct!;
    let strictlyBetter = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      // Same demo target set in both runs; only the «Учитывать витамины» switch differs.
      const off = generateMenu({ ...base, seed, settings: settings({ vitamins: { enabled: false, target_set: 'demo-2026-10', demo: true } }) }, cat).menu;
      const on = generateMenu({ ...base, seed, settings: settings({ vitamins: { enabled: true, target_set: 'demo-2026-10', demo: true } }) }, cat).menu;
      expect(cov(on)).toBeGreaterThanOrEqual(cov(off));
      if (cov(on) > cov(off)) strictlyBetter += 1;
      expect(on.batches.map((b) => b.recipe_id).sort()).toEqual(['b-high-c', 'c-high-c']);
      // Portions are not inflated to chase vitamins.
      expect(itemsFor(on, 'm1').every((x) => x.portion === 1)).toBe(true);
    }
    expect(strictlyBetter).toBeGreaterThan(0);
  });

  it('demo targets are refused for a real scenario (check 27)', () => {
    const cat = vitCatalog();
    expect(() =>
      generateMenu(request({ members: [member()], settings: settings({ vitamins: { enabled: true, target_set: 'demo-2026-10', demo: false } }) }), cat),
    ).toThrow(/демонстрационном/);
  });

  it('reports incomplete data as a lower bound, never a confirmed coverage (check 27)', () => {
    const cat = catalog();
    const req = request({ members: [member()], days: 3, settings: settings({ vitamins: { enabled: true, target_set: 'mr-2.3.1.0253-21-adults', demo: false } }) });
    const { menu } = generateMenu(req, cat);
    const rows = menuReport(menu, cat, req.members)[0]!.vitamins;
    // Vitamin A of the norms and of the data are both in retinol equivalents, so it is assessed.
    expect(rows.find((v) => v.nutrient === 'vit_a')!.status).toBe('ok');
    // The starter catalog has unknown values (estimates, nutrients USDA did not measure).
    expect(rows.some((r) => !r.data_complete)).toBe(true);
    for (const row of rows) {
      if (!row.data_complete) expect(row.coverage_pct).toBeNull();
    }
  });
});

describe('food preferences from the questionnaire', () => {
  const p = product({ id: 'p' });
  const meat = product({ id: 'beef_x', category: 'beef' });
  const wheat = product({ id: 'wheat_x', category: 'flour', allergens: ['gluten'] });
  const ing = (id: string) => [{ product: id, qty: 100, unit: 'g' as const }];

  it('diet types are hard restrictions: vegetarian and gluten-free remove meat and gluten', () => {
    const cat = miniCatalog(
      [recipe({ id: 'stew', ingredients: ing('beef_x') }), recipe({ id: 'pie', ingredients: ing('wheat_x') }), recipe({ id: 'veg', ingredients: ing('p') })],
      [p, meat, wheat],
    );
    const m = member({ diet_types: ['vegetarian', 'gluten_free'] });
    const menu = generateMenu(request({ members: [m], days: 3, slots: ['lunch'], settings: settings({ repeat: { ...settings().repeat, mode: 'allow', max_uses: 3, min_gap_days: 0 } }) }), cat).menu;
    expect(new Set(menuRecipes(menu, cat).map((r) => r.id))).toEqual(new Set(['veg']));
  });

  it('an unknown diet type is rejected instead of being ignored', () => {
    const m = member({ diet_types: ['paleo'] });
    expect(() => generateMenu(request({ members: [m], days: 1, slots: ['lunch'] }), catalog())).toThrow(/Неизвестный тип питания/);
  });

  it('a shared dish respects the lowest spice tolerance; the reason is explained', () => {
    const cat = miniCatalog([recipe({ id: 'chili', spicy: 2, ingredients: ing('p') }), recipe({ id: 'mild', spicy: 0, ingredients: ing('p') })], [p]);
    const adult = member({ spice_tolerance: 2 });
    const child = member({ id: 'm2', name: 'Миша', age: 7, spice_tolerance: 0 });
    const menu = generateMenu(request({ members: [adult, child], days: 1, slots: ['lunch'] }), cat).menu;
    expect(menuRecipes(menu, cat).map((r) => r.id)).toEqual(['mild']);
    const only = miniCatalog([recipe({ id: 'chili', spicy: 2, ingredients: ing('p') })], [p]);
    const empty = generateMenu(request({ members: [child], days: 1, slots: ['lunch'] }), only).menu;
    expect(empty.unfilled[0]?.message).toMatch(/острее, чем допускает участник «Миша»/);
  });

  it('a hand-picked dish that is too spicy is refused', () => {
    const cat = miniCatalog([recipe({ id: 'chili', spicy: 2, ingredients: ing('p') }), recipe({ id: 'mild', ingredients: ing('p') })], [p]);
    const child = member({ age: 7, spice_tolerance: 0 });
    const req = request({ members: [child], days: 1, slots: ['lunch'] });
    const menu = generateMenu(req, cat).menu;
    const itemId = menu.meals[0]!.items[0]!.id;
    expect(() => applyMenuOp(menu, { op: 'replace', item_id: itemId, recipe_id: 'chili' }, { catalog: cat, members: [child] })).toThrow(/острее/);
  });

  it('weekends can have their own cooking time limit', () => {
    const cat = miniCatalog(
      [
        recipe({ id: 'quick', ingredients: ing('p') }),
        recipe({ id: 'slow', ingredients: ing('p'), methods: [{ id: 'oven', name: 'В духовке', equipment: ['oven'], active_min: 20, total_min: 90, steps: ['Шаг', 'Шаг'] }] }),
      ],
      [p],
    );
    // 2026-10-24 is a Saturday. Weekdays are limited to 30 minutes, weekends are not.
    const repeat = { ...settings().repeat, mode: 'allow' as const, max_uses: 2, min_gap_days: 0 };
    const base = request({ start_date: '2026-10-23', members: [member()], days: 2, slots: ['dinner'], settings: settings({ max_total_min: 30, max_total_min_weekend: null, repeat }) });
    const menu = generateMenu(base, cat).menu;
    const friday = menu.meals.find((m) => m.date === '2026-10-23')!.items[0]!.id;
    const saturday = menu.meals.find((m) => m.date === '2026-10-24')!.items[0]!.id;
    const ids = (d: string, item: string) => rankCandidates(base, cat, menu, d, 'dinner', [member()], item).map((c) => c.recipe_id);
    expect(ids('2026-10-23', friday)).toEqual(['quick']);
    expect(ids('2026-10-24', saturday).sort()).toEqual(['quick', 'slow']);
    // Older settings without the weekend field keep one limit for every day.
    const legacy = { ...base, settings: { ...base.settings } };
    delete legacy.settings.max_total_min_weekend;
    expect(rankCandidates(legacy, cat, menu, '2026-10-24', 'dinner', [member()], saturday).map((c) => c.recipe_id)).toEqual(['quick']);
  });

  it('preferred cuisines, liked products and child-friendly dishes raise the ranking, never lifting bans', () => {
    const cat = miniCatalog(
      [
        recipe({ id: 'plain', ingredients: ing('p') }),
        recipe({ id: 'pasta', cuisine: 'italian', ingredients: ing('p') }),
        recipe({ id: 'pumpkin', ingredients: ing('pumpkin_x') }),
        recipe({ id: 'kids', kid_friendly: true, ingredients: ing('p') }),
        recipe({ id: 'meat', cuisine: 'italian', kid_friendly: true, ingredients: ing('beef_x') }),
      ],
      [p, meat, product({ id: 'pumpkin_x' })],
    );
    const adult = member({ diet_types: ['vegetarian'], preferences: { liked_recipes: [], disliked_products: [], liked_products: ['pumpkin_x'] } });
    const base = request({ members: [adult], days: 1, slots: ['lunch'], settings: settings({ cuisines: ['italian'] }) });
    const menu = generateMenu(base, cat).menu;
    const ranked = rankCandidates(base, cat, menu, base.start_date, 'lunch', [adult], menu.meals[0]!.items[0]!.id).map((c) => c.recipe_id);
    expect(ranked.indexOf('pasta')).toBeLessThan(ranked.indexOf('plain'));
    expect(ranked.indexOf('pumpkin')).toBeLessThan(ranked.indexOf('plain'));
    expect(ranked).not.toContain('meat');
    const child = member({ id: 'm2', name: 'Миша', age: 6 });
    const kidReq = request({ members: [child], days: 1, slots: ['lunch'] });
    const kidMenu = generateMenu(kidReq, cat).menu;
    const forChild = rankCandidates(kidReq, cat, kidMenu, kidReq.start_date, 'lunch', [child], kidMenu.meals[0]!.items[0]!.id).map((c) => c.recipe_id);
    expect(forChild.indexOf('kids')).toBeLessThan(forChild.indexOf('plain'));
  });

  it('the «Больше белка» mode is a known diet mode with its own rules', () => {
    const cat = miniCatalog(
      [recipe({ id: 'lean', diet_tags: ['lean_protein'], ingredients: ing('p') }), recipe({ id: 'sweet', diet_tags: ['refined_sugar'], ingredients: ing('p') })],
      [p],
    );
    const base = request({ members: [member()], days: 1, slots: ['lunch'], settings: settings({ diet_mode: 'high_protein' }) });
    const menu = generateMenu(base, cat).menu;
    expect(menuRecipes(menu, cat).map((r) => r.id)).toEqual(['lean']);
    const regular = { ...base, settings: settings({ diet_mode: 'regular' }) };
    const ranked = rankCandidates(regular, cat, menu, base.start_date, 'lunch', [member()], menu.meals[0]!.items[0]!.id);
    expect(new Set(ranked.map((c) => c.score)).size).toBe(1);
  });
});

describe('editing a menu', () => {
  it('repeated «Заменить» walks through different dishes instead of bouncing between two', () => {
    const cat = catalog();
    const req = request({ days: 3 });
    let menu = generateMenu(req, cat).menu;
    const dinner = menu.meals.find((m) => m.slot === 'dinner')!;
    const itemId = dinner.items[0]!.id;
    const recipeOf = (m: Menu) => {
      const item = m.meals.flatMap((x) => x.items).find((i) => i.id === itemId)!;
      return m.batches.find((b) => b.id === item.batch_id)!.recipe_id;
    };
    const seen = [recipeOf(menu)];
    for (let i = 0; i < 4; i += 1) {
      menu = applyMenuOp(menu, { op: 'replace', item_id: itemId, recipe_id: null, avoid: [...seen] }, { catalog: cat, members: req.members });
      seen.push(recipeOf(menu));
    }
    expect(new Set(seen).size).toBe(5);
  });

  it('a replacement keeps the calorie target: portions follow the new dish', () => {
    const cat = catalog();
    const me = member({ portion_mode: 'target', kcal_target: 2400 });
    const req = request({ days: 2, members: [me] });
    let menu = generateMenu(req, cat).menu;
    const lunch = menu.meals.find((m) => m.slot === 'lunch')!;
    const itemId = lunch.items[0]!.id;
    menu = applyMenuOp(menu, { op: 'replace', item_id: itemId, recipe_id: null }, { catalog: cat, members: [me] });
    const item = menu.meals.flatMap((m) => m.items).find((i) => i.id === itemId)!;
    const recipe = cat.recipes[menu.batches.find((b) => b.id === item.batch_id)!.recipe_id]!;
    const perServing = recipeNutrition(cat, recipe).perServing.kcal.value;
    const expected = Math.min(2, Math.max(0.5, Math.floor(((2400 * 0.35) / perServing) * 20 + 0.5) / 20));
    expect(item.portions[me.id]).toBe(expected);
  });

  it('undo of «Убрать» restores the same portions, pin and shared batch', () => {
    const cat = catalog();
    const req = request({ days: 2 });
    let menu = generateMenu(req, cat).menu;
    const meal = menu.meals.find((m) => m.slot === 'dinner')!;
    const item = meal.items[0]!;
    const batch = menu.batches.find((b) => b.id === item.batch_id)!;
    const ctx = { catalog: cat, members: req.members };
    menu = applyMenuOp(menu, { op: 'set_portion', item_id: item.id, member_id: 'm1', portion: 1.5 }, ctx);
    menu = applyMenuOp(menu, { op: 'pin', item_id: item.id, pinned: true }, ctx);
    menu = applyMenuOp(menu, { op: 'remove', item_id: item.id }, ctx);
    menu = applyMenuOp(
      menu,
      { op: 'add', date: meal.date, slot: meal.slot, recipe_id: batch.recipe_id, member_ids: ['m1', 'm2'], method_id: batch.method_id, portions: { m1: 1.5, m2: item.portions.m2! }, pinned: true, batch_id: batch.id },
      ctx,
    );
    const restored = menu.meals.find((m) => m.date === meal.date && m.slot === meal.slot)!.items[0]!;
    expect(restored.pinned).toBe(true);
    expect(restored.portions).toEqual({ m1: 1.5, m2: item.portions.m2 });
    expect(menu.batches.find((b) => b.id === restored.batch_id)!.recipe_id).toBe(batch.recipe_id);
  });

  it('«Пересобрать» applies the current settings, not the ones saved with the menu', () => {
    const cat = catalog();
    const req = request({ days: 3 });
    const menu = generateMenu(req, cat).menu;
    const noAppliances = settings({ equipment: [] });
    const next = applyMenuOp(menu, { op: 'regenerate', seed: 7 }, { catalog: cat, members: req.members, settings: noAppliances });
    expect(next.settings.equipment).toEqual([]);
    for (const r of menuRecipes(next, cat)) expect(r.methods.some((m) => m.equipment.length === 0)).toBe(true);
  });

  it('lunch and dinner of a family with calorie targets stay close to the daily target', () => {
    const cat = catalog();
    const me = member({ portion_mode: 'target', kcal_target: 2000 });
    const req = request({ days: 7, members: [me] });
    const { menu } = generateMenu(req, cat);
    const days = menuReport(menu, cat, [me])[0]!.days;
    for (const d of days) expect(Math.abs(d.energy_deviation_pct ?? 100)).toBeLessThanOrEqual(10);
  });
});

describe('a shorter shopping list without a monotonous week', () => {
  it('reuses products within the week and keeps the main products varied', () => {
    const cat = catalog();
    const members = [member(), member({ id: 'm2', name: 'Борис', sex: 'male' })];
    let lines = 0;
    for (const seed of [1, 2, 3]) {
      const { menu } = generateMenu(request({ members, days: 7, seed, slots: ['breakfast', 'lunch', 'snack', 'dinner'], settings: settings() }), cat);
      lines += computeShopping(menu, cat, [], null, emptyShoppingState()).lines.length;
      // Pasta of any shape counts as one main product: never more than twice a week.
      const pastaDays = new Set(
        menu.meals.filter((m) => m.items.some((i) => {
          const b = menu.batches.find((x) => x.id === i.batch_id)!;
          return cat.recipes[b.recipe_id]!.ingredients.some((g) => cat.products[g.product]?.category === 'pasta' && g.qty >= 70);
        })).map((m) => m.date),
      );
      expect(pastaDays.size).toBeLessThanOrEqual(3);
    }
    // 28 different dishes used to need about 93 products; reuse brings it well under 75.
    expect(lines / 3).toBeLessThan(75);
  });
});

describe('menu quality and edits (round 2)', () => {
  const simple = () => [member({ age: null, sex: null, weight_kg: null, height_cm: null }), member({ id: 'm2', name: 'Борис', age: null, sex: null, weight_kg: null, height_cm: null })];

  it('simple portions still give adults a realistic day, not a 130 kcal soup for lunch', () => {
    const cat = catalog();
    const members = simple();
    for (const diet_mode of ['regular', 'balanced'] as const) {
      const { menu } = generateMenu(request({ days: 7, members, settings: settings({ diet_mode }) }), cat);
      const days = menuReport(menu, cat, members)[0]!.days;
      const avg = days.reduce((s, d) => s + d.totals.kcal.value, 0) / days.length;
      expect(avg).toBeGreaterThan(1500);
    }
  });

  it('«Пересобрать» brings mostly new dishes and never reuses a batch id', () => {
    const cat = catalog();
    const members = simple();
    const req = request({ days: 7, members, settings: settings({ diet_mode: 'balanced' }) });
    const menu = generateMenu(req, cat).menu;
    const next = applyMenuOp(menu, { op: 'regenerate', seed: 99 }, { catalog: cat, members });
    const before = new Set(menu.batches.map((b) => b.recipe_id));
    const same = next.batches.filter((b) => before.has(b.recipe_id)).length;
    expect(same).toBeLessThan(next.batches.length / 2);
    const oldIds = new Set(menu.batches.map((b) => b.id));
    expect(next.batches.some((b) => oldIds.has(b.id))).toBe(false);
  });

  it('a removed batch id is not given to the next dish', () => {
    const cat = catalog();
    const members = simple();
    let menu = generateMenu(request({ days: 2, members }), cat).menu;
    const meal = menu.meals.find((m) => m.slot === 'dinner')!;
    const item = meal.items[0]!;
    const removedBatch = item.batch_id;
    menu = applyMenuOp(menu, { op: 'remove', item_id: item.id }, { catalog: cat, members });
    const recipe = Object.values(cat.recipes).find((r) => r.meal_types.includes('dinner') && r.category === 'main' && !menu.batches.some((b) => b.recipe_id === r.id) && r.methods.some((m) => m.equipment.every((e) => menu.settings.equipment.includes(e))))!;
    menu = applyMenuOp(menu, { op: 'add', date: meal.date, slot: 'dinner', recipe_id: recipe.id, member_ids: ['m1', 'm2'] }, { catalog: cat, members });
    const added = menu.meals.find((m) => m.date === meal.date && m.slot === 'dinner')!.items[0]!;
    expect(added.batch_id).not.toBe(removedBatch);
  });

  it('a dish chosen by hand must suit the meal and respect «different dishes every day»', () => {
    const cat = catalog();
    const members = simple();
    const menu = generateMenu(request({ days: 3, members, settings: settings({ repeat: { ...settings().repeat, mode: 'unique' } }) }), cat).menu;
    const breakfast = menu.meals.find((m) => m.slot === 'breakfast')!;
    const soup = Object.values(cat.recipes).find((r) => r.category === 'soup' && !r.meal_types.includes('breakfast'))!;
    expect(() => applyMenuOp(menu, { op: 'add', date: breakfast.date, slot: 'breakfast', recipe_id: soup.id, member_ids: ['m1'] }, { catalog: cat, members })).toThrow(/не подходит/);
    const used = menu.batches.find((b) => cat.recipes[b.recipe_id]!.meal_types.includes('dinner'))!;
    const dinner = menu.meals.filter((m) => m.slot === 'dinner').at(-1)!;
    expect(() => applyMenuOp(menu, { op: 'add', date: dinner.date, slot: 'dinner', recipe_id: used.recipe_id, member_ids: ['m1'], method_id: used.method_id }, { catalog: cat, members })).toThrow(/уже есть в меню/);
  });

  it('a separate dish for a member with a calorie target gets a portion for that dish', () => {
    const cat = catalog();
    const me = member({ portion_mode: 'target', kcal_target: 1750 });
    const other = member({ id: 'm2', name: 'Борис' });
    const menu = generateMenu(request({ days: 2, members: [me, other] }), cat).menu;
    const lunch = menu.meals.find((m) => m.slot === 'lunch')!;
    const next = applyMenuOp(menu, { op: 'split', item_id: lunch.items[0]!.id, member_id: 'm1', recipe_id: null }, { catalog: cat, members: [me, other] });
    const own = next.meals.find((m) => m.date === lunch.date && m.slot === 'lunch')!.items.find((i) => i.alternative_for !== null)!;
    const recipe = cat.recipes[next.batches.find((b) => b.id === own.batch_id)!.recipe_id]!;
    const expected = Math.min(2, Math.max(0.5, Math.floor(((1750 * 0.35) / recipeNutrition(cat, recipe).perServing.kcal.value) * 20 + 0.5) / 20));
    expect(own.portions.m1).toBe(expected);
  });

  it('moving a meal swaps its «no dish» explanation too', () => {
    const cat = catalog();
    const members = simple();
    const menu = generateMenu(request({ days: 2, members }), cat).menu;
    const a = menu.meals[0]!;
    const b = menu.meals[3]!;
    const withNote = { ...menu, unfilled: [{ date: b.date, slot: b.slot, member_ids: ['m1'], code: 'no_candidates', message: 'нет' }] };
    const next = applyMenuOp(withNote, { op: 'move', from: { date: a.date, slot: a.slot }, to: { date: b.date, slot: b.slot } }, { catalog: cat, members });
    expect(next.unfilled).toEqual([{ date: a.date, slot: a.slot, member_ids: ['m1'], code: 'no_candidates', message: 'нет' }]);
  });
});
