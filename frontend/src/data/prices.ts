import type { PriceEntry } from '../engine';
import { API_BASE } from '../lib/config';

/** One entry per product: the household's own prices always beat public sources (any date). */
export function mergePriceSources(own: PriceEntry[], publicEntries: PriceEntry[]): PriceEntry[] {
  const result = new Map<string, PriceEntry>();
  for (const e of publicEntries) result.set(e.product_id, e);
  const latestOwn = new Map<string, PriceEntry>();
  for (const e of own) {
    const current = latestOwn.get(e.product_id);
    if (!current || e.date >= current.date) latestOwn.set(e.product_id, e);
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
    const chainFile = chainId ? index.files[`${cityId}:${chainId}`] : undefined;
    const regionFile = region ? index.files[`region:${region}`] : undefined;
    for (const file of [regionFile, chainFile]) {
      if (!file) continue;
      const data = await fetch(`data/prices/${file}`).then((x) => (x.ok ? x.json() : { entries: [] }));
      out.push(...((data as { entries: PriceEntry[] }).entries ?? []));
    }
    // Chain entries (read last) replace regional averages for the same product.
    const byProduct = new Map<string, PriceEntry>();
    for (const e of out) byProduct.set(e.product_id, e);
    return [...byProduct.values()];
  } catch {
    return [];
  }
}
