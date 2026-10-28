import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSEHOLD_SETTINGS } from '../../data/guestGateway';
import type { HouseholdView } from '../../data/types';
import { foodSummary, kitchenSummary, menuSummary, shoppingSummary } from '../settingsSummary';

const rub = (kop: number) => `${kop / 100} ₽`;

function household(patch: Partial<HouseholdView> = {}, plan: Record<string, unknown> = {}): HouseholdView {
  const settings = structuredClone(DEFAULT_HOUSEHOLD_SETTINGS);
  Object.assign(settings.plan, plan);
  return { id: 'h', name: 'Моя семья', settings, city: null, store_chain_id: null, share_prices: false, members: [], ...patch } as unknown as HouseholdView;
}

describe('settings summaries on the profile hub', () => {
  it('menu: meals, period and repeats in plain words', () => {
    const h = household();
    h.settings.slots = ['breakfast', 'lunch', 'snack', 'dinner'];
    h.settings.days = 7;
    h.settings.plan.repeat.mode = 'unique';
    expect(menuSummary(h)).toBe('4 приёма пищи · неделя · каждый день новое');
    h.settings.slots = ['lunch'];
    h.settings.days = 3;
    h.settings.plan.repeat.mode = 'batch';
    expect(menuSummary(h)).toBe('1 приём пищи · 3 дня · готовлю на 2–3 дня');
  });

  it('kitchen: skill, appliances and weekday time', () => {
    expect(kitchenSummary(household({}, { skill: 'beginner', equipment: ['stove', 'oven'], max_total_min: 30 }))).toBe('простые блюда · 2 прибора · до 30 мин в будни');
    expect(kitchenSummary(household({}, { skill: 'any', equipment: [], max_total_min: null }))).toBe('любые блюда · без техники · время любое');
  });

  it('food: diet, cuisines and vitamins only when set', () => {
    expect(foodSummary(household({}, { diet_mode: 'regular', cuisines: [], vitamins: { enabled: false } }))).toBe('обычное питание');
    expect(foodSummary(household({}, { diet_mode: 'balanced', cuisines: ['russian', 'italian'], vitamins: { enabled: true } }))).toBe('ПП · 2 любимые кухни · с учётом витаминов');
  });

  it('shopping: says plainly that there are no prices without a city', () => {
    expect(shoppingSummary(household(), null, rub)).toBe('город не выбран — цен нет · без бюджета');
    const h = household({ city: { id: 'kzn', name: 'Казань', region: 'Республика Татарстан', timezone: 'Europe/Moscow' } });
    h.settings.plan.budget.limit_kop = 500000;
    expect(shoppingSummary(h, 'METRO', rub)).toBe('Казань · METRO · бюджет 5000 ₽');
    expect(shoppingSummary(h, null, rub)).toBe('Казань · любой магазин · бюджет 5000 ₽');
  });
});
