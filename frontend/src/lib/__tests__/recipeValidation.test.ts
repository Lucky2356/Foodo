import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../data/seed';
import { customRecipeErrors } from '../recipeValidation';

describe('own recipe checks', () => {
  const cat = seedCatalog();
  const base = { ...cat.recipes['omlet-s-pomidorami']!, id: 'u-1', source: 'user' as const, visibility: 'private' as const };

  it('a recipe from the catalogue passes', () => {
    expect(customRecipeErrors(base, cat)).toEqual([]);
  });

  it('a hot ingredient needs a spice level above zero', () => {
    const hot = { ...base, spicy: 0, ingredients: [...base.ingredients, { product: 'chili_flakes', qty: 1, unit: 'pinch' as const }] };
    expect(customRecipeErrors(hot, cat).join(' ')).toMatch(/острый продукт/);
    expect(customRecipeErrors({ ...hot, spicy: 1, kid_friendly: false }, cat)).toEqual([]);
  });
});
