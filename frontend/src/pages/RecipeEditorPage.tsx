import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { availableDisplayUnits, UNIT_NAMES } from '../engine';
import type { Ingredient, Recipe, RecipeUnit } from '../engine';
import { useApp } from '../state/app';
import { Icon } from '../ui/icons';
import { Banner, Chip, Field, PageHead, Stepper, Switch } from '../ui/kit';
import { ProductPicker } from '../ui/ProductPicker';
import { CATEGORY_NAMES, SLOT_NAMES } from '../lib/recipes';

const EQUIPMENT = ['stove', 'oven', 'microwave', 'multicooker', 'blender', 'airfryer'];

/** A private recipe: visible only to this household, used by the generator like any other. */
export default function RecipeEditorPage() {
  const { gateway, catalog, reportError, toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('main');
  const [mealTypes, setMealTypes] = useState<string[]>(['lunch', 'dinner']);
  const [servings, setServings] = useState(2);
  const [yieldText, setYield] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [equipment, setEquipment] = useState<string[]>(['stove']);
  const [totalMin, setTotalMin] = useState('30');
  const [activeMin, setActiveMin] = useState('15');
  const [steps, setSteps] = useState('');
  const [containerOk, setContainerOk] = useState(true);
  const [techniques, setTechniques] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const stepList = steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const errors: string[] = [];
  if (!name.trim()) errors.push('Укажите название.');
  if (ingredients.length === 0) errors.push('Добавьте хотя бы один ингредиент.');
  if (ingredients.some((i) => !(i.qty > 0))) errors.push('Количество каждого ингредиента должно быть больше нуля.');
  if (stepList.length === 0) errors.push('Опишите хотя бы один шаг.');
  if (mealTypes.length === 0) errors.push('Выберите приёмы пищи.');
  if (Number(activeMin) > Number(totalMin)) errors.push('Активное время не может быть больше общего.');

  const save = async () => {
    setBusy(true);
    try {
      const recipe: Recipe = {
        id: '',
        version: 1,
        name: name.trim(),
        description: '',
        category,
        meal_types: mealTypes,
        servings,
        yield_g: yieldText.trim() ? Number(yieldText.replace(',', '.')) : null,
        ingredients,
        methods: [{ id: 'main', name: 'Основной способ', equipment, active_min: Number(activeMin) || 0, total_min: Number(totalMin) || 0, steps: stepList }],
        techniques: techniques.length ? techniques : null,
        diet_tags: [],
        container_ok: containerOk,
        tip: null,
        storage: null,
        image: null,
        source: 'user',
        visibility: 'private',
      };
      const saved = await gateway.saveCustomRecipe(recipe);
      toast('Рецепт сохранён. Он виден только вам.', { tone: 'success' });
      navigate(`/recipes/${saved.id}`);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 760, ['--gap' as string]: '16px' }}>
      <PageHead eyebrow="Мой рецепт" title="Новый рецепт" subtitle="Собственные рецепты приватны и участвуют в подборе меню." />
      <section className="card stack">
        <Field label="Название">
          <input className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <div className="chips">
          {Object.entries(CATEGORY_NAMES).map(([id, n]) => (
            <Chip key={id} on={category === id} onClick={() => setCategory(id)}>
              {n}
            </Chip>
          ))}
        </div>
        <div className="chips" aria-label="Приёмы пищи">
          {Object.entries(SLOT_NAMES).map(([id, n]) => (
            <Chip key={id} on={mealTypes.includes(id)} onClick={() => setMealTypes((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))}>
              {n}
            </Chip>
          ))}
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <span>Порций</span>
            <Stepper label="Порции" value={servings} onChange={setServings} min={1} max={20} step={1} />
          </div>
          <Field label="Выход готового блюда, г" hint="Если не знаете — оставьте пустым">
            <input className="input" inputMode="decimal" value={yieldText} onChange={(e) => setYield(e.target.value)} style={{ width: 160 }} />
          </Field>
        </div>
      </section>
      <section className="card stack">
        <h2>Ингредиенты</h2>
        {ingredients.map((ing, i) => {
          const product = catalog.products[ing.product];
          const units = product ? [...new Set<RecipeUnit>(['g', ...availableDisplayUnits(product)])] : (['g'] as RecipeUnit[]);
          return (
            <div key={i} className="row wrap">
              <strong className="grow">{product?.name ?? ing.product}</strong>
              <input className="input" inputMode="decimal" style={{ width: 100 }} value={ing.qty || ''} aria-label="Количество" onChange={(e) => setIngredients((l) => l.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(',', '.')) } : x)))} />
              <select className="input" style={{ width: 110 }} value={ing.unit} aria-label="Единица" onChange={(e) => setIngredients((l) => l.map((x, j) => (j === i ? { ...x, unit: e.target.value as RecipeUnit } : x)))}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_NAMES[u]}
                  </option>
                ))}
              </select>
              <button className="icon-btn small" aria-label="Убрать ингредиент" onClick={() => setIngredients((l) => l.filter((_, j) => j !== i))}>
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
        <div className="chips" aria-label="Техника">
          {EQUIPMENT.map((e) => (
            <Chip key={e} on={equipment.includes(e)} onClick={() => setEquipment((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]))}>
              {catalog.reference.equipment.find((x) => x.id === e)?.name ?? e}
            </Chip>
          ))}
        </div>
        <div className="row wrap">
          <Field label="Всего, мин">
            <input className="input" inputMode="numeric" style={{ width: 110 }} value={totalMin} onChange={(e) => setTotalMin(e.target.value)} />
          </Field>
          <Field label="Активно, мин">
            <input className="input" inputMode="numeric" style={{ width: 110 }} value={activeMin} onChange={(e) => setActiveMin(e.target.value)} />
          </Field>
        </div>
        <Field label="Шаги — каждый с новой строки">
          <textarea className="input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </Field>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Кулинарные приёмы (определяют уровень сложности)</span>
          <div className="chips">
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
      {errors.length > 0 && <Banner tone="warn" icon="warn">{errors.join(' ')}</Banner>}
      <button className="btn primary big" disabled={errors.length > 0 || busy} onClick={() => void save()}>
        Сохранить рецепт
      </button>
    </div>
  );
}
