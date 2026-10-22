import { describe, expect, it } from 'vitest';
import { recipeNutrition } from '../nutrition';
import { convertQuantity, toBase, toGrams, availableDisplayUnits } from '../units';
import { estimateEnergy, resolveVitaminTargets } from '../targets';
import { Rng, roundHalfUp, addDays, isoWeekday } from '../basics';
import { catalog, member, product, recipe, miniCatalog } from './helpers';

describe('units', () => {
  const cat = catalog();
  const p = (id: string) => cat.products[id]!;

  it('converts g↔kg and ml↔l universally', () => {
    expect(convertQuantity(p('potato'), 1500, 'g', 'kg')).toEqual({ qty: 1.5, unit: 'kg', approximate: false });
    expect(convertQuantity(p('soy_sauce'), 0.2, 'l', 'ml')).toEqual({ qty: 200, unit: 'ml', approximate: false });
  });

  it('refuses mass→volume without density (check 9)', () => {
    // Potato has no density: grams cannot become millilitres.
    expect(convertQuantity(p('potato'), 100, 'g', 'ml')).toBeNull();
    expect(availableDisplayUnits(p('potato'))).not.toContain('ml');
    // Sugar has a spoon mass but no density: a spoonful cannot be turned into millilitres.
    expect(convertQuantity(p('sugar'), 2, 'tbsp', 'ml')).toBeNull();
  });

  it('refuses pieces without an average piece mass and marks pieces approximate (check 9)', () => {
    expect(toGrams(p('cottage_cheese'), 1, 'pcs')).toBeNull();
    expect(convertQuantity(p('cottage_cheese'), 200, 'g', 'pcs')).toBeNull();
    const eggs = convertQuantity(p('potato'), 300, 'g', 'pcs');
    expect(eggs).toEqual({ qty: 2, unit: 'pcs', approximate: true });
  });

  it('uses product-specific spoon masses, not a universal spoon', () => {
    expect(toGrams(p('sugar'), 1, 'tbsp')).toBe(12.5);
    expect(toGrams(p('honey'), 1, 'tbsp')).toBe(21);
    expect(toGrams(p('cottage_cheese'), 1, 'tsp')).toBeNull();
  });

  it('converts volume products through density only', () => {
    expect(toBase(p('sunflower_oil'), 2, 'tbsp')).toBeCloseTo((2 * 13.6) / 0.92, 10);
    expect(toGrams(p('milk'), 100, 'ml')).toBeCloseTo(103, 10);
  });
});

describe('recipe nutrition', () => {
  const cat = catalog();

  it('doubles ingredients and totals but keeps per-100 g values (check 4)', () => {
    const r = cat.recipes['ovsyanka-s-yablokom']!;
    const one = recipeNutrition(cat, r, 1);
    const two = recipeNutrition(cat, r, 2);
    expect(two.total.kcal.value).toBeCloseTo(one.total.kcal.value * 2, 9);
    expect(two.total.protein.value).toBeCloseTo(one.total.protein.value * 2, 9);
    expect(two.per100g!.kcal.value).toBeCloseTo(one.per100g!.kcal.value, 9);
    expect(two.perServing.kcal.value).toBeCloseTo(one.perServing.kcal.value, 9);
  });

  it('uses edible mass: contribution = edible g × value / 100', () => {
    const cat2 = miniCatalog(
      [recipe({ id: 'r', servings: 1, yield_g: 400, ingredients: [{ product: 'potato', qty: 500, unit: 'g' }] })],
      [product({ id: 'potato', edible_fraction: 0.8, nutrients: { kcal: 77, protein: 2 } })],
    );
    const n = recipeNutrition(cat2, cat2.recipes.r!, 1);
    expect(n.total.kcal.value).toBeCloseTo(400 * 0.77, 9);
    expect(n.per100g!.kcal.value).toBeCloseTo(77, 9);
  });

  it('keeps unknown nutrients unknown instead of zero (check 11, 27)', () => {
    const r = cat.recipes['oladi-na-kefire']!;
    const n = recipeNutrition(cat, r, 1);
    expect(n.total.vit_b12.complete).toBe(false);
    expect(n.total.vit_b12.missing).toContain('kefir');
    expect(n.total.kcal.complete).toBe(true);
  });

  it('does not invent per-100 g when the yield is unknown', () => {
    const n = recipeNutrition(cat, { ...cat.recipes['pirog-s-kapustoy']!, yield_g: null }, 1);
    expect(n.per100g).toBeNull();
    expect(n.perServing.kcal.value).toBeGreaterThan(0);
  });

  it('does not silently force calories to match 4/9/4', () => {
    const p = cat.products.sunflower_oil!;
    expect(p.nutrients.kcal).toBe(884);
    expect((p.nutrients.fat ?? 0) * 9).toBe(900);
  });
});

describe('energy targets', () => {
  it('estimates adults by Mifflin–St Jeor and refuses minors', () => {
    const adult = estimateEnergy(member({ sex: 'male', age: 30, weight_kg: 80, height_cm: 180, activity: 'low', goal: 'maintain' }));
    expect(adult.available).toBe(true);
    expect(adult.kcal).toBe(Math.round((10 * 80 + 6.25 * 180 - 5 * 30 + 5) * 1.2));
    const child = estimateEnergy(member({ age: 12, goal: 'lose' }));
    expect(child.available).toBe(false);
    expect(child.kcal).toBeNull();
  });
});

describe('vitamin targets', () => {
  const cat = catalog();

  it('refuses incompatible vitamin forms and unverified folate form (check 27)', () => {
    const t = resolveVitaminTargets(cat, member(), 'mr-2.3.1.0253-21-adults', false);
    const by = Object.fromEntries(t.map((x) => [x.nutrient, x]));
    expect(by.vit_a!.status).toBe('incompatible_form');
    expect(by.vit_e!.status).toBe('incompatible_form');
    expect(by.folate!.status).toBe('incompatible_form');
    expect(by.vit_c!.status).toBe('ok');
    expect(by.vit_c!.daily).toBe(100);
    expect(by.vit_c!.message).toMatch(/не сверено/);
  });

  it('never applies demo targets to real profiles (check 27)', () => {
    const t = resolveVitaminTargets(cat, member(), 'demo-2026-10', false);
    expect(t.every((x) => x.status === 'demo_not_allowed')).toBe(true);
    const demo = resolveVitaminTargets(cat, member(), 'demo-2026-10', true);
    expect(demo.every((x) => x.status === 'ok')).toBe(true);
  });

  it('does not apply adult sets to children', () => {
    const t = resolveVitaminTargets(cat, member({ age: 10 }), 'mr-2.3.1.0253-21-adults', false);
    expect(t.every((x) => x.status === 'not_applicable')).toBe(true);
  });
});

describe('deterministic primitives', () => {
  it('produces the reference mulberry32 sequence', () => {
    const rng = new Rng(42);
    const values = [rng.next(), rng.next(), rng.next()];
    expect(values[0]).toBeCloseTo(0.6011037519201636, 15);
    expect(values[1]).toBeCloseTo(0.44829055899754167, 15);
    expect(values[2]).toBeCloseTo(0.8524657934904099, 15);
  });

  it('rounds half up and handles dates in UTC', () => {
    expect(roundHalfUp(2.5, 1)).toBe(3);
    expect(roundHalfUp(-2.5, 1)).toBe(-2);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29');
    expect(isoWeekday('2026-10-19')).toBe(1);
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
});
