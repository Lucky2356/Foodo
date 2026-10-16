// Cross-language parity: the TypeScript engine (guest mode) and the Python engine (account mode)
// must produce identical results for shared/fixtures/engine/cases.json. This test checks the
// TypeScript side against the committed expected files; backend/engine/tests/test_parity.py checks
// the Python side against the same files. Regenerate with `npm run fixtures:write` after an
// intentional algorithm change and commit both the code and the fixtures.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../data/seed';
import { generateMenu } from '../generator';
import { applyMenuOp } from '../menuOps';
import type { MenuOp } from '../menuOps';
import { recipeNutrition } from '../nutrition';
import { menuReport } from '../report';
import { computeShopping, emptyShoppingState } from '../shopping';
import type { ShoppingState } from '../shopping';
import { EngineError } from '../types';
import type { Menu, PlanRequest } from '../types';
import { Rng } from '../basics';

const dir = fileURLToPath(new URL('../../../../shared/fixtures/engine/', import.meta.url));
const write = process.env.FOODO_WRITE_FIXTURES === '1';

interface Case {
  id: string;
  request: PlanRequest;
  shopping_state?: ShoppingState;
  ops: (MenuOp & { item_id?: string })[];
}

function resolveItem(menu: Menu, placeholder: string): string {
  const meals = menu.meals.filter((m) => m.items.length > 0);
  if (placeholder === 'FIRST_DINNER') return meals.find((m) => m.slot === 'dinner')?.items[0]?.id ?? 'missing';
  if (placeholder === 'FIRST_LUNCH') return meals.find((m) => m.slot === 'lunch')?.items[0]?.id ?? 'missing';
  if (placeholder === 'FIRST_SHARED') {
    for (const m of meals) for (const i of m.items) if (Object.keys(i.portions).length > 1) return i.id;
    return 'missing';
  }
  return placeholder;
}

/** Menu without the bulky snapshot; the snapshot is represented by its sorted ids. */
export function comparableMenu(menu: Menu): Record<string, unknown> {
  const { snapshot, ...rest } = menu;
  return { ...rest, snapshot_ids: { recipes: Object.keys(snapshot.recipes).sort(), products: Object.keys(snapshot.products).sort() } };
}

function runCase(c: Case): Record<string, unknown> {
  const catalog = seedCatalog();
  const req = c.request;
  const { menu } = generateMenu(req, catalog);
  const state = c.shopping_state ?? emptyShoppingState();
  const shopping = computeShopping(menu, catalog, req.pantry ?? [], req.prices ?? null, state);
  const report = menuReport(menu, catalog, req.members);
  const ops: unknown[] = [];
  let current = menu;
  for (const raw of c.ops) {
    const op = { ...raw } as MenuOp & { item_id?: string };
    if (op.item_id) op.item_id = resolveItem(current, op.item_id);
    try {
      current = applyMenuOp(current, op, { catalog, members: req.members, pantry: req.pantry ?? [], prices: req.prices ?? null });
      ops.push({ op: op.op, menu: comparableMenu(current), shopping_totals: computeShopping(current, catalog, req.pantry ?? [], req.prices ?? null, state).totals });
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      ops.push({ op: op.op, error: e.code });
    }
  }
  return { menu: comparableMenu(menu), shopping, report, ops };
}

const cases = (JSON.parse(readFileSync(`${dir}cases.json`, 'utf8')) as { cases: Case[] }).cases;

describe('engine parity fixtures', () => {
  for (const c of cases) {
    it(c.id, () => {
      const result = JSON.parse(JSON.stringify(runCase(c)));
      const file = `${dir}expected/${c.id}.json`;
      if (write || !existsSync(file)) {
        if (!write) throw new Error(`Нет ожидаемого файла ${file}. Запустите npm run fixtures:write.`);
        writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
      }
      const expected = JSON.parse(readFileSync(file, 'utf8'));
      expect(result).toEqual(expected);
    });
  }

  it('basic primitives', () => {
    const catalog = seedCatalog();
    const rng = new Rng(20261016);
    const sequence = Array.from({ length: 20 }, () => rng.next());
    const nutrition = ['ovsyanka-s-yablokom', 'pirog-s-kapustoy', 'oladi-na-kefire', 'borshch-s-govyadinoy'].map((id) => ({
      id,
      one: recipeNutrition(catalog, catalog.recipes[id]!, 1),
      two: recipeNutrition(catalog, catalog.recipes[id]!, 2),
    }));
    const result = JSON.parse(JSON.stringify({ sequence, nutrition }));
    const file = `${dir}expected/primitives.json`;
    if (write) writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
    expect(result).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });
});
