import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toBase } from '../engine';
import type { PlanSettings, Product } from '../engine';
import type { HouseholdSettings, NewPrice } from '../data/types';
import { chainsForCity, detectCity, loadChains, loadCities, searchCities } from '../data/geo';
import type { Chain, City } from '../data/geo';
import { useApp, useLoad } from '../state/app';
import { Icon } from '../ui/icons';
import { Banner, Chip, Field, Loading, NumberInput, PageHead, Segmented, Sheet, Switch } from '../ui/kit';
import { ProductPicker } from '../ui/ProductPicker';
import { dayMonth } from '../lib/dates';
import { num, rub } from '../lib/format';
import { budgetError } from '../lib/numbers';

const PRICE_UNITS: Record<string, string> = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт.' };
/** «за 900 г», «за 1 кг» */
const pricePer = (size: number, unit: string) => `за ${num(size, 3)} ${PRICE_UNITS[unit] ?? unit}`;
import { SLOT_NAMES } from '../lib/recipes';
import { fetchPriceSourcesStatus } from '../data/prices';
import type { PriceSourceStatus } from '../data/prices';
import { NATIVE_BUILD } from '../lib/config';

// Android app only (not part of the web builds).
const AppUpdatesSection = NATIVE_BUILD ? lazy(() => import('../native/AppUpdatesSection')) : null;

const EQUIPMENT = [
  ['stove', 'Плита'],
  ['oven', 'Духовка'],
  ['microwave', 'Микроволновка'],
  ['multicooker', 'Мультиварка'],
  ['blender', 'Блендер'],
  ['airfryer', 'Аэрогриль'],
] as const;
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const KIND_NAMES: Record<string, string> = { manual: 'вручную', receipt: 'чек', community: 'пользователи Foodo', scraped: 'сайт сети', rosstat: 'Росстат, средняя цена (оценка)' };

export default function SettingsPage() {
  const { household, gateway, catalog, refreshHousehold, reportError, toast } = useApp();
  const location = useLocation();
  const [settings, setSettings] = useState<HouseholdSettings | null>(household?.settings ?? null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (household && !settings) setSettings(household.settings);
  }, [household, settings]);

  useEffect(() => {
    if (!location.hash) return;
    setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [location.hash]);

  if (!household || !settings) return <Loading />;
  const plan = settings.plan;

  // Autosave: changes are sent shortly after the last edit; «Сохранено» appears only after success.
  const update = (next: HouseholdSettings) => {
    setSettings(next);
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await gateway.updateHousehold({ settings: next });
        await refreshHousehold();
        setStatus('saved');
      } catch (e) {
        setStatus('error');
        reportError(e);
      }
    }, 600);
  };
  const setPlan = (p: Partial<PlanSettings>) => update({ ...settings, plan: { ...plan, ...p } });
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="stack" style={{ ['--gap' as string]: '18px' }}>
      <PageHead
        eyebrow="Настройки"
        title="Как подбирать меню"
        actions={
          <span className={`badge ${status === 'saved' ? 'green' : status === 'error' ? 'orange' : ''}`} role="status">
            {status === 'saving' ? 'Сохраняем…' : status === 'saved' ? 'Сохранено' : status === 'error' ? 'Не сохранено' : 'Изменения сохраняются сами'}
          </span>
        }
      />
      <section className="card row between wrap">
        <div className="grow">
          <h2>Анкета</h2>
          <p className="muted small">Ответьте на вопросы заново — настройки и участники обновятся, затем составится новое меню.</p>
        </div>
        <Link className="btn" to="/start">
          <Icon name="list" size={18} /> Пройти анкету заново
        </Link>
      </section>
      <section className="card stack">
        <h2>Приёмы пищи</h2>
        <div className="chips">
          {Object.entries(SLOT_NAMES).map(([id, name]) => (
            <Chip key={id} on={settings.slots.includes(id)} onClick={() =>
                settings.slots.length > 1 || !settings.slots.includes(id)
                  ? update({ ...settings, slots: toggleIn(settings.slots, id) })
                  : toast('Нужен хотя бы один приём пищи')
              }>
              {name}
            </Chip>
          ))}
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Обед в контейнер — без супов и блюд, которые не перевозят</span>
          <div className="chips">
            {WEEK.map((d, i) => (
              <Chip key={d} on={plan.container_days.includes(i + 1)} onClick={() => setPlan({ container_days: toggleIn(plan.container_days, i + 1) })}>
                {d}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Меню по умолчанию на</span>
          <div className="chips">
            {[3, 7, 14, 28].map((d) => (
              <Chip key={d} on={settings.days === d} onClick={() => update({ ...settings, days: d })}>
                {d} дн.
              </Chip>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Кухня</h2>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Уровень готовки</span>
          <Segmented label="Уровень готовки" value={plan.skill} onChange={(v) => setPlan({ skill: v })} options={[{ value: 'beginner', label: 'Начинающий' }, { value: 'confident', label: 'Уверенно готовлю' }, { value: 'any', label: 'Любой уровень' }]} />
          <p className="muted small">
            {plan.skill === 'beginner' ? 'Только простые приёмы: варка, тушение, запекание, нарезка. Блюда с неизвестной сложностью не предлагаются.' : plan.skill === 'confident' ? 'Добавляются оладьи, котлеты, соусы-эмульсии.' : 'Все рецепты, включая дрожжевое тесто и блюда с непроверенной сложностью.'}
          </p>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Техника</span>
          <div className="chips">
            {EQUIPMENT.map(([id, name]) => (
              <Chip key={id} on={plan.equipment.includes(id)} onClick={() => setPlan({ equipment: toggleIn(plan.equipment, id) })}>
                {name}
              </Chip>
            ))}
          </div>
          <p className="muted small">Блюда без нагрева доступны всегда. Если у рецепта есть способ для вашей техники (например, аэрогриль вместо духовки), подставятся его шаги и время.</p>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Максимальное время готовки в будни</span>
          <div className="chips">
            {[null, 20, 30, 45, 60, 90].map((t) => (
              <Chip key={String(t)} on={plan.max_total_min === t} onClick={() => setPlan({ max_total_min: t })}>
                {t === null ? 'Без ограничения' : `до ${t} мин`}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">В субботу и воскресенье</span>
          <div className="chips">
            <Chip on={plan.max_total_min_weekend === undefined || plan.max_total_min_weekend === plan.max_total_min} onClick={() => setPlan({ max_total_min_weekend: plan.max_total_min })}>
              Как в будни
            </Chip>
            {[null, 30, 45, 60, 90, 120].map((t) => (
              <Chip key={String(t)} on={plan.max_total_min_weekend !== undefined && plan.max_total_min_weekend !== plan.max_total_min && plan.max_total_min_weekend === t} onClick={() => setPlan({ max_total_min_weekend: t })}>
                {t === null ? 'Без ограничения' : `до ${t} мин`}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Питание</h2>
        <Segmented
          label="Режим питания"
          value={plan.diet_mode}
          onChange={(v) => setPlan({ diet_mode: v })}
          options={[
            { value: 'regular', label: 'Обычное' },
            { value: 'balanced', label: 'ПП' },
            { value: 'high_protein', label: 'Больше белка' },
          ]}
        />
        <p className="muted small">
          {plan.diet_mode === 'balanced'
            ? 'Выше в выборе — цельнозерновые крупы, овощи, нежирный белок, бобовые и рыба; ниже — жареное, добавленный сахар, белая мука и жирные соусы. Это предпочтение, а не диета: запреты и аллергены работают в любом режиме.'
            : plan.diet_mode === 'high_protein'
              ? 'Выше в выборе — нежирное мясо, птица, рыба, творог и бобовые; ниже — сладкое и белая мука. Порции не увеличиваются: меняется только выбор блюд.'
              : 'Без поправок на ПП: учитываются запреты, вкусы, разнообразие и время.'}
        </p>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Любимые кухни (такие блюда будут чаще)</span>
          <div className="chips">
            {(catalog.reference.cuisines ?? []).map((c) => (
              <Chip key={c.id} on={(plan.cuisines ?? []).includes(c.id)} onClick={() => setPlan({ cuisines: toggleIn(plan.cuisines ?? [], c.id) })}>
                {c.name}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Повторы блюд</span>
          <Segmented
            label="Повторы"
            value={plan.repeat.mode}
            onChange={(v) => setPlan({ repeat: { ...plan.repeat, mode: v } })}
            options={[
              { value: 'unique', label: 'Разные каждый день' },
              { value: 'allow', label: 'Повторы разрешены' },
              { value: 'batch', label: 'Готовлю на несколько дней' },
            ]}
          />
          {plan.repeat.mode === 'unique' && <p className="muted small">Одно и то же блюдо не повторится за весь период. Если рецептов не хватит, мы скажем об этом, а не включим повторы сами.</p>}
          {plan.repeat.mode !== 'unique' && (
            <div className="row wrap">
              <Field label="Не чаще, раз за период">
                <select className="input" value={plan.repeat.max_uses} onChange={(e) => setPlan({ repeat: { ...plan.repeat, max_uses: Number(e.target.value) } })}>
                  {[1, 2, 3, 4, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Интервал, дней">
                <select className="input" value={plan.repeat.min_gap_days} onChange={(e) => setPlan({ repeat: { ...plan.repeat, min_gap_days: Number(e.target.value) } })}>
                  {[0, 1, 2, 3, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {plan.repeat.mode === 'batch' && (
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <span className="label">Дни готовки</span>
              <div className="chips">
                {WEEK.map((d, i) => (
                  <Chip key={d} on={plan.repeat.cook_days.includes(i + 1)} onClick={() => setPlan({ repeat: { ...plan.repeat, cook_days: toggleIn(plan.repeat.cook_days, i + 1) } })}>
                    {d}
                  </Chip>
                ))}
              </div>
              <Field label="Одну партию едим не дольше, дней">
                <select className="input" value={plan.repeat.batch_days} onChange={(e) => setPlan({ repeat: { ...plan.repeat, batch_days: Number(e.target.value) } })}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="muted small">Продукты покупаются один раз на партию. Сроки хранения рецептов не проверены — ориентируйтесь на собственные правила.</p>
            </div>
          )}
        </div>
        <Switch
          checked={plan.vitamins.enabled}
          onChange={(v) => setPlan({ vitamins: { ...plan.vitamins, enabled: v, target_set: plan.vitamins.target_set ?? 'mr-2.3.1.0253-21-adults' } })}
          label="Учитывать витамины"
          hint="Подбор повышает шансы блюд, которые закрывают недостающие витамины A, C, D, E, B6, B12 и фолаты за период"
        />
        {plan.vitamins.enabled && (
          <Field label="Целевые значения">
            <select
              className="input"
              value={plan.vitamins.demo ? 'demo-2026-10' : (plan.vitamins.target_set ?? '')}
              onChange={(e) => setPlan({ vitamins: { enabled: true, target_set: e.target.value, demo: e.target.value === 'demo-2026-10' } })}
            >
              <option value="mr-2.3.1.0253-21-adults">МР 2.3.1.0253-21, взрослые (не сверено с первоисточником)</option>
              <option value="demo-2026-10">Демонстрация (условные значения, не нормы)</option>
            </select>
          </Field>
        )}
        {plan.vitamins.enabled && (
          <p className="muted small">
            Собственные цели можно задать каждому участнику в профиле. Формы витаминов не пересчитываются автоматически: если форма цели не совпадает с формой данных, цель не проверяется и это видно в отчёте.
          </p>
        )}
      </section>

      <StoreSection />
      <BudgetSection plan={plan} setPlan={setPlan} />
      <PricesSection />
      {AppUpdatesSection && (
        <Suspense fallback={null}>
          <AppUpdatesSection />
        </Suspense>
      )}
    </div>
  );
}

function StoreSection() {
  const { household, gateway, refreshHousehold, reportError, toast, user } = useApp();
  const [cities, setCities] = useState<City[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [query, setQuery] = useState('');
  const [detecting, setDetecting] = useState(false);
  useEffect(() => {
    void loadCities().then(setCities);
    void loadChains().then(setChains);
  }, []);
  const city = useMemo(() => cities.find((c) => c.id === household?.city?.id) ?? null, [cities, household]);
  const available = city ? chainsForCity(chains, city) : [];
  const save = async (patch: Parameters<typeof gateway.updateHousehold>[0], message: string) => {
    try {
      await gateway.updateHousehold(patch);
      await refreshHousehold();
      toast(message, { tone: 'success' });
    } catch (e) {
      reportError(e);
    }
  };
  const detect = async () => {
    setDetecting(true);
    try {
      const found = await detectCity();
      await save({ city_id: found.city.id }, `Город: ${found.city.name}`);
    } catch (e) {
      reportError(e);
    } finally {
      setDetecting(false);
    }
  };
  return (
    <section className="card stack" id="store">
      <h2>Город и магазин</h2>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void detect()} disabled={detecting}>
          {detecting ? <span className="spinner" /> : <Icon name="location" size={18} />} Определить мой город
        </button>
        {household?.city && (
          <span className="badge green">
            <Icon name="location" size={14} /> {household.city.name}, {household.city.region}
          </span>
        )}
      </div>
      <p className="muted tiny">Местоположение используется только на этом устройстве для поиска ближайшего города из встроенного списка; координаты никуда не отправляются.</p>
      <label className="search">
        <span className="visually-hidden">Найти город</span>
        <Icon name="search" size={18} />
        <input className="input" placeholder="Или найдите город вручную" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {query && (
        <div className="chips">
          {searchCities(cities, query, 12).map((c) => (
            <button
              key={c.id}
              className="chip"
              onClick={() => {
                setQuery('');
                void save({ city_id: c.id }, `Город: ${c.name}`);
              }}
            >
              {c.name} <span className="faint small">{c.region}</span>
            </button>
          ))}
        </div>
      )}
      {city && (
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Магазины в регионе «{city.region}»</span>
          <div className="chips">
            <Chip on={!household?.store_chain_id} onClick={() => void save({ store_chain_id: null }, 'Без привязки к магазину')}>
              Без привязки к магазину
            </Chip>
            {available.map((c) => (
              <Chip key={c.id} on={household?.store_chain_id === c.id} onClick={() => void save({ store_chain_id: c.id }, `Магазин: ${c.name}`)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <p className="muted tiny">Список сетей по региону составлен по открытым данным и может быть неточным. Выбор сети не загружает её ассортимент: цены берутся из источников, указанных у каждой цены.</p>
        </div>
      )}
      <PriceSources />
      {user && (
        <Switch
          checked={household?.share_prices ?? false}
          onChange={(v) => void save({ share_prices: v }, v ? 'Ваши цены будут анонимно помогать другим' : 'Цены больше не передаются')}
          label="Делиться введёнными ценами анонимно"
          hint="Цена, сеть, город и дата без данных о вас — так другие видят медиану цен в своём городе"
        />
      )}
    </section>
  );
}

const CHAIN_LABELS: Record<string, string> = {
  rosstat: 'Росстат',
  magnit: 'Магнит',
  pyaterochka: 'Пятёрочка',
  perekrestok: 'Перекрёсток',
  lenta: 'Лента',
  auchan: 'Ашан',
  okey: 'О’КЕЙ',
  metro: 'METRO',
  dixy: 'Дикси',
  vkusvill: 'ВкусВилл',
  monetka: 'Монетка',
  globus: 'Глобус',
  spar: 'SPAR',
  maria_ra: 'Мария-Ра',
};

/** Where public prices come from and why a chain has none — read from the published status. */
function PriceSources() {
  const [sources, setSources] = useState<Record<string, PriceSourceStatus> | null>(null);
  useEffect(() => {
    void fetchPriceSourcesStatus().then(setSources);
  }, []);
  if (!sources) return null;
  const line = (s: PriceSourceStatus) => {
    if (s.collected === false) return s.reason ?? 'Цены не собираются.';
    if (s.ok) {
      const parts = [s.period ? `период ${s.period}` : null, s.city ? `магазин в городе ${s.city}` : null, s.updated_at ? `обновлено ${dayMonth(s.updated_at.slice(0, 10))}` : null];
      return parts.filter(Boolean).join(', ');
    }
    return `Последний сбор не удался: ${s.error ?? 'причина неизвестна'}`;
  };
  return (
    <details className="disclosure">
      <summary>Источники цен</summary>
      <ul className="stack small" style={{ ['--gap' as string]: '6px', paddingLeft: 18 }}>
        {Object.entries(sources).map(([id, s]) => (
          <li key={id}>
            <strong>{CHAIN_LABELS[id] ?? s.name ?? id}</strong>: {line(s)}
          </li>
        ))}
      </ul>
      <p className="muted tiny">Средние цены Росстата — оценка для региона или города, а не цена конкретного магазина. Свои цены всегда важнее.</p>
    </details>
  );
}

function BudgetSection({ plan, setPlan }: { plan: PlanSettings; setPlan: (p: Partial<PlanSettings>) => void }) {
  const [value, setValue] = useState<number | null>(plan.budget.limit_kop !== null ? plan.budget.limit_kop / 100 : null);
  const error = budgetError(value);
  const commit = () => {
    if (error) return;
    // 0 ₽ means «no limit», the same as an empty field.
    const limit = value === null || value === 0 ? null : Math.round(value * 100);
    if (value === 0) setValue(null); // the field shows «Без лимита», not a puzzling «0»
    if (limit !== plan.budget.limit_kop) setPlan({ budget: { ...plan.budget, limit_kop: limit } });
  };
  return (
    <section className="card stack" id="budget">
      <h2>Бюджет</h2>
      <Field label="Лимит на покупки за весь период меню, ₽" hint="Для всей семьи. Проверяется по стоимости упаковок на кассе с учётом остатков дома. Пусто — без лимита." error={error}>
        <NumberInput decimal placeholder="Без лимита" value={value} onChange={setValue} invalid={Boolean(error)} onBlur={commit} />
      </Field>
      <p className="muted small">Если известны не все цены, статус будет «Бюджет не подтверждён» — мы не утверждаем, что меню укладывается в лимит.</p>
    </section>
  );
}

function PricesSection() {
  const { gateway, catalog, reportError, toast, household } = useApp();
  const location = useLocation();
  const prefill = new URLSearchParams(location.search).get('price');
  const { data, reload } = useLoad(() => gateway.listPrices(), [gateway, household?.store_chain_id, household?.city?.id]);
  const [open, setOpen] = useState(Boolean(prefill));
  const chainsLoad = useLoad(() => loadChains(), []);
  const chainNames = useMemo(() => new Map((chainsLoad.data ?? []).map((c) => [c.id, c.name])), [chainsLoad.data]);
  const own = data?.own ?? [];
  const publicEntries = (data?.profile.entries ?? []).filter((e) => e.kind && !['manual', 'receipt'].includes(e.kind));
  return (
    <section className="card stack" id="prices">
      <div className="row between">
        <h2>Цены</h2>
        <button className="btn small primary" onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} /> Цена
        </button>
      </div>
      <p className="muted small">
        Ваши цены всегда главнее. Если своей цены нет, используется цена сети в вашем городе (с сайта сети или медиана цен пользователей Foodo), затем средняя цена Росстата по региону — она помечается как оценка.
      </p>
      {own.length === 0 && publicEntries.length === 0 && <Banner icon="info">Пока цен нет — итог покупок будет неполным. Добавьте цены самых частых продуктов.</Banner>}
      {own.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Продукт</th>
                <th>Цена</th>
                <th>Дата</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {own.map((p) => (
                <tr key={p.id}>
                  <td>{catalog.products[p.product_id]?.name ?? p.product_id}</td>
                  <td className="num">
                    {rub(p.price_kop)} {pricePer(p.package_size, p.package_unit)}
                  </td>
                  <td className="small">
                    {dayMonth(p.date)}
                    <span className="muted" style={{ display: 'block' }}>
                      {p.chain_id ? (chainNames.get(p.chain_id) ?? p.chain_id) : 'любой магазин'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-btn small"
                      aria-label={`Удалить цену: ${catalog.products[p.product_id]?.name ?? p.product_id}`}
                      onClick={async () => {
                        try {
                          await gateway.deletePrice(p.id);
                          reload();
                        } catch (e) {
                          reportError(e);
                        }
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {publicEntries.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Цены из открытых источников: {publicEntries.length}</summary>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {publicEntries.map((p) => (
                  <tr key={p.product_id}>
                    <td>{catalog.products[p.product_id]?.name ?? p.product_id}</td>
                    <td className="num">
                      {rub(p.price_kop)} {pricePer(p.package_size, p.package_unit)}
                    </td>
                    <td className="small muted">
                      {KIND_NAMES[p.kind ?? ''] ?? p.source}, {dayMonth(p.date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {open && (
        <PriceSheet
          productId={prefill}
          chainName={household?.store_chain_id ? (chainNames.get(household.store_chain_id) ?? null) : null}
          onClose={() => setOpen(false)}
          onSaved={(shared) => {
            setOpen(false);
            reload();
            toast(shared ? 'Цена сохранена и анонимно передана в общую статистику' : 'Цена сохранена', { tone: 'success' });
          }}
        />
      )}
    </section>
  );
}


function PriceSheet({ productId, chainName, onClose, onSaved }: { productId: string | null; chainName: string | null; onClose: () => void; onSaved: (shared: boolean) => void }) {
  const { gateway, catalog, reportError, household } = useApp();
  const [product, setProduct] = useState<Product | null>(productId ? (catalog.products[productId] ?? null) : null);
  const [price, setPrice] = useState<number | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [unit, setUnit] = useState<NewPrice['package_unit']>('g');
  const [kind, setKind] = useState<'manual' | 'receipt'>('manual');
  const [loose, setLoose] = useState(false);
  // A price is either for the chosen chain or for any shop; nothing is tied to a chain silently.
  const [scope, setScope] = useState<'chain' | 'any'>(household?.store_chain_id ? 'chain' : 'any');
  useEffect(() => {
    if (product) {
      setUnit(product.package?.unit ?? (product.base_unit === 'ml' ? 'ml' : product.base_unit === 'pcs' ? 'pcs' : 'g'));
      setSize(product.package ? product.package.size : null);
    }
  }, [product]);
  const priceBad = price !== null && !(Number.isFinite(price) && price > 0 && price <= 100000);
  const sizeBad = size !== null && !(Number.isFinite(size) && size > 0 && size <= 100000);
  // Only units the product converts to: a price «за шт.» for flour would never reach the list.
  const units = (Object.keys(PRICE_UNITS) as NewPrice['package_unit'][]).filter((u) => !product || toBase(product, 1, u) !== null);
  const unitBad = product !== null && !units.includes(unit);
  const valid = product && price !== null && size !== null && !priceBad && !sizeBad && !unitBad;
  const save = async () => {
    if (!product || price === null || size === null) return;
    try {
      const chain_id = scope === 'chain' ? (household?.store_chain_id ?? null) : null;
      const r = await gateway.addPrices([{ product_id: product.id, price_kop: Math.round(price * 100), package_size: size, package_unit: unit, kind, chain_id, loose }]);
      onSaved(r.shared > 0);
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Цена продукта" footer={<button className="btn primary" disabled={!valid} onClick={() => void save()}>Сохранить</button>}>
      <div className="stack">
        <ProductPicker value={product?.id ?? null} onChange={setProduct} />
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Цена, ₽" error={priceBad ? 'Больше нуля.' : undefined}>
            <NumberInput decimal style={{ width: 130 }} value={price} onChange={setPrice} invalid={priceBad} />
          </Field>
          <Field label={loose ? 'Цена за' : 'Размер упаковки'} error={sizeBad ? 'Больше нуля.' : undefined}>
            <NumberInput decimal style={{ width: 110 }} value={size} onChange={setSize} invalid={sizeBad} />
          </Field>
          <Field label="Ед." error={unitBad ? 'Не подходит продукту.' : undefined}>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as NewPrice['package_unit'])}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {PRICE_UNITS[u]}
                </option>
              ))}
              {unitBad && <option value={unit}>{PRICE_UNITS[unit]}</option>}
            </select>
          </Field>
        </div>
        <Segmented
          label="Как продаётся"
          value={loose ? 'loose' : 'package'}
          onChange={(v) => {
            setLoose(v === 'loose');
            // A loose price is usually written «за 1 кг»: start there instead of the package size.
            if (v === 'loose' && product) {
              const u = product.base_unit === 'ml' ? 'l' : product.base_unit === 'pcs' ? 'pcs' : 'kg';
              setUnit(u);
              setSize(1);
            }
          }}
          options={[
            { value: 'package', label: 'Упаковкой' },
            { value: 'loose', label: 'На развес' },
          ]}
        />
        {loose && <p className="muted tiny">На развес покупается ровно нужное количество, без округления до упаковок.</p>}
        <Segmented label="Откуда цена" value={kind} onChange={setKind} options={[{ value: 'manual', label: 'Ввожу вручную' }, { value: 'receipt', label: 'Из чека' }]} />
        {household?.store_chain_id ? (
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <span className="label">Для какого магазина</span>
            <Segmented
              label="Для какого магазина"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'chain', label: `Только «${chainName ?? 'выбранная сеть'}»` },
                { value: 'any', label: 'Любой магазин' },
              ]}
            />
            <p className="muted tiny">Цена только для сети не применяется, если в настройках выбран другой магазин.</p>
          </div>
        ) : (
          <p className="muted tiny">Магазин не выбран — цена будет действовать для любого магазина.</p>
        )}
      </div>
    </Sheet>
  );
}
