import type { Member, Recipe } from '../engine';
import { ApiError } from './api';
import { GUEST_FORMAT_VERSION, openGuestDb } from './localDb';
import type { GuestDb, GuestHousehold, StoredMenu, StoredWater } from './localDb';
import type { HabitView, OwnPrice, PantryRecord } from './types';
import { NATIVE_BUILD } from '../lib/config';

// Versioned guest backup. The same file is used for «Резервная копия» and for the explicit transfer
// of guest data into an account (POST /households/<id>/import-guest/).

export const EXPORT_FORMAT = 'foodo-guest-export';

export interface GuestExport {
  format: typeof EXPORT_FORMAT;
  format_version: number;
  exported_at: string;
  household: Omit<GuestHousehold, 'id'>;
  members: (Member & { position: number })[];
  menus: { id: string; title: string; is_favorite: boolean; menu: StoredMenu['menu']; shopping_state: StoredMenu['shopping_state']; cooked_batches: string[]; transferred_lines: string[]; created_at: string }[];
  pantry: (PantryRecord & { created_at?: string })[];
  prices: OwnPrice[];
  favorites: string[];
  custom_recipes: Recipe[];
  water: StoredWater[];
  habits: HabitView[];
}

export async function exportGuestData(db?: GuestDb): Promise<GuestExport> {
  const d = db ?? (await openGuestDb());
  const household = ((await d.get('kv', 'household')) as GuestHousehold | undefined) ?? null;
  const { id: _id, ...householdRest } = household ?? { id: 'guest', name: 'Моя семья', settings: undefined, city: null, store_chain_id: null, share_prices: false };
  return {
    format: EXPORT_FORMAT,
    format_version: GUEST_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    household: householdRest as GuestExport['household'],
    members: await d.getAll('members'),
    menus: (await d.getAll('menus')).map((m) => ({
      id: m.id,
      title: m.title,
      is_favorite: m.is_favorite,
      menu: m.menu,
      shopping_state: m.shopping_state,
      cooked_batches: m.cooked_batches,
      transferred_lines: m.transferred_lines,
      created_at: m.created_at,
    })),
    pantry: await d.getAll('pantry'),
    prices: await d.getAll('prices'),
    favorites: ((await d.get('kv', 'favorites')) as string[] | undefined) ?? [],
    custom_recipes: await d.getAll('recipes'),
    water: await d.getAll('water'),
    habits: await d.getAll('habits'),
  };
}

/** Upgrades older export files to the current format (none exist yet besides version 1). */
export function migrateExport(data: unknown): GuestExport {
  if (!data || typeof data !== 'object' || (data as { format?: string }).format !== EXPORT_FORMAT) {
    throw new ApiError('invalid_import', 'Это не файл резервной копии Foodo.', 400);
  }
  const version = (data as { format_version?: number }).format_version;
  if (typeof version !== 'number' || version < 1) throw new ApiError('invalid_import', 'Файл резервной копии повреждён.', 400);
  if (version > GUEST_FORMAT_VERSION) throw new ApiError('unsupported_version', 'Файл создан более новой версией Foodo. Обновите приложение.', 400);
  const d = data as GuestExport;
  for (const key of ['members', 'menus', 'pantry', 'prices', 'favorites', 'custom_recipes', 'water', 'habits'] as const) {
    if (!Array.isArray(d[key])) throw new ApiError('invalid_import', `Раздел «${key}» повреждён.`, 400);
  }
  return d;
}

/**
 * Restores a backup into this browser. «replace» clears guest data first; «merge» keeps existing
 * records and adds those with new ids. Everything happens in one IndexedDB transaction.
 */
export async function importGuestData(raw: unknown, mode: 'replace' | 'merge', db?: GuestDb): Promise<{ members: number; menus: number }> {
  const data = migrateExport(raw);
  const d = db ?? (await openGuestDb());
  const stores = ['kv', 'members', 'menus', 'pantry', 'prices', 'recipes', 'water', 'habits'] as const;
  const tx = d.transaction(stores, 'readwrite');
  if (mode === 'replace') {
    for (const s of stores) if (s !== 'kv') await tx.objectStore(s).clear();
  }
  const kv = tx.objectStore('kv');
  if (mode === 'replace' || !(await kv.get('household'))) await kv.put({ id: 'guest', ...data.household }, 'household');
  const favorites = new Set([...(mode === 'merge' ? (((await kv.get('favorites')) as string[] | undefined) ?? []) : []), ...data.favorites]);
  await kv.put([...favorites], 'favorites');
  let members = 0;
  for (const m of data.members) {
    if (mode === 'merge' && (await tx.objectStore('members').get(m.id))) continue;
    await tx.objectStore('members').put(m);
    members += 1;
  }
  let menus = 0;
  for (const m of data.menus) {
    if (mode === 'merge' && (await tx.objectStore('menus').get(m.id))) continue;
    const now = new Date().toISOString();
    await tx.objectStore('menus').put({
      id: m.id,
      title: m.title ?? '',
      is_favorite: Boolean(m.is_favorite),
      start_date: m.menu.start_date,
      days: m.menu.days,
      revision: m.menu.revision,
      created_at: m.created_at ?? now,
      updated_at: now,
      menu: m.menu,
      shopping_revision: 1,
      cooked_batches: m.cooked_batches ?? [],
      shopping_state: m.shopping_state ?? { manual_lines: [], marks: {}, seen: {} },
      transferred_lines: m.transferred_lines ?? [],
    });
    menus += 1;
  }
  for (const p of data.pantry) await tx.objectStore('pantry').put({ ...p, created_at: p.created_at ?? new Date().toISOString() });
  for (const p of data.prices) await tx.objectStore('prices').put(p);
  for (const r of data.custom_recipes) await tx.objectStore('recipes').put(r);
  for (const w of data.water) await tx.objectStore('water').put(w);
  for (const h of data.habits) await tx.objectStore('habits').put(h);
  await tx.done;
  return { members, menus };
}

export function downloadJson(filename: string, data: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  return downloadBlob(filename, blob);
}

/** Saves a file: a browser download on the web, the system «Сохранить» dialog in the Android app. */
export async function downloadBlob(filename: string, blob: Blob): Promise<void> {
  if (NATIVE_BUILD) {
    const { saveFileNative } = await import('../native/files');
    await saveFileNative(filename, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
