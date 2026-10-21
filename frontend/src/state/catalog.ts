import { useMemo } from 'react';
import type { Catalog, Recipe } from '../engine';
import { withCustomRecipes } from '../data/catalogSource';
import { useApp, useLoad } from './app';

const NONE: Recipe[] = [];

/**
 * The public catalogue plus this household's private recipes. Private recipes live in the gateway
 * (IndexedDB or the account), not in the bundled catalogue, so every screen that lists or opens
 * recipes reads them through this hook.
 */
export function useFullCatalog(): { catalog: Catalog; custom: Recipe[]; loading: boolean } {
  const { catalog: base, gateway } = useApp();
  const loaded = useLoad(() => gateway.listCustomRecipes(), [gateway]);
  const custom = loaded.data ?? NONE;
  const catalog = useMemo(() => withCustomRecipes(base, custom), [base, custom]);
  return { catalog, custom, loading: loaded.loading };
}
