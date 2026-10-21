import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { availableDisplayUnits, UNIT_NAMES } from '../engine';
import type { Catalog, Ingredient, Recipe, RecipeUnit } from '../engine';
import { useApp } from '../state/app';
import { useFullCatalog } from '../state/catalog';
import { Icon } from '../ui/icons';
import { Banner, Chip, Empty, Field, Loading, NumberInput, PageHead, Segmented, Stepper, Switch } from '../ui/kit';
import { ProductPicker } from '../ui/ProductPicker';
import { CATEGORY_NAMES, SLOT_NAMES } from '../lib/recipes';
import { customRecipeErrors } from '../lib/recipeValidation';

const EQUIPMENT = ['stove', 'oven', 'microwave', 'multicooker', 'blender', 'airfryer'];

const SPICE_OPTIONS: { value: '0' | '1' | '2'; label: string }[] = [
  { value: '0', label: 'Не острое' },
  { value: '1', label: 'Немного' },
  { value: '2', label: 'Острое' },
];

/** A private recipe: visible only to this household, used by the generator like any other. */
export default function RecipeEditorPage() {
  const { recipeId } = useParams();
  const { catalog, custom, loading } = useFullCatalog();
  if (recipeId) {
    const existing = custom.find((r) => r.id === recipeId);
    if (!existing) {
      if (loading) return <Loading />;
      return (
        <Empty icon="book" title="Рецепт не найден" action={<Link className="btn primary" to="/recipes">К рецептам</Link>}>
          Изменять можно только свои рецепты.
        </Empty>
      );
    }
    return <Editor key={existing.id} initial={existing} catalog={catalog} />;
  }
  return <Editor initial={null} catalog={catalog} />;
}

function Editor({ initial, catalog }: { initial: Recipe | null; catalog: Catalog }) {
  const { gateway, reportError, toast } = useApp();
  const navigate = useNavigate();
  const method0 = initial?.methods[0];
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'main');
  const [mealTypes, setMealTypes] = useState<string[]>(initial?.meal_types ?? ['lunch', 'dinner']);
  const [servings, setServings] = useState(initial?.servings ?? 2);
  const [yieldG, setYieldG] = useState<number | null>(initial?.yield_g ?? null);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial?.ingredients ?? []);
  const [equipment, setEquipment] = useState<string[]>(method0?.equipment ?? ['stove']);
  const [totalMin, setTotalMin] = useState<number | null>(method0?.total_min ?? 30);
  const [activeMin, setActiveMin] = useState<number | null>(method0?.active_min ?? 15);
  const [steps, setSteps] = useState((method0?.steps ?? []).join('\n'));
  const [containerOk, setContainerOk] = useState(initial?.container_ok ?? true);
  const [techniques, setTechniques] = useState<string[]>(initial?.techniques ?? []);
  const [spicy, setSpicy] = useState<number>(initial?.spicy ?? 0);
  const [kidFriendly, setKidFriendly] = useState(initial?.kid_friendly ?? false);
  const [busy, setBusy] = useState(false);
  // Errors are shown after the first attempt to save, not before the user has typed anything.
  const [attempted, setAttempted] = useState(false);

  const recipe: Recipe = {
    id: initial?.id ?? '',
    version: initial?.version ?? 1,
    name: name.trim(),
    description: description.trim(),
    category,
    meal_types: mealTypes,
    servings,
    yield_g: yieldG,
    ingredients,
    methods: [{ id: 'main', name: 'Основной способ', equipment, active_min: activeMin ?? Number.NaN, total_min: totalMin ?? Number.NaN, steps: steps.split('\n').map((s) => s.trim()).filter(Boolean) }],
    techniques: techniques.length ? techniques : null,
    diet_tags: initial?.diet_tags ?? [],
    container_ok: containerOk,
    tip: initial?.tip ?? null,
    storage: initial?.storage ?? null,
    image: null,
    source: 'user',
    visibility: 'private',
    cuisine: initial?.cuisine ?? null,
    spicy,
    // A spicy dish is never offered to children, whatever the switch says.
    kid_friendly: spicy === 0 && kidFriendly,
  };
  const errors = customRecipeErrors(recipe, catalog);

  const save = async () => {
    setAttempted(true);
    if (errors.length > 0) return;
    setBusy(true);
    try {
      const saved = await gateway.saveCustomRecipe(recipe);
      toast(initial ? 'Изменения сохранены.' : 'Рецепт сохранён. Он виден только вам.', { tone: 'success' });
      navigate(`/recipes/${saved.id}`);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 760, ['--gap' as string]: '16px' }}>
      <PageHead eyebrow="Мой рецепт" title={initial ? 'Изменить рецепт' : 'Новый рецепт'} subtitle="Собственные рецепты приватны и участвуют в подборе меню." />
      <section className="card stack">
        <Field label="Название">
          <input className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <Field label="Коротко о блюде (необязательно)">
          <textarea className="input" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label" id="editor-category">
            Категория
          </span>
          <div className="chips" role="group" aria-labelledby="editor-category">
            {Object.entries(CATEGORY_NAMES).map(([id, n]) => (
              <Chip key={id} on={category === id} onClick={() => setCategory(id)}>
                {n}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label" id="editor-slots">
            Подходит на
          </span>
          <div className="chips" role="group" aria-labelledby="editor-slots">
            {Object.entries(SLOT_NAMES).map(([id, n]) => (
              <Chip key={id} on={mealTypes.includes(id)} onClick={() => setMealTypes((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))}>
                {n}
              </Chip>
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <span>Порций</span>
            <Stepper label="Порции" value={servings} onChange={setServings} min={1} max={20} step={1} />
          </div>
          <Field label="Выход готового блюда, г" hint="Если не знаете — оставьте пустым">
            <NumberInput decimal value={yieldG} onChange={setYieldG} style={{ width: 160 }} />
          </Field>
        </div>
        <div className="field">
          <span>Острота</span>
          <Segmented label="Острота" value={String(spicy) as '0' | '1' | '2'} onChange={(v) => setSpicy(Number(v))} options={SPICE_OPTIONS} />
        </div>
        <Switch checked={spicy === 0 && kidFriendly} onChange={setKidFriendly} label="Подходит детям" hint={spicy > 0 ? 'Острые блюда детям не подбираются.' : 'Привычный вкус, без сырой рыбы и мяса.'} />
      </section>
      <section className="card stack">
        <h2>Ингредиенты</h2>
        {ingredients.map((ing, i) => {
          const product = catalog.products[ing.product];
          const units = product ? [...new Set<RecipeUnit>(['g', ...availableDisplayUnits(product)])] : (['g'] as RecipeUnit[]);
          return (
            <div key={ing.product} className="row wrap">
              <strong className="grow">{product?.name ?? ing.product}</strong>
              <NumberInput
                decimal
                style={{ width: 100 }}
                aria-label={`Количество: ${product?.name ?? ing.product}`}
                value={ing.qty === 0 ? null : ing.qty}
                onChange={(v) => setIngredients((l) => l.map((x, j) => (j === i ? { ...x, qty: v ?? 0 } : x)))}
              />
              <select className="input" style={{ width: 110 }} value={ing.unit} aria-label={`Единица: ${product?.name ?? ing.product}`} onChange={(e) => setIngredients((l) => l.map((x, j) => (j === i ? { ...x, unit: e.target.value as RecipeUnit } : x)))}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_NAMES[u]}
                  </option>
                ))}
              </select>
              <button className="icon-btn small" aria-label={`Убрать ингредиент: ${product?.name ?? ing.product}`} onClick={() => setIngredients((l) => l.filter((_, j) => j !== i))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          );
        })}
        <ProductPicker label="Добавить ингредиент" value={null} exclude={ingredients.map((i) => i.product)} onChange={(p) => setIngredients((l) => [...l, { product: p.id, qty: 0, unit: p.base_unit === 'pcs' ? 'pcs' : p.base_unit === 'ml' ? 'ml' : 'g' }])} />
        <p className="muted tiny">Единицы предлагаются только те, для которых у продукта есть коэффициент (плотность, масса штуки или ложки).</p>
      </section>
      <section className="card stack">
        <h2>Приготовление</h2>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label" id="editor-equipment">
            Техника
          </span>
          <div className="chips" role="group" aria-labelledby="editor-equipment">
            {EQUIPMENT.map((e) => (
              <Chip key={e} on={equipment.includes(e)} onClick={() => setEquipment((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]))}>
                {catalog.reference.equipment.find((x) => x.id === e)?.name ?? e}
              </Chip>
            ))}
          </div>
        </div>
        <div className="row wrap">
          <Field label="Всего, мин">
            <NumberInput style={{ width: 110 }} value={totalMin} onChange={setTotalMin} />
          </Field>
          <Field label="Активно, мин">
            <NumberInput style={{ width: 110 }} value={activeMin} onChange={setActiveMin} />
          </Field>
        </div>
        <Field label="Шаги — каждый с новой строки">
          <textarea className="input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label" id="editor-techniques">
            Кулинарные приёмы (определяют уровень сложности)
          </span>
          <div className="chips" role="group" aria-labelledby="editor-techniques">
            {catalog.reference.techniques.map((t) => (
              <Chip key={t.id} on={techniques.includes(t.id)} onClick={() => setTechniques((l) => (l.includes(t.id) ? l.filter((x) => x !== t.id) : [...l, t.id]))}>
                {t.name}
              </Chip>
            ))}
          </div>
          <p className="muted tiny">Без отмеченных приёмов сложность считается непроверенной, и рецепт не попадёт в меню начинающего.</p>
        </div>
        <Switch checked={containerOk} onChange={setContainerOk} label="Подходит для обеда в контейнере" />
      </section>
      {attempted && errors.length > 0 && (
        <Banner tone="warn" icon="warn">
          {errors.join(' ')}
        </Banner>
      )}
      <button className="btn primary big" disabled={busy} onClick={() => void save()}>
        {initial ? 'Сохранить изменения' : 'Сохранить рецепт'}
      </button>
    </div>
  );
}
