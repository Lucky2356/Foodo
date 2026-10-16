import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCatalog } from '../seed';
import { GuestGateway } from '../guestGateway';
import { closeGuestDb, resetGuestDbForTests } from '../localDb';
import { exportGuestData, importGuestData, migrateExport } from '../backup';

const catalog = seedCatalog();

function gateway(useServer = false) {
  return new GuestGateway(() => catalog, useServer);
}

beforeEach(async () => {
  await resetGuestDbForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function family(g: GuestGateway) {
  await g.addMember({ name: 'Аня', portion_mode: 'simple', portion_factor: 1 });
  await g.addMember({ name: 'Борис', portion_mode: 'simple', portion_factor: 1.25 });
}

describe('guest storage', () => {
  it('keeps the family, menu and shopping after a «reload» (new gateway, reopened DB) (check 1)', async () => {
    const g = gateway();
    await family(g);
    const record = await g.generateMenu({ start_date: '2026-10-19', days: 7, seed: 42 });
    expect(record.menu.meals).toHaveLength(28);
    const shopping = await g.getShopping(record.id);
    await g.patchShopping(record.id, { marks: { [shopping.lines[0]!.id]: { purchased: true } } }, shopping.shopping_revision);

    // Simulate a page reload: close the cached connection and build a fresh gateway.
    await closeGuestDb();
    const reloaded = gateway();
    const household = await reloaded.getHousehold();
    expect(household.members.map((m) => m.name)).toEqual(['Аня', 'Борис']);
    const again = await reloaded.getMenu(record.id);
    expect(again.menu).toEqual(record.menu);
    const list = await reloaded.getShopping(record.id);
    expect(list.lines[0]!.purchased).toBe(true);
  });

  it('exports and imports a versioned JSON backup without loss (check 14)', async () => {
    const g = gateway();
    await family(g);
    const record = await g.generateMenu({ start_date: '2026-10-19', days: 3, seed: 7 });
    await g.addPantry({ product_id: 'potato', qty: 300, unit: 'g', location: 'Кладовая', expires: null });
    await g.addPrices([{ product_id: 'potato', price_kop: 9000, package_size: 2, package_unit: 'kg' }]);
    await g.setFavorite('borshch-s-govyadinoy', true);
    const members = (await g.getHousehold()).members;
    await g.addWater(members[0]!.id, 250);
    const habit = await g.addHabit(members[1]!.id, 'Зарядка');
    await g.markHabit(habit.id, '2026-10-16', true);

    const backup = JSON.parse(JSON.stringify(await exportGuestData()));
    expect(backup.format).toBe('foodo-guest-export');
    expect(backup.format_version).toBe(1);

    await resetGuestDbForTests();
    const empty = gateway();
    expect((await empty.getHousehold()).members).toEqual([]);
    await importGuestData(backup, 'replace');
    const restored = JSON.parse(JSON.stringify(await exportGuestData()));
    const strip = (d: typeof backup) => ({ ...d, exported_at: null });
    expect(strip(restored)).toEqual(strip(backup));
    expect((await empty.getMenu(record.id)).menu).toEqual(record.menu);
  });

  it('rejects foreign files and newer formats', () => {
    expect(() => migrateExport({ format: 'something' })).toThrow(/не файл/);
    expect(() => migrateExport({ format: 'foodo-guest-export', format_version: 99, members: [] })).toThrow(/более новой/);
  });

  it('marking a dish cooked twice deducts the pantry only once (check 13)', async () => {
    const g = gateway();
    await g.addMember({ name: 'Аня' });
    await g.updateHousehold({ settings: { ...(await g.getHousehold()).settings, slots: ['lunch'] } });
    const record = await g.generateMenu({ start_date: '2026-10-19', days: 1, seed: 1 });
    const line = (await g.getShopping(record.id)).lines.find((l) => l.convertible && l.unit === 'g')!;
    await g.addPantry({ product_id: line.product_id, qty: line.needed * 3, unit: 'g', location: null, expires: null });
    const batch = record.menu.batches[0]!.id;
    const [a, b] = await Promise.all([g.cook(record.id, batch), g.cook(record.id, batch)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const left = (await g.listPantry()).find((p) => p.product_id === line.product_id)!;
    expect(left.qty).toBeCloseTo(line.needed * 2, 6);
    // Transferring purchases is also idempotent.
    await g.patchShopping(record.id, { marks: {} }, null);
    const target = (await g.getShopping(record.id)).lines.find((l) => l.to_buy > 0 && l.convertible);
    if (target) {
      expect((await g.transferPurchases(record.id, [target.id])).added).toEqual([target.id]);
      expect((await g.transferPurchases(record.id, [target.id])).skipped).toEqual([target.id]);
    }
  });

  it('never sends profiles or restrictions to the network while planning (check 18)', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ?? null });
      return new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const g = gateway(true);
    await g.addMember({ name: 'Секретная Аня', age: 31, weight_kg: 58, restrictions: { products: ['beef'], categories: [], allergens: ['milk'] } });
    await g.updateHousehold({ city_id: '1600000100000', store_chain_id: 'magnit' });
    const record = await g.generateMenu({ start_date: '2026-10-19', days: 2, seed: 3 });
    await g.getShopping(record.id);
    for (const c of calls) {
      expect(c.body).toBeNull();
      expect(c.url).not.toMatch(/Аня|beef|milk|58|31/);
      expect(c.url).toMatch(/prices\/public\/\?city=1600000100000&chain=magnit$/);
    }
    vi.unstubAllGlobals();
  });

  it('refuses invalid data at the storage boundary', async () => {
    const g = gateway();
    await expect(g.addMember({ name: '' })).rejects.toThrow(/Имя/);
    await expect(g.addMember({ name: 'Миша', age: 9, portion_mode: 'target', goal: 'lose', kcal_target: 1500 })).rejects.toThrow(/несовершеннолетних/);
    await expect(g.addPantry({ product_id: 'potato', qty: 0, unit: 'g', location: null, expires: null })).rejects.toThrow(/положительное/);
    await g.addMember({ name: 'Аня' });
    await expect(g.addWater((await g.getHousehold()).members[0]!.id, 0)).rejects.toThrow(/Объём/);
  });
});
