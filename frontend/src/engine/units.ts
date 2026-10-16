import type { BaseUnit, Product, RecipeUnit } from './types';

// Unit rules (docs/ARCHITECTURE.md, «Единицы»):
// - g↔kg and ml↔l are universal;
// - mass↔volume needs the product's density;
// - pieces need the product's average piece mass;
// - spoons and pinches need product-specific masses (no universal spoon mass);
// - without a coefficient a conversion is impossible and the function returns null.

export const UNIT_NAMES: Record<RecipeUnit | 'kg' | 'l', string> = {
  g: 'г',
  kg: 'кг',
  ml: 'мл',
  l: 'л',
  pcs: 'шт.',
  tbsp: 'ст. л.',
  tsp: 'ч. л.',
  pinch: 'щеп.',
};

/** Gross (as purchased) mass in grams, or null when the product lacks the needed coefficient. */
export function toGrams(product: Product, qty: number, unit: RecipeUnit): number | null {
  switch (unit) {
    case 'g':
      return qty;
    case 'kg':
      return qty * 1000;
    case 'ml':
      return product.density_g_ml ? qty * product.density_g_ml : null;
    case 'l':
      return product.density_g_ml ? qty * 1000 * product.density_g_ml : null;
    case 'pcs':
      return product.piece_g ? qty * product.piece_g : null;
    case 'tbsp':
    case 'tsp':
    case 'pinch': {
      const spoon = product.spoon_g?.[unit];
      return spoon ? qty * spoon : null;
    }
  }
}

/** Edible mass in grams used for nutrition: gross mass × edible fraction. */
export function edibleGrams(product: Product, qty: number, unit: RecipeUnit): number | null {
  const gross = toGrams(product, qty, unit);
  return gross === null ? null : gross * product.edible_fraction;
}

/** Quantity in the product's base unit (g, ml or pcs), or null if no coefficient is known. */
export function toBase(product: Product, qty: number, unit: RecipeUnit | 'kg' | 'l'): number | null {
  const base = product.base_unit;
  if (base === 'ml') {
    if (unit === 'ml') return qty;
    if (unit === 'l') return qty * 1000;
    const grams = toGrams(product, qty, unit);
    if (grams === null || !product.density_g_ml) return null;
    return grams / product.density_g_ml;
  }
  if (base === 'pcs') {
    if (unit === 'pcs') return qty;
    const grams = toGrams(product, qty, unit);
    if (grams === null || !product.piece_g) return null;
    return grams / product.piece_g;
  }
  return toGrams(product, qty, unit);
}

export interface DisplayQuantity {
  qty: number;
  unit: RecipeUnit;
  approximate: boolean;
}

/**
 * Units the user may switch an ingredient to. Only conversions with a known coefficient are offered;
 * pieces are marked approximate because they rely on an average piece mass.
 */
export function availableDisplayUnits(product: Product): RecipeUnit[] {
  const units: RecipeUnit[] = [];
  const hasMass = product.base_unit === 'g' || Boolean(product.density_g_ml) || Boolean(product.piece_g);
  const hasVolume = product.base_unit === 'ml' || Boolean(product.density_g_ml);
  if (hasMass) units.push('g', 'kg');
  if (hasVolume) units.push('ml', 'l');
  if (product.piece_g || product.base_unit === 'pcs') units.push('pcs');
  for (const spoon of ['tbsp', 'tsp', 'pinch'] as const) {
    if (product.spoon_g?.[spoon] && (product.base_unit === 'g' || product.density_g_ml)) units.push(spoon);
  }
  return units;
}

export function convertQuantity(
  product: Product,
  qty: number,
  from: RecipeUnit,
  to: RecipeUnit,
): DisplayQuantity | null {
  if (from === to) return { qty, unit: to, approximate: false };
  if (from === 'g' && to === 'kg') return { qty: qty / 1000, unit: to, approximate: false };
  if (from === 'kg' && to === 'g') return { qty: qty * 1000, unit: to, approximate: false };
  if (from === 'ml' && to === 'l') return { qty: qty / 1000, unit: to, approximate: false };
  if (from === 'l' && to === 'ml') return { qty: qty * 1000, unit: to, approximate: false };
  const grams = toGrams(product, qty, from);
  if (grams === null) return null;
  const approximate = from === 'pcs' || to === 'pcs';
  switch (to) {
    case 'g':
      return { qty: grams, unit: to, approximate };
    case 'kg':
      return { qty: grams / 1000, unit: to, approximate };
    case 'ml':
      return product.density_g_ml ? { qty: grams / product.density_g_ml, unit: to, approximate } : null;
    case 'l':
      return product.density_g_ml ? { qty: grams / product.density_g_ml / 1000, unit: to, approximate } : null;
    case 'pcs':
      return product.piece_g ? { qty: grams / product.piece_g, unit: to, approximate: true } : null;
    case 'tbsp':
    case 'tsp':
    case 'pinch': {
      const spoon = product.spoon_g?.[to];
      return spoon ? { qty: grams / spoon, unit: to, approximate } : null;
    }
  }
}

/** Converts a package size to the product's base unit, or null if incompatible. */
export function packageToBase(product: Product, size: number, unit: BaseUnit | 'kg' | 'l'): number | null {
  return toBase(product, size, unit);
}

export function formatQty(qty: number, unit: string): string {
  const abs = Math.abs(qty);
  let digits = 0;
  if (abs < 10 && abs % 1 !== 0) digits = 1;
  if (abs < 1 && abs !== 0) digits = 2;
  const text = qty.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const name = (UNIT_NAMES as Record<string, string>)[unit] ?? unit;
  return `${text} ${name}`;
}
