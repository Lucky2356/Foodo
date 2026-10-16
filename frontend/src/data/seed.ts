import products from '../../../shared/data/products.json';
import recipes from '../../../shared/data/recipes.json';
import reference from '../../../shared/data/reference.json';
import targets from '../../../shared/data/nutrient_targets.json';
import articles from '../../../shared/data/articles.json';
import { buildCatalog } from '../engine/catalog';
import type { CatalogSources } from '../engine/catalog';
import type { Catalog } from '../engine/types';

export interface Article {
  id: string;
  title: string;
  category: string;
  category_name: string;
  published: string;
  summary: string;
  body: string;
}

/** Bundled starter data (shared/data). Used by the static site and as the offline fallback. */
export const seedSources = { products, recipes, reference, targets } as unknown as CatalogSources;

export function seedCatalog(): Catalog {
  return buildCatalog(structuredClone(seedSources));
}

export const seedArticles = (articles as { articles: Article[] }).articles;
