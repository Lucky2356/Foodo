import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { availableDisplayUnits, convertQuantity, recipeNutrition, selectMethod, UNIT_NAMES, VITAMIN_IDS } from '../engine';
import type { CookingMethod, Recipe, RecipeUnit } from '../engine';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { Banner, Empty, Loading, RecipeCover, Segmented, Sheet, Stepper } from '../ui/kit';
import { humanDate } from '../lib/dates';
import { minutes, num } from '../lib/format';
import { allergenName, CATEGORY_NAMES, equipmentName, SKILL_NAMES, SLOT_NAMES, summarize } from '../lib/recipes';
import { useFullCatalog } from '../state/catalog';

type Basis = 'serving' | '100g' | 'total';
const VIT_LABEL: Record<string, string> = { vit_a: 'Витамин A, мкг РЭ', vit_c: 'Витамин C, мг', vit_d: 'Витамин D, мкг', vit_e: 'Витамин E, мг α-ТФ', vit_b6: 'Витамин B6, мг', vit_b12: 'Витамин B12, мкг', folate: 'Фолаты, мкг' };

function fmtQty(qty: number): string {
  if (qty > 0 && qty < 0.01) return '< 0,01';
  if (qty >= 100) return num(Math.round(qty));
  if (qty >= 10) return num(qty, 1);
  return num(qty, 2);
}

export default function RecipePage() {
  const { recipeId = '' } = useParams();
  const { gateway, household, favorites, toggleFavorite, reportError, toast, bump } = useApp();
  const custom = useFullCatalog();
  const catalog = custom.catalog;
  const recipe = catalog.recipes[recipeId];
  const navigate = useNavigate();
  const equipment = household?.settings.plan.equipment ?? ['stove', 'oven', 'microwave'];
  const [servings, setServings] = useState<number | null>(null);
  const [basis, setBasis] = useState<Basis>('serving');
  const [methodId, setMethodId] = useState<string | null>(null);
  const [units, setUnits] = useState<Record<number, RecipeUnit>>({});
  const [cooking, setCooking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (recipe) {
      setServings(recipe.servings);
      setMethodId((selectMethod(recipe, equipment) ?? recipe.methods[0])?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);

  if (!recipe) {
    if (custom.loading) return <Loading />;
    return (
      <Empty page icon="book" title="Рецепт не найден" action={<Link className="btn primary" to="/recipes">К рецептам</Link>}>
        Возможно, он был удалён или ссылка неверна.
      </Empty>
    );
  }
  const s = summarize(catalog, recipe);
  const portions = servings ?? recipe.servings;
  const scale = portions / recipe.servings;
  const nutrition = recipeNutrition(catalog, recipe, scale);
  const method = (recipe.methods.find((m) => m.id === methodId) ?? recipe.methods[0]) as CookingMethod;
  const methodAvailable = method.equipment.every((e) => equipment.includes(e));
  const table = basis === 'serving' ? nutrition.perServing : basis === '100g' ? nutrition.per100g : nutrition.total;
  const fav = favorites.has(recipe.id);
  const sources = catalog.reference.sources;
  // Which ingredients carry reference values and which are still developer estimates, by name.
  const ingredientProducts = [...new Set(recipe.ingredients.map((i) => i.product))].map((id) => catalog.products[id]).filter((p) => p !== undefined);
  const sourceOf = (p: (typeof ingredientProducts)[number]) => sources.find((x) => x.id === p.source);
  const estimatedNames = ingredientProducts.filter((p) => !sourceOf(p)?.verified).map((p) => p.name.toLowerCase());
  const verifiedSources = [...new Set(ingredientProducts.map(sourceOf).filter((x) => x?.verified).map((x) => x?.name))];
  const estimated = estimatedNames.length > 0;

  return (
    <article className="stack fade-in" style={{ ['--gap' as string]: '18px' }}>
      <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(-1)}>
        <Icon name="back" size={16} /> Назад
      </button>
      <div className="bento">
        <div className="span-3" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', aspectRatio: '4 / 3', boxShadow: 'var(--shadow)' }}>
          <RecipeCover recipe={recipe} />
        </div>
        <div className="span-3 stack" style={{ ['--gap' as string]: '12px', alignContent: 'start' }}>
          <span className="eyebrow muted small" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
            {CATEGORY_NAMES[recipe.category]}
            {recipe.visibility === 'private' ? ' · мой рецепт' : ''}
          </span>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>{recipe.name}</h1>
          <p className="muted">{recipe.description}</p>
          <div className="meta" style={{ fontSize: 15 }}>
            <span>
              <Icon name="clock" size={17} /> {minutes(method.total_min)} · активно {minutes(method.active_min)}
            </span>
            <span>
              <Icon name="chef" size={17} /> {s.skillRank === null ? 'сложность не проверена' : SKILL_NAMES[s.skillRank]}
            </span>
            <span>
              <Icon name="flame" size={17} /> {method.equipment.length ? method.equipment.map((e) => equipmentName(catalog, e)).join(', ') : 'без нагрева'}
            </span>
          </div>
          <div className="recipe-actions">
            <button className="btn primary" onClick={() => setCooking(true)}>
              <Icon name="play" size={18} /> Режим готовки
            </button>
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Icon name="calendar" size={18} /> В меню
            </button>
            <button className={`btn ghost ${fav ? 'active' : ''}`} aria-pressed={fav} onClick={() => void toggleFavorite(recipe.id)}>
              <Icon name="heart" size={18} fill={fav ? 'currentColor' : 'none'} /> {fav ? 'В избранном' : 'В избранное'}
            </button>
            {recipe.visibility === 'private' && (
              <>
                <Link className="btn ghost" to={`/recipes/${recipe.id}/edit`}>
                  <Icon name="edit" size={18} /> Изменить
                </Link>
                <button className="btn ghost" onClick={() => setDeleteOpen(true)}>
                  <Icon name="trash" size={18} /> Удалить
                </button>
              </>
            )}
          </div>
          {recipe.image && (
            <p className="tiny muted">
              {recipe.image.source} ·{' '}
              {recipe.image.license_url ? (
                <a href={recipe.image.license_url} target="_blank" rel="noopener noreferrer">
                  {recipe.image.license}
                </a>
              ) : (
                recipe.image.license
              )}
              {recipe.image.page_url && (
                <>
                  {' · '}
                  <a href={recipe.image.page_url} target="_blank" rel="noopener noreferrer">
                    страница файла
                  </a>
                </>
              )}
            </p>
          )}
          <section className="card stack recipe-kbju">
            <div className="row wrap between">
              <h2>КБЖУ</h2>
              <Segmented<Basis>
                label="База расчёта"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: 'serving', label: 'Порция' },
                  { value: '100g', label: '100 г' },
                  { value: 'total', label: `${portions} порц.` },
                ]}
              />
            </div>
            {table ? (
              <div className="kbju">
                {(['kcal', 'protein', 'fat', 'carbs'] as const).map((k) => (
                  <div key={k}>
                    <b>{num(table[k].value, k === 'kcal' ? 0 : 1)}</b>
                    <small>{k === 'kcal' ? 'ккал' : k === 'protein' ? 'белки, г' : k === 'fat' ? 'жиры, г' : 'углев., г'}</small>
                  </div>
                ))}
              </div>
            ) : (
              <Banner icon="info">Выход готового блюда неизвестен, поэтому значение на 100 г не рассчитывается. Смотрите значение на порцию.</Banner>
            )}
            {nutrition.yieldG !== null && nutrition.yieldG > 0 && (
              <p className="muted small">
                Выход: {num(nutrition.yieldG)} г, порция ≈ {num(nutrition.yieldG / portions)} г
              </p>
            )}
            <p className="muted tiny">
              {!nutrition.total.kcal.complete ? 'Для части ингредиентов нет данных — значения неполные. ' : ''}
              {estimated
                ? `Оценочные значения, не сверенные с первоисточником: ${estimatedNames.slice(0, 4).join(', ')}${estimatedNames.length > 4 ? ` и ещё ${estimatedNames.length - 4}` : ''}. `
                : ''}
              {verifiedSources.length > 0 ? `${estimated ? 'Остальное' : 'Пищевая ценность продуктов'} — ${verifiedSources.join(', ')}.` : ''}
            </p>
          </section>
        </div>
      </div>


      <div className="bento">
        <section className="card span-3 stack">
          <div className="row between wrap">
            <h2>Ингредиенты</h2>
            <Stepper label="Порции" value={portions} onChange={setServings} min={1} max={30} step={1} format={(v) => `${v} порц.`} />
          </div>
          <ul className="ingredients">
            {recipe.ingredients.map((ing, i) => {
              const product = catalog.products[ing.product];
              // Only units in which the amount reads sensibly: 1 tsp of sugar is not «0 кг».
              const options = product
                ? availableDisplayUnits(product).filter((u) => {
                    const c = convertQuantity(product, ing.qty * scale, ing.unit, u);
                    return c !== null && c.qty >= 0.01;
                  })
                : [];
              const unit = units[i] ?? ing.unit;
              const shown = product ? convertQuantity(product, ing.qty * scale, ing.unit, unit) : null;
              const value = shown ?? { qty: ing.qty * scale, unit: ing.unit, approximate: false };
              const allOptions = [...new Set([ing.unit, ...options])];
              return (
                <li key={i}>
                  <span className="grow">
                    {product?.name ?? ing.product}
                    {product && product.state !== 'raw' && product.state !== 'processed' && <span className="muted tiny"> · {product.state === 'dry' ? 'в сухом виде' : 'в готовом виде'}</span>}
                  </span>
                  {allOptions.length > 1 ? (
                    <label className="row" style={{ ['--gap' as string]: '6px' }}>
                      <span className="num" style={{ fontWeight: 650 }}>
                        {value.approximate ? '≈ ' : ''}
                        {fmtQty(value.qty)}
                      </span>
                      <select className="input" style={{ minHeight: 36, padding: '4px 8px', width: 'auto' }} value={unit} onChange={(e) => setUnits((u) => ({ ...u, [i]: e.target.value as RecipeUnit }))} aria-label={`Единица: ${product?.name}`}>
                        {allOptions.map((u) => (
                          <option key={u} value={u}>
                            {UNIT_NAMES[u]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="num" style={{ fontWeight: 650 }}>
                      {fmtQty(value.qty)} {UNIT_NAMES[value.unit]}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {s.allergens.length > 0 && (
            <p className="small">
              <strong>Аллергены:</strong> {s.allergens.map((a) => allergenName(catalog, a)).join(', ')}
            </p>
          )}
          {!s.compositionKnown && <Banner tone="warn" icon="warn">Состав одного из ингредиентов неизвестен: блюдо нельзя считать проверенным на аллергены.</Banner>}
        </section>
        <section className="card span-3 stack">
          <div className="row between wrap">
            <h2>Приготовление</h2>
            {recipe.methods.length > 1 && (
              <Segmented label="Способ приготовления" value={method.id} onChange={setMethodId} options={recipe.methods.map((m) => ({ value: m.id, label: m.name }))} />
            )}
          </div>
          {!methodAvailable && <Banner tone="warn" icon="warn">Для этого способа нужна техника, которой нет в ваших настройках кухни.</Banner>}
          <ol className="steps">
            {method.steps.map((step, i) => (
              <li key={i}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {recipe.tip && <Banner tone="ok" icon="sparkle"><strong>Совет.</strong> {recipe.tip}</Banner>}
          {!recipe.storage && <p className="muted tiny">Сроки хранения для этого блюда не проверены — ориентируйтесь на собственные правила хранения.</p>}
        </section>
      </div>

      <section className="card">
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Витамины и клетчатка на порцию</summary>
          <table className="table" style={{ marginTop: 12 }}>
            <tbody>
              <tr>
                <td>Пищевые волокна, г</td>
                <td className="num">{nutrition.perServing.fiber.complete ? num(nutrition.perServing.fiber.value, 1) : `≥ ${num(nutrition.perServing.fiber.value, 1)} (неполные данные)`}</td>
              </tr>
              {VITAMIN_IDS.map((v) => (
                <tr key={v}>
                  <td>{VIT_LABEL[v]}</td>
                  <td className="num">
                    {nutrition.perServing[v].complete ? num(nutrition.perServing[v].value, 2) : nutrition.perServing[v].value > 0 ? `≥ ${num(nutrition.perServing[v].value, 2)} (неполные данные)` : 'нет данных'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted tiny" style={{ marginTop: 8 }}>
            Значения оценочные: без учёта потерь при готовке (проверенных коэффициентов сохранности в базе нет).
          </p>
        </details>
      </section>

      {cooking && <CookMode recipe={recipe} method={method} onClose={() => setCooking(false)} />}
      {addOpen && <AddToMenuSheet recipe={recipe} onClose={() => setAddOpen(false)} />}
      {deleteOpen && (
        <Sheet
          open
          onClose={() => setDeleteOpen(false)}
          title="Удалить рецепт?"
          footer={
            <>
              <button className="btn ghost" onClick={() => setDeleteOpen(false)}>
                Отмена
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  try {
                    await gateway.deleteCustomRecipe(recipe.id);
                    if (fav) await toggleFavorite(recipe.id);
                    toast(`Рецепт «${recipe.name}» удалён.`, { tone: 'success' });
                    bump();
                    navigate('/recipes');
                  } catch (e) {
                    reportError(e);
                  }
                }}
              >
                Удалить
              </button>
            </>
          }
        >
          <p>«{recipe.name}» исчезнет из каталога и больше не будет подбираться в новые меню. В уже составленных меню блюдо останется: в них хранится его копия.</p>
        </Sheet>
      )}
    </article>
  );
}

function CookMode({ recipe, method, onClose }: { recipe: Recipe; method: CookingMethod; onClose: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(method.steps.length - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page under the full-screen overlay must not scroll.
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      void lock?.release();
    };
  }, [method.steps.length, onClose]);
  // A full-screen overlay rendered into <body>, out of reach of transformed ancestors.
  return createPortal(
    <div className="cook-mode" role="dialog" aria-modal="true" aria-label={`Режим готовки: ${recipe.name}`}>
      <div className="row between">
        <div>
          <div className="muted small">{recipe.name}</div>
          <strong>
            Шаг {step + 1} из {method.steps.length}
          </strong>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть режим готовки">
          <Icon name="close" />
        </button>
      </div>
      <div className="progress" style={{ marginTop: 12 }}>
        <span style={{ width: `${((step + 1) / method.steps.length) * 100}%` }} />
      </div>
      <p className="step-text" aria-live="polite">
        {method.steps[step]}
      </p>
      <div className="row">
        <button className="btn big ghost grow" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <Icon name="back" /> Назад
        </button>
        {step < method.steps.length - 1 ? (
          <button className="btn big primary grow" onClick={() => setStep((s) => s + 1)}>
            Дальше <Icon name="chevron" />
          </button>
        ) : (
          <button className="btn big primary grow" onClick={onClose}>
            Готово <Icon name="check" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function AddToMenuSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { gateway, household, reportError, toast, bump } = useApp();
  const { record } = useCurrentMenu();
  const members = household?.members ?? [];
  const [target, setTarget] = useState<{ date: string; slot: string } | null>(null);
  const [who, setWho] = useState<string[]>(members.map((m) => m.id));
  const slots = record?.menu.slots.filter((s) => recipe.meal_types.includes(s)) ?? [];
  const dates = [...new Set(record?.menu.meals.map((m) => m.date) ?? [])];
  const add = async () => {
    if (!record || !target) return;
    try {
      await gateway.applyOp(record.id, { op: 'add', date: target.date, slot: target.slot, recipe_id: recipe.id, member_ids: who }, record.revision);
      toast(`«${recipe.name}» добавлено в меню`, { tone: 'success' });
      bump();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Добавить в меню"
      footer={
        record ? (
          <button className="btn primary" disabled={!target || who.length === 0} onClick={() => void add()}>
            Добавить
          </button>
        ) : (
          <Link className="btn primary" to="/menu" onClick={onClose}>
            Составить меню
          </Link>
        )
      }
    >
      {!record ? (
        <p className="muted">Меню ещё нет. Составьте его — тогда это блюдо можно будет добавить в любой день.</p>
      ) : (
        <div className="stack">
          <div className="chips">
            {dates.flatMap((d) =>
              (slots.length ? slots : record.menu.slots).map((s) => (
                <button key={`${d}-${s}`} className="chip" aria-pressed={target?.date === d && target.slot === s} onClick={() => setTarget({ date: d, slot: s })}>
                  {humanDate(d).split(',')[0]} {Number(d.slice(8))} · {SLOT_NAMES[s]}
                </button>
              )),
            )}
          </div>
          {members.length > 1 && (
            <div className="chips">
              {members.map((m) => (
                <button key={m.id} className="chip" aria-pressed={who.includes(m.id)} onClick={() => setWho((w) => (w.includes(m.id) ? w.filter((x) => x !== m.id) : [...w, m.id]))}>
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <p className="muted small">Блюдо проверяется по запретам, технике и уровню готовки — неподходящее не добавится.</p>
        </div>
      )}
    </Sheet>
  );
}
