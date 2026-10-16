import { buildCatalog } from '../engine/catalog';
import type { CatalogSources } from '../engine/catalog';
import type { Catalog } from '../engine';
import { STATIC_BUILD, API_BASE } from '../lib/config';
import { cacheGet, cachePut } from './localDb';

export interface BundlePayload {
  version: number | string;
  products: CatalogSources['products']['products'];
  recipes: CatalogSources['recipes']['recipes'];
  reference: CatalogSources['reference'];
  targets: CatalogSources['targets']['sets'];
}

export interface LoadedCatalog {
  catalog: Catalog;
  version: string;
  source: 'server' | 'cache' | 'bundled';
}

function fromBundle(b: BundlePayload): Catalog {
  return buildCatalog({ products: { products: b.products }, recipes: { recipes: b.recipes }, reference: b.reference, targets: { sets: b.targets } });
}

async function bundled(): Promise<LoadedCatalog> {
  const seed = await import('./seed');
  return { catalog: seed.seedCatalog(), version: 'seed', source: 'bundled' };
}

/**
 * Public catalog: from the server (ETag-cached in IndexedDB for offline use) when a Foodo server is
 * present, otherwise the starter data bundled into the static site. Never sends personal data.
 */
export async function loadCatalog(useServer: boolean): Promise<LoadedCatalog> {
  if (STATIC_BUILD || !useServer) return bundled();
  const cached = await cacheGet<BundlePayload>('public', 'catalog-bundle');
  try {
    const response = await fetch(`${API_BASE}/catalog/bundle/`, {
      headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
      credentials: 'omit',
    });
    if (response.status === 304 && cached) return { catalog: fromBundle(cached.data), version: String(cached.data.version), source: 'cache' };
    if (response.ok) {
      const data = (await response.json()) as BundlePayload;
      await cachePut('public', 'catalog-bundle', data, response.headers.get('ETag'));
      return { catalog: fromBundle(data), version: String(data.version), source: 'server' };
    }
  } catch {
    // offline: fall through to the cached copy
  }
  if (cached) return { catalog: fromBundle(cached.data), version: String(cached.data.version), source: 'cache' };
  return bundled();
}

/** Adds the household's private recipes to the public catalog for planning. */
export function withCustomRecipes(catalog: Catalog, recipes: Catalog['recipes'][string][]): Catalog {
  if (recipes.length === 0) return catalog;
  return { ...catalog, recipes: { ...catalog.recipes, ...Object.fromEntries(recipes.map((r) => [r.id, r])) } };
}
