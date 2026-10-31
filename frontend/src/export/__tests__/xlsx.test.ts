import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { seedCatalog } from '../../data/seed';
import { approxPieces, computeShopping, generateMenu } from '../../engine';
import { buildExportModel, safeText } from '../model';
import { buildXlsx } from '../files';
import type { MenuRecord, ShoppingView } from '../../data/types';

describe('XLSX export (check 15)', () => {
  it('has the three sheets with real dates, numeric quantities and Cyrillic text', async () => {
    const catalog = seedCatalog();
    const member = { id: 'm1', name: 'Аня', age: 30, sex: null, height_cm: null, weight_kg: null, activity: null, goal: null, portion_mode: 'simple' as const, portion_factor: 1, kcal_target: null, restrictions: { products: [], categories: [], allergens: [] }, preferences: { liked_recipes: [], disliked_products: [] } };
    const { menu } = generateMenu({ start_date: '2026-10-19', days: 2, seed: 5, slots: ['lunch', 'dinner'], members: [member], settings: { skill: 'any', diet_mode: 'regular', equipment: ['stove', 'oven'], max_total_min: null, repeat: { mode: 'unique', max_uses: 2, min_gap_days: 2, cook_days: [], batch_days: 2, batch_slots: [] }, container_days: [], vitamins: { enabled: false, target_set: null, demo: false }, budget: { limit_kop: null, currency: 'RUB' }, tolerances: { energy_pct: 10, macro_pct: 20 }, portion_min: 0.5, portion_max: 2 } }, catalog);
    const state = { manual_lines: [{ id: 'manual:1', name: '=HYPERLINK("http://x")', qty: 1, unit: 'pcs', department: 'Другое', price_kop: null }], marks: {}, seen: {} };
    const shopping = { ...computeShopping(menu, catalog, [], null, state), state, shopping_revision: 1 } as unknown as ShoppingView;
    shopping.lines = shopping.lines.map((l) => ({ ...l, transferred: false }));
    const record: MenuRecord = { id: 'x', title: 'Тестовое меню', start_date: menu.start_date, days: menu.days, revision: 1, is_favorite: false, created_at: '', updated_at: '', menu, shopping_revision: 1, cooked_batches: [] };
    const blob = await buildXlsx(buildExportModel(record, shopping, [member]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Меню', 'Покупки', 'Готовка']);
    const menuSheet = wb.getWorksheet('Меню')!;
    expect(menuSheet.getCell('A2').value).toBeInstanceOf(Date);
    expect((menuSheet.getCell('A2').value as Date).toISOString().slice(0, 10)).toBe('2026-10-19');
    expect(String(menuSheet.getCell('D2').value)).toMatch(/[а-яА-Я]/);
    const shop = wb.getWorksheet('Покупки')!;
    expect(typeof shop.getCell('E2').value).toBe('number');
    const names = shop.getColumn(2).values.map(String);
    expect(names).toContain(`'=HYPERLINK("http://x")`);
    expect(names.some((n) => n.startsWith('='))).toBe(false);
    const cook = wb.getWorksheet('Готовка')!;
    expect(typeof cook.getCell('D2').value).toBe('number');
  });

  it('loose produce bought by weight also says how many pieces to pick (1 piece = its own mass)', () => {
    const catalog = seedCatalog();
    const lemon = catalog.products.lemon!;
    expect(lemon.piece_g).toBe(120);
    expect(approxPieces(lemon, 142)).toBe(2);
    expect(approxPieces(lemon, 125)).toBe(1); // under a tenth of a piece more: still one lemon
    expect(approxPieces(lemon, 30)).toBe(1);
    expect(approxPieces(catalog.products.lemon, 0)).toBeNull();
    expect(approxPieces({ ...lemon, piece_g: null }, 142)).toBeNull();

    const line = { id: 'auto:lemon', product_id: 'lemon', name: 'Лимон', department: 'Овощи и фрукты', unit: 'g', needed: 142, from_pantry: 0, to_buy: 142, package: null, price_kop: null, price_per: null, purchase_cost_kop: null, price_source: null, purchased: false, at_home: false, changed: false, transferred: false };
    const menu = { start_date: '2026-10-19', days: 1, meals: [], batches: [], snapshot: { recipes: {}, products: { lemon } } };
    const record = { id: 'x', title: 'Меню', start_date: '2026-10-19', days: 1, revision: 1, is_favorite: false, created_at: '', updated_at: '', menu, shopping_revision: 1, cooked_batches: [] } as unknown as MenuRecord;
    const shopping = { lines: [line], manual_lines: [], totals: { purchase_kop: 0, complete: false }, budget: null } as unknown as ShoppingView;
    expect(buildExportModel(record, shopping, []).shopping[0]?.toBuyText).toBe('142 г (≈ 2 шт.)');
  });

  it('neutralises formula-like text', () => {
    expect(safeText('=1+1')).toBe("'=1+1");
    expect(safeText('@cmd')).toBe("'@cmd");
    expect(safeText('Картофель')).toBe('Картофель');
  });
});
