import type { PriceEntry } from '../engine';
import { API_BASE } from '../lib/config';

/**
 * One entry per product: the household's own prices always beat public sources (any date). Among
 * own prices the newest wins; on the same date a price for the chosen chain beats one for any shop.
 */
export function mergePriceSources(own: (PriceEntry & { chain_id?: string | null })[], publicEntries: PriceEntry[]): PriceEntry[] {
  const result = new Map<string, PriceEntry>();
  for (const e of publicEntries) result.set(e.product_id, e);
  const latestOwn = new Map<string, PriceEntry & { chain_id?: string | null }>();
  const rank = (e: { date: string; chain_id?: string | null }) => `${e.date}|${e.chain_id ? 1 : 0}`;
  for (const e of own) {
    const current = latestOwn.get(e.product_id);
    if (!current || rank(e) >= rank(current)) latestOwn.set(e.product_id, e);
  }
  for (const [k, v] of latestOwn) result.set(k, v);
  return [...result.keys()].sort().map((k) => result.get(k) as PriceEntry);
}

/**
 * Public prices for a city and chain. Only the city and chain ids leave the device. On the static
 * site the published price dataset (built by the price workflow) is read from the site itself.
 */
export async function fetchPublicPrices(cityId: string, chainId: string | null, useServer: boolean, region: string | null): Promise<PriceEntry[]> {
  try {
    if (useServer) {
      const qs = new URLSearchParams({ city: cityId, ...(chainId ? { chain: chainId } : {}) });
      const r = await fetch(`${API_BASE}/prices/public/?${qs}`, { credentials: 'omit' });
      if (r.ok) return ((await r.json()) as { entries: PriceEntry[] }).entries;
      return [];
    }
    const r = await fetch(`data/prices/index.json`, { cache: 'no-cache' });
    if (!r.ok) return [];
    const index = (await r.json()) as { files: Record<string, string> };
    const out: PriceEntry[] = [];
    // Least to most specific: the region's Rosstat average, the city's own Rosstat average, then the
    // chain's prices in the city. Later files replace earlier ones for the same product.
    const keys = [region ? `region:${region}` : null, `city:${cityId}`, chainId ? `${cityId}:${chainId}` : null];
    for (const key of keys) {
      const file = key ? index.files[key] : undefined;
      if (!file) continue;
      const data = await fetch(`data/prices/${file}`).then((x) => (x.ok ? x.json() : { entries: [] }));
      out.push(...((data as { entries: PriceEntry[] }).entries ?? []));
    }
    const byProduct = new Map<string, PriceEntry>();
    for (const e of out) byProduct.set(e.product_id, e);
    return [...byProduct.values()];
  } catch {
    // No published prices (offline, not yet collected): the shopping list then shows the budget as
    // «не подтверждён» rather than inventing prices.
    return [];
  }
}

export interface PriceSourceStatus {
  name?: string;
  ok?: boolean;
  updated_at?: string;
  checked_at?: string;
  error?: string;
  collected?: boolean;
  reachable?: boolean;
  reason?: string;
  period?: string;
  city?: string;
  products?: number;
  observations?: number;
}

/** What the price workflow last collected (published with the static site), or null if unknown. */
export async function fetchPriceSourcesStatus(): Promise<Record<string, PriceSourceStatus> | null> {
  try {
    const r = await fetch(`data/prices/index.json`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const index = (await r.json()) as { status?: { sources?: Record<string, PriceSourceStatus> } | null };
    return index.status?.sources ?? null;
  } catch {
    // Offline or a server build without published files: the block is simply not shown.
    return null;
  }
}
