import { UNIT_NAMES, approxPieces } from '../engine';
import type { Member } from '../engine';
import type { MenuRecord, ShoppingView } from '../data/types';
import { SLOT_NAMES } from '../lib/recipes';
import { dayMonth, deviceTimeZone, localDate, weekdayLong } from '../lib/dates';
import { buyAmount, num, plural, quantity, rub } from '../lib/format';

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
  /** «1,5 кг» — the amount to buy for printed and shared lists. */
  toBuyText: string;
  unit: string;
  packages: number | null;
  packageSize: string;
  pricePerPackageRub: number | null;
  /** What the price is paid for: «900 г», «1 кг». */
  priceFor: string;
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
  /** Local date on the device, «2026-10-23» — not the UTC date, which is a day off around midnight. */
  generatedOn: string;
  menu: MenuRow[];
  shopping: ShoppingRow[];
  cooking: CookRow[];
  totals: { purchaseRub: number | null; purchaseText: string; complete: boolean; budget: string };
}

/** Quantities in files keep two decimals at most; the screen shows the same rounding. */
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const single = (p: { size: number; unit: string }) => p.unit === 'pcs' && p.size === 1;

const unitName = (u: string) => (UNIT_NAMES as Record<string, string>)[u] ?? u;

/** « (≈ 2 шт.)» for a loose product bought by weight whose mass of one piece is known. */
function piecesNote(l: ShoppingView['lines'][number], product: Parameters<typeof approxPieces>[0]): string {
  if (l.package || l.unit !== 'g') return '';
  const pieces = approxPieces(product, l.to_buy);
  return pieces ? ` (≈ ${pieces} шт.)` : '';
}

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
          .map(([id, f]) => `${name(id)} — ${num(f, 2)}`)
          .join(', '),
        portions: round2(Object.values(item.portions).reduce((a, b2) => a + b2, 0)),
      });
    }
    if (meal.items.length === 0) rows.push({ date: meal.date, weekday: weekdayLong(meal.date), slot: SLOT_NAMES[meal.slot] ?? meal.slot, dish: 'нет подходящего блюда', who: '', portions: 0 });
  }
  const shoppingRows: ShoppingRow[] = [];
  for (const l of shopping?.lines ?? []) {
    shoppingRows.push({
      department: l.department,
      name: l.name,
      needed: round2(l.needed),
      fromPantry: round2(l.from_pantry),
      toBuy: round2(l.at_home ? 0 : buyAmount(l.to_buy, l.unit)),
      toBuyText: l.at_home ? 'есть дома' : l.to_buy === 0 ? 'всё есть дома' : quantity(buyAmount(l.to_buy, l.unit), l.unit) + piecesNote(l, menu.snapshot.products[l.product_id]),
      unit: unitName(l.unit),
      // Pieces sold one by one are not «packages of 1 pcs»: the amount to buy already says it.
      packages: l.package && !single(l.package) ? l.package.count : null,
      packageSize: l.package && !single(l.package) ? quantity(l.package.size, l.package.unit) : '',
      pricePerPackageRub: l.price_kop !== null ? l.price_kop / 100 : null,
      priceFor: l.price_per ? quantity(l.price_per.size, l.price_per.unit) : '',
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
      toBuyText: m.qty !== null ? `${num(m.qty, 2)} ${m.unit ?? ''}`.trim() : '',
      unit: m.unit ?? '',
      packages: null,
      packageSize: '',
      pricePerPackageRub: null,
      priceFor: '',
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
        .map((m) => `${dayMonth(m.date)}, ${(SLOT_NAMES[m.slot] ?? m.slot).toLowerCase()}`)
        .join('; ');
      return { date: b.cook_date, dish: r?.name ?? '—', method: method?.name ?? '', portions: round2(b.portions), totalMin: method?.total_min ?? null, feeds };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const budget = shopping?.budget;
  const knownTotal = (shopping?.lines ?? []).some((l) => l.purchase_cost_kop !== null) || (shopping?.manual_lines ?? []).some((l) => l.price_kop !== null);
  const budgetText = !budget || budget.status === 'none' ? 'бюджет не задан' : budget.status === 'ok' ? 'укладывается в бюджет' + (budget.estimated ? ' (по оценочным ценам)' : '') : budget.status === 'exceeded' ? 'превышает бюджет' : 'бюджет не подтверждён: известны не все цены';
  return {
    title: record.title || `Меню с ${dayMonth(menu.start_date)} на ${menu.days} ${plural(menu.days, 'день', 'дня', 'дней')}`,
    generatedOn: localDate(deviceTimeZone()),
    menu: rows,
    shopping: shoppingRows,
    cooking,
    totals: {
      // Without a single known price the total is unknown, not «0 ₽».
      purchaseRub: knownTotal ? (shopping?.totals.purchase_kop ?? 0) / 100 : null,
      purchaseText: knownTotal ? rub(shopping?.totals.purchase_kop ?? 0) : '—',
      complete: shopping?.totals.complete ?? false,
      budget: budgetText,
    },
  };
}

/** Prevents spreadsheet formula injection from user-entered text (names of manual lines etc.). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function shoppingText(model: ExportModel): string {
  const lines = [`Покупки — ${model.title}`];
  let dept = '';
  for (const r of toBuyRows(model)) {
    if (r.mark) continue;
    if (r.department !== dept) {
      dept = r.department;
      lines.push('', dept.toUpperCase());
    }
    lines.push(`☐ ${r.name}${r.toBuyText ? ` — ${r.toBuyText}` : ''}${r.packages ? ` (${r.packages} уп. по ${r.packageSize})` : ''}`);
  }
  return lines.join('\n');
}

/** Rows that still need buying: lines fully covered at home stay out of printed and shared lists. */
export function toBuyRows(model: ExportModel): ShoppingRow[] {
  return model.shopping.filter((r) => r.toBuy !== 0);
}
