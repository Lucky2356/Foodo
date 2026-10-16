import { UNIT_NAMES } from '../engine';
import type { Member } from '../engine';
import type { MenuRecord, ShoppingView } from '../data/types';
import { SLOT_NAMES } from '../lib/recipes';
import { weekdayLong } from '../lib/dates';

// One tabular model feeds the XLSX, PDF and plain-text exports so they always show the same,
// current values.

export interface MenuRow {
  date: string;
  weekday: string;
  slot: string;
  dish: string;
  who: string;
  portions: number;
}

export interface ShoppingRow {
  department: string;
  name: string;
  needed: number | null;
  fromPantry: number | null;
  toBuy: number | null;
  unit: string;
  packages: number | null;
  packageSize: string;
  pricePerPackageRub: number | null;
  costRub: number | null;
  priceSource: string;
  mark: string;
}

export interface CookRow {
  date: string;
  dish: string;
  method: string;
  portions: number;
  totalMin: number | null;
  feeds: string;
}

export interface ExportModel {
  title: string;
  generatedAt: string;
  menu: MenuRow[];
  shopping: ShoppingRow[];
  cooking: CookRow[];
  totals: { purchaseRub: number; complete: boolean; budget: string };
}

const unitName = (u: string) => (UNIT_NAMES as Record<string, string>)[u] ?? u;

export function buildExportModel(record: MenuRecord, shopping: ShoppingView | null, members: Member[]): ExportModel {
  const menu = record.menu;
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? '—';
  const batches = new Map(menu.batches.map((b) => [b.id, b]));
  const rows: MenuRow[] = [];
  for (const meal of menu.meals) {
    for (const item of meal.items) {
      const b = batches.get(item.batch_id);
      const r = b ? menu.snapshot.recipes[b.recipe_id] : undefined;
      rows.push({
        date: meal.date,
        weekday: weekdayLong(meal.date),
        slot: SLOT_NAMES[meal.slot] ?? meal.slot,
        dish: r?.name ?? '—',
        who: Object.entries(item.portions)
          .map(([id, f]) => `${name(id)} ${f}`)
          .join(', '),
        portions: Object.values(item.portions).reduce((a, b2) => a + b2, 0),
      });
    }
    if (meal.items.length === 0) rows.push({ date: meal.date, weekday: weekdayLong(meal.date), slot: SLOT_NAMES[meal.slot] ?? meal.slot, dish: 'нет подходящего блюда', who: '', portions: 0 });
  }
  const shoppingRows: ShoppingRow[] = [];
  for (const l of shopping?.lines ?? []) {
    shoppingRows.push({
      department: l.department,
      name: l.name,
      needed: l.needed,
      fromPantry: l.from_pantry,
      toBuy: l.at_home ? 0 : l.to_buy,
      unit: unitName(l.unit),
      packages: l.package ? l.package.count : null,
      packageSize: l.package ? `${l.package.size} ${unitName(l.package.unit)}` : '',
      pricePerPackageRub: l.price_kop !== null ? l.price_kop / 100 : null,
      costRub: l.purchase_cost_kop !== null ? l.purchase_cost_kop / 100 : null,
      priceSource: l.price_source ?? '',
      mark: l.purchased ? 'куплено' : l.at_home ? 'есть дома' : '',
    });
  }
  for (const m of shopping?.manual_lines ?? []) {
    shoppingRows.push({
      department: m.department,
      name: m.name,
      needed: m.qty,
      fromPantry: null,
      toBuy: m.qty,
      unit: m.unit ?? '',
      packages: null,
      packageSize: '',
      pricePerPackageRub: null,
      costRub: m.price_kop !== null ? m.price_kop / 100 : null,
      priceSource: 'добавлено вручную',
      mark: m.purchased ? 'куплено' : m.at_home ? 'есть дома' : '',
    });
  }
  const cooking: CookRow[] = menu.batches
    .map((b) => {
      const r = menu.snapshot.recipes[b.recipe_id];
      const method = r?.methods.find((m) => m.id === b.method_id);
      const feeds = menu.meals
        .filter((m) => m.items.some((i) => i.batch_id === b.id))
        .map((m) => `${m.date} ${SLOT_NAMES[m.slot] ?? m.slot}`)
        .join('; ');
      return { date: b.cook_date, dish: r?.name ?? '—', method: method?.name ?? '', portions: b.portions, totalMin: method?.total_min ?? null, feeds };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const budget = shopping?.budget;
  const budgetText = !budget || budget.status === 'none' ? 'бюджет не задан' : budget.status === 'ok' ? 'укладывается в бюджет' + (budget.estimated ? ' (по оценочным ценам)' : '') : budget.status === 'exceeded' ? 'превышает бюджет' : 'бюджет не подтверждён: известны не все цены';
  return {
    title: record.title || `Меню с ${menu.start_date} на ${menu.days} дн.`,
    generatedAt: new Date().toISOString(),
    menu: rows,
    shopping: shoppingRows,
    cooking,
    totals: { purchaseRub: (shopping?.totals.purchase_kop ?? 0) / 100, complete: shopping?.totals.complete ?? false, budget: budgetText },
  };
}

/** Prevents spreadsheet formula injection from user-entered text (names of manual lines etc.). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function shoppingText(model: ExportModel): string {
  const lines = [`Покупки — ${model.title}`];
  let dept = '';
  for (const r of model.shopping) {
    if (r.mark) continue;
    if (r.department !== dept) {
      dept = r.department;
      lines.push('', dept.toUpperCase());
    }
    const qty = r.toBuy !== null ? `${Math.round((r.toBuy + Number.EPSILON) * 100) / 100} ${r.unit}` : '';
    lines.push(`☐ ${r.name}${qty ? ` — ${qty}` : ''}${r.packages ? ` (${r.packages} уп. по ${r.packageSize})` : ''}`);
  }
  return lines.join('\n');
}
