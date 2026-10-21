import { Link } from 'react-router-dom';
import { useApp } from '../state/app';
import { useFullCatalog } from '../state/catalog';
import { Icon } from '../ui/icons';
import { Empty, PageHead } from '../ui/kit';
import { RecipeCard } from './RecipesPage';

export default function FavoritesPage() {
  const { favorites } = useApp();
  // Own recipes can be favourites too, so look them up in the catalogue that includes them.
  const { catalog, custom } = useFullCatalog();
  const list = [...favorites].map((id) => catalog.recipes[id]).filter((r): r is NonNullable<typeof r> => Boolean(r));
  return (
    <div className="stack" style={{ ['--gap' as string]: '18px' }}>
      <PageHead eyebrow="Коллекция" title="Избранное" actions={<Link className="btn ghost" to="/recipes/new"><Icon name="plus" size={18} /> Свой рецепт</Link>} />
      {list.length === 0 ? (
        <Empty icon="heart" title="Здесь будут любимые блюда" action={<Link className="btn primary" to="/recipes">К рецептам</Link>}>
          Нажмите на сердечко у рецепта, чтобы сохранить его.
        </Empty>
      ) : (
        <div className="grid recipe-list">
          {list.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
      {custom.length > 0 && (
        <section className="stack">
          <h2>Мои рецепты</h2>
          <p className="muted small">Видны только вам и участвуют в подборе меню.</p>
          <div className="grid recipe-list">
            {custom.map((r) => (
              <RecipeCard key={r.id} recipe={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
