import type { Catalog, Recipe } from '../engine';

/**
 * Checks of a household's own recipe, used by the editor (to explain what to fix) and by the guest
 * store before writing (validation at the boundary, CLAUDE.md §5). Messages are in Russian, one per
 * problem.
 */
export function customRecipeErrors(r: Recipe, catalog: Catalog): string[] {
  const errors: string[] = [];
  const name = r.name.trim();
  if (!name || name.length > 200) errors.push('Укажите название — до 200 символов.');
  if (!catalog.reference.recipe_categories.some((c) => c.id === r.category)) errors.push('Выберите категорию.');
  const slots = new Set(catalog.reference.meal_slots.map((s) => s.id));
  if (r.meal_types.length === 0 || r.meal_types.some((m) => !slots.has(m))) errors.push('Выберите приёмы пищи.');
  if (!(Number.isInteger(r.servings) && r.servings >= 1 && r.servings <= 20)) errors.push('Порций — от 1 до 20.');
  if (r.yield_g !== null && !(Number.isFinite(r.yield_g) && r.yield_g > 0 && r.yield_g <= 20000)) errors.push('Выход готового блюда — от 1 до 20 000 г или пусто.');
  if (r.ingredients.length === 0) errors.push('Добавьте хотя бы один ингредиент.');
  if (r.ingredients.some((i) => !catalog.products[i.product])) errors.push('Один из ингредиентов не найден в справочнике продуктов.');
  if (r.ingredients.some((i) => !(Number.isFinite(i.qty) && i.qty > 0 && i.qty <= 100000))) errors.push('Количество каждого ингредиента — число больше нуля.');
  const method = r.methods[0];
  if (!method || method.steps.length === 0) errors.push('Опишите хотя бы один шаг.');
  if (method) {
    const okMin = (v: number) => Number.isInteger(v) && v >= 0 && v <= 1440;
    if (!okMin(method.total_min) || !okMin(method.active_min)) errors.push('Время — целое число минут от 0 до 1440.');
    else if (method.active_min > method.total_min) errors.push('Активное время не может быть больше общего.');
  }
  if (r.spicy !== undefined && ![0, 1, 2].includes(r.spicy)) errors.push('Острота — 0, 1 или 2.');
  const hot = r.ingredients.map((i) => catalog.products[i.product]).filter((p) => p && catalog.reference.hot_products?.includes(p.id));
  if ((r.spicy ?? 0) === 0 && hot.length > 0) errors.push(`В составе есть острый продукт (${hot.map((p) => p!.name.toLowerCase()).join(', ')}) — отметьте остроту «Немного» или «Острое».`);
  return errors;
}
