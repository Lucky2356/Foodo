import { deleteDB, openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Member, Recipe } from '../engine';
import type { HabitView, HouseholdView, MenuRecord, OwnPrice, PantryRecord } from './types';
import type { ShoppingState } from '../engine';

// Guest data lives in its own database; account caches use a per-user database that is deleted on
// logout. Schema changes bump DB_VERSION with an upgrade step; data format changes bump
// GUEST_FORMAT_VERSION with a migration in migrateGuestData(). Updating the PWA never deletes data.

export const GUEST_DB = 'foodo-guest';
export const DB_VERSION = 1;
export const GUEST_FORMAT_VERSION = 1;

export interface StoredMenu extends MenuRecord {
  shopping_state: ShoppingState;
  transferred_lines: string[];
  /** Base quantity moved to the pantry per shopping line; absent in menus saved before 0.2.2. */
  transferred_qty?: Record<string, number>;
}

export interface StoredWater {
  id: string;
  member_id: string;
  amount_ml: number;
  local_date: string;
  created_at: string;
}

export type GuestHousehold = Omit<HouseholdView, 'members' | 'role'>;

interface GuestSchema extends DBSchema {
  kv: { key: string; value: unknown };
  members: { key: string; value: Member & { position: number } };
  menus: { key: string; value: StoredMenu };
  pantry: { key: string; value: PantryRecord & { created_at: string } };
  prices: { key: string; value: OwnPrice };
  recipes: { key: string; value: Recipe };
  water: { key: string; value: StoredWater; indexes: { by_member: string } };
  habits: { key: string; value: HabitView };
}

export type GuestDb = IDBPDatabase<GuestSchema>;

let dbPromise: Promise<GuestDb> | null = null;

export function openGuestDb(name = GUEST_DB): Promise<GuestDb> {
  if (name !== GUEST_DB) return open(name);
  dbPromise ??= open(name);
  return dbPromise;
}

function open(name: string): Promise<GuestDb> {
  return openDB<GuestSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('kv');
        db.createObjectStore('members', { keyPath: 'id' });
        db.createObjectStore('menus', { keyPath: 'id' });
        db.createObjectStore('pantry', { keyPath: 'id' });
        db.createObjectStore('prices', { keyPath: 'id' });
        db.createObjectStore('recipes', { keyPath: 'id' });
        const water = db.createObjectStore('water', { keyPath: 'id' });
        water.createIndex('by_member', 'member_id');
        db.createObjectStore('habits', { keyPath: 'id' });
      }
    },
  }).then(async (db) => {
    await migrateGuestData(db);
    return db;
  });
}

/** Data-level migrations between guest format versions (structure stays in upgrade()). */
export async function migrateGuestData(db: GuestDb): Promise<void> {
  const version = ((await db.get('kv', 'format_version')) as number | undefined) ?? 0;
  if (version >= GUEST_FORMAT_VERSION) return;
  // v0 → v1: nothing to transform; the marker records that the data uses format 1.
  await db.put('kv', GUEST_FORMAT_VERSION, 'format_version');
}

/** Closes the cached connection (the data stays); the next openGuestDb() reconnects. */
export async function closeGuestDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function resetGuestDbForTests(name = GUEST_DB): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await deleteDB(name);
}

/** Small key/value cache for public data (catalog bundle) and per-account read-only offline copies. */
interface CacheSchema extends DBSchema {
  entries: { key: string; value: { key: string; etag: string | null; saved_at: string; data: unknown } };
}

export function cacheDbName(scope: string): string {
  return `foodo-cache-${scope}`;
}

export async function cacheGet<T>(scope: string, key: string): Promise<{ etag: string | null; data: T } | null> {
  try {
    const db = await openDB<CacheSchema>(cacheDbName(scope), 1, { upgrade: (d) => void d.createObjectStore('entries', { keyPath: 'key' }) });
    const row = await db.get('entries', key);
    db.close();
    return row ? { etag: row.etag, data: row.data as T } : null;
  } catch {
    return null;
  }
}

export async function cachePut(scope: string, key: string, data: unknown, etag: string | null = null): Promise<void> {
  try {
    const db = await openDB<CacheSchema>(cacheDbName(scope), 1, { upgrade: (d) => void d.createObjectStore('entries', { keyPath: 'key' }) });
    await db.put('entries', { key, etag, saved_at: new Date().toISOString(), data });
    db.close();
  } catch {
    // A full or blocked cache only disables offline reading; it never blocks the online action.
  }
}

export async function dropCache(scope: string): Promise<void> {
  await deleteDB(cacheDbName(scope));
}
