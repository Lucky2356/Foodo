import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { effectiveRestrictions, productClosure, recipeSpice } from '../engine';
import type { Recipe } from '../engine';
import { useApp } from '../state/app';
import { useFullCatalog } from '../state/catalog';
import { Icon } from '../ui/icons';
import { Chip, Empty, PageHead, RecipeCover, Sheet, Switch } from '../ui/kit';
import { kcal, minutes } from '../lib/format';
import { CATEGORY_NAMES, matchesSearch, QUICK_EXCLUSIONS, searchTokens, SKILL_NAMES, summarize } from '../lib/recipes';

const PAGE = 24;

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const { catalog, favorites, toggleFavorite } = useApp();
  const s = summarize(catalog, recipe);
  const fav = favorites.has(recipe.id);
  return (
    <article className="card recipe-card card-link" style={{ position: 'relative' }}>
      <Link to={`/recipes/${recipe.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'contents' }}>
        <div className="cover">
          <RecipeCover recipe={recipe} />
        </div>
        <div className="body">
          <span className="muted tiny" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
            {recipe.visibility === 'private' ? 'Мой рецепт' : (CATEGORY_NAMES[recipe.category] ?? recipe.category)}
          </span>
          <h3>{recipe.name}</h3>
          <div className="meta">
            <span>
              <Icon name="clock" size={15} />
              {minutes(s.totalMin)}
            </span>
            <span>
              <Icon name="flame" size={15} />
              {kcal(s.perServing.kcal.value)}
            </span>
            {s.skillRank !== null && <span>{SKILL_NAMES[s.skillRank]}</span>}
          </div>
        </div>
      </Link>
      <button
        className={`icon-btn ${fav ? 'active' : ''}`}
        style={{ position: 'absolute', top: 8, right: 8, background: 'color-mix(in srgb, var(--surface) 85%, transparent)' }}
        aria-pressed={fav}
        aria-label={fav ? `Убрать из избранного: ${recipe.name}` : `В избранное: ${recipe.name}`}
        onClick={() => void toggleFavorite(recipe.id)}
      >
        <Icon name="heart" fill={fav ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}

export default function RecipesPage() {
  const { household } = useApp();
  // Own recipes are listed together with the public ones (marked «Мой рецепт»).
  const { catalog } = useFullCatalog();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [category, setCategory] = useState<string | null>(null);
  const [maxTime, setMaxTime] = useState<number | null>(null);
  const [familyBans, setFamilyBans] = useState(true);
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [onlyMyKitchen, setOnlyMyKitchen] = useState(false);
  const [dietType, setDietType] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [kidsOnly, setKidsOnly] = useState(false);
  const [mildOnly, setMildOnly] = useState(false);
  const [sort, setSort] = useState<'name' | 'time' | 'kcal'>('name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const familyRestrictions = useMemo(() => {
    const products = new Set<string>();
    const categories = new Set<string>();
    const allergens = new Set<string>();
    for (const m of household?.members ?? []) {
      // Diet types (vegetarian, gluten-free…) count as the member's bans too.
      const r = effectiveRestrictions(catalog, m);
      r.products.forEach((x) => products.add(x));
      r.categories.forEach((x) => categories.add(x));
      r.allergens.forEach((x) => allergens.add(x));
    }
    return { products, categories, allergens };
  }, [household, catalog]);

  const results = useMemo(() => {
    const tokens = searchTokens(deferred);
    const bans = { products: new Set<string>(), categories: new Set<string>(), allergens: new Set<string>() };
    if (familyBans) {
      familyRestrictions.products.forEach((x) => bans.products.add(x));
      familyRestrictions.categories.forEach((x) => bans.categories.add(x));
      familyRestrictions.allergens.forEach((x) => bans.allergens.add(x));
    }
    const diet = dietType ? catalog.reference.diet_types?.find((t) => t.id === dietType) : undefined;
    diet?.products.forEach((x) => bans.products.add(x));
    diet?.categories.forEach((x) => bans.categories.add(x));
    diet?.allergens.forEach((x) => bans.allergens.add(x));
    for (const id of extra) {
      const qx = QUICK_EXCLUSIONS.find((x) => x.id === id);
      qx?.categories?.forEach((c) => bans.categories.add(c));
      qx?.allergens?.forEach((a) => bans.allergens.add(a));
    }
    const equipment = new Set(household?.settings.plan.equipment ?? []);
    const list = Object.values(catalog.recipes).filter((r) => {
      if (category && r.category !== category) return false;
      if (cuisine && r.cuisine !== cuisine) return false;
      if (kidsOnly && !r.kid_friendly) return false;
      if (mildOnly && recipeSpice(r) > 0) return false;
      const s = summarize(catalog, r);
      if (maxTime !== null && s.totalMin > maxTime) return false;
      if (onlyMyKitchen && !r.methods.some((m) => m.equipment.every((e) => equipment.has(e)))) return false;
      if (tokens.length > 0 && !matchesSearch(`${r.name} ${r.ingredients.map((i) => catalog.products[i.product]?.name ?? '').join(' ')}`, tokens)) return false;
      if (bans.products.size + bans.categories.size + bans.allergens.size > 0) {
        for (const ing of r.ingredients) {
          const c = productClosure(catalog, ing.product);
          if ([...c.productIds].some((p) => bans.products.has(p)) || [...c.categories].some((x) => bans.categories.has(x)) || [...c.allergens].some((a) => bans.allergens.has(a))) return false;
          if (!c.compositionKnown) return false;
        }
      }
      return true;
    });
    list.sort((a, b) => {
      if (sort === 'time') return summarize(catalog, a).totalMin - summarize(catalog, b).totalMin || a.name.localeCompare(b.name, 'ru');
      if (sort === 'kcal') return summarize(catalog, a).perServing.kcal.value - summarize(catalog, b).perServing.kcal.value;
      return a.name.localeCompare(b.name, 'ru');
    });
    return list;
  }, [catalog, deferred, category, maxTime, familyBans, familyRestrictions, extra, onlyMyKitchen, sort, household, dietType, cuisine, kidsOnly, mildOnly]);

  const activeFilters = (maxTime !== null ? 1 : 0) + extra.size + (onlyMyKitchen ? 1 : 0) + (dietType ? 1 : 0) + (cuisine ? 1 : 0) + (kidsOnly ? 1 : 0) + (mildOnly ? 1 : 0);
  const hasFamilyBans = familyRestrictions.products.size + familyRestrictions.categories.size + familyRestrictions.allergens.size > 0;

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <PageHead
        eyebrow="Каталог"
        title="Рецепты"
        subtitle={`${Object.values(catalog.recipes).filter((r) => r.visibility !== 'private').length} блюд с шагами, КБЖУ и граммовками`}
        actions={
          <Link className="btn ghost" to="/recipes/new">
            <Icon name="plus" size={18} /> Свой рецепт
          </Link>
        }
      />
      <div className="row">
        <label className="search grow">
          <span className="visually-hidden">Поиск по названию и ингредиентам</span>
          <Icon name="search" size={20} />
          <input
            className="input"
            type="search"
            placeholder="Блюдо или продукт"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        <button className="btn ghost" style={{ minHeight: 50 }} onClick={() => setFiltersOpen(true)}>
          <Icon name="settings" size={18} />
          <span>Фильтры{activeFilters > 0 ? ` · ${activeFilters}` : ''}</span>
        </button>
      </div>
      <div className="chips" role="group" aria-label="Категории">
        <Chip on={category === null} onClick={() => setCategory(null)}>
          Все
        </Chip>
        {Object.entries(CATEGORY_NAMES).map(([id, name]) => (
          <Chip key={id} on={category === id} onClick={() => setCategory(category === id ? null : id)}>
            {name}
          </Chip>
        ))}
      </div>
      {hasFamilyBans && familyBans && (
        <p className="muted small">
          Скрыты блюда с запретами вашей семьи.{' '}
          <button className="btn small ghost" onClick={() => setFamilyBans(false)}>
            Показать все
          </button>
        </p>
      )}
      {results.length === 0 ? (
        <Empty icon="search" title="Ничего не нашлось">
          Попробуйте другое слово или ослабьте фильтры.
        </Empty>
      ) : (
        <div className="grid recipe-list">
          {results.slice(0, limit).map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
      {results.length > limit && (
        <button className="btn ghost big" onClick={() => setLimit((l) => l + PAGE)}>
          Показать ещё ({results.length - limit})
        </button>
      )}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Фильтры"
        footer={
          <>
            <button
              className="btn ghost"
              onClick={() => {
                setMaxTime(null);
                setExtra(new Set());
                setOnlyMyKitchen(false);
                setDietType(null);
                setCuisine(null);
                setKidsOnly(false);
                setMildOnly(false);
                setSort('name');
              }}
            >
              Сбросить
            </button>
            <button className="btn primary" onClick={() => setFiltersOpen(false)}>
              Показать {results.length}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Время приготовления</span>
            <div className="chips">
              {[null, 15, 30, 45, 60].map((t) => (
                <Chip key={String(t)} on={maxTime === t} onClick={() => setMaxTime(t)}>
                  {t === null ? 'Любое' : `до ${t} мин`}
                </Chip>
              ))}
            </div>
          </div>
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Тип питания</span>
            <div className="chips">
              {(catalog.reference.diet_types ?? []).map((t) => (
                <Chip key={t.id} on={dietType === t.id} onClick={() => setDietType(dietType === t.id ? null : t.id)}>
                  {t.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Кухня</span>
            <div className="chips">
              {(catalog.reference.cuisines ?? []).map((c) => (
                <Chip key={c.id} on={cuisine === c.id} onClick={() => setCuisine(cuisine === c.id ? null : c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>
          <Switch checked={kidsOnly} onChange={setKidsOnly} label="Подходит детям" />
          <Switch checked={mildOnly} onChange={setMildOnly} label="Без остроты" />
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Исключить</span>
            <div className="chips">
              {QUICK_EXCLUSIONS.map((q) => (
                <Chip
                  key={q.id}
                  tone="ban"
                  on={extra.has(q.id)}
                  onClick={() =>
                    setExtra((s) => {
                      const n = new Set(s);
                      if (n.has(q.id)) n.delete(q.id);
                      else n.add(q.id);
                      return n;
                    })
                  }
                >
                  {q.label}
                </Chip>
              ))}
            </div>
          </div>
          {hasFamilyBans && <Switch checked={familyBans} onChange={setFamilyBans} label="Учитывать запреты семьи" />}
          <Switch checked={onlyMyKitchen} onChange={setOnlyMyKitchen} label="Только для моей техники" hint="По настройкам кухни" />
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Сортировка</span>
            <div className="chips">
              <Chip on={sort === 'name'} onClick={() => setSort('name')}>
                По названию
              </Chip>
              <Chip on={sort === 'time'} onClick={() => setSort('time')}>
                Быстрые сначала
              </Chip>
              <Chip on={sort === 'kcal'} onClick={() => setSort('kcal')}>
                Лёгкие сначала
              </Chip>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
