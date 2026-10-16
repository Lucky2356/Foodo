import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { snapshotCatalog } from '../engine';
import type { Member, MemberReport, Menu, MenuItem, RankedCandidate, Recipe } from '../engine';
import type { MenuOp } from '../engine/menuOps';
import type { MenuRecord } from '../data/types';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { Banner, Empty, ErrorBox, Loading, PageHead, RecipeCover, Segmented, Sheet, Stepper } from '../ui/kit';
import { addDaysIso, dateRange, dayMonth, deviceTimeZone, humanDate, localDate, weekdayShort } from '../lib/dates';
import { kcal, minutes, num, portionLabel } from '../lib/format';
import { SLOT_NAMES, summarize } from '../lib/recipes';

const VITAMIN_NAMES: Record<string, string> = { vit_a: 'Витамин A', vit_c: 'Витамин C', vit_d: 'Витамин D', vit_e: 'Витамин E', vit_b6: 'Витамин B6', vit_b12: 'Витамин B12', folate: 'Фолаты' };

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 960px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 960px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

interface DishRef {
  item: MenuItem;
  recipe: Recipe | undefined;
  batchId: string;
  methodId: string;
  shared: boolean;
  cooked: boolean;
  cookDate: string;
}

function dishRefs(menu: Menu, cooked: string[], date: string, slot: string): DishRef[] {
  const meal = menu.meals.find((m) => m.date === date && m.slot === slot);
  if (!meal) return [];
  return meal.items.map((item) => {
    const batch = menu.batches.find((b) => b.id === item.batch_id);
    const uses = menu.meals.reduce((n, m) => n + m.items.filter((i) => i.batch_id === item.batch_id).length, 0);
    return {
      item,
      recipe: batch ? menu.snapshot.recipes[batch.recipe_id] : undefined,
      batchId: item.batch_id,
      methodId: batch?.method_id ?? '',
      shared: uses > 1,
      cooked: cooked.includes(item.batch_id),
      cookDate: batch?.cook_date ?? date,
    };
  });
}

export default function MenuPage() {
  const { menuId } = useParams();
  const app = useApp();
  const { gateway, household, catalog, reportError, toast, setCurrentMenuId } = app;
  const navigate = useNavigate();
  const { record, setRecord, loading, error, reload } = useCurrentMenu(menuId);
  const wide = useIsWide();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [who, setWho] = useState<string>('all');
  const [date, setDate] = useState<string | null>(null);
  const [report, setReport] = useState<MemberReport[] | null>(null);
  const [dish, setDish] = useState<{ ref: DishRef; date: string; slot: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tz = household?.city?.timezone ?? deviceTimeZone();
  const today = localDate(tz);

  useEffect(() => setView(wide ? 'week' : 'day'), [wide]);
  useEffect(() => {
    if (!record) return;
    const dates = record.menu.meals.map((m) => m.date);
    setDate((d) => (d && dates.includes(d) ? d : dates.includes(today) ? today : (dates[0] ?? null)));
    gateway.getReport(record.id).then(setReport).catch(() => setReport(null));
  }, [record, gateway, today]);

  const snap = useMemo(() => (record ? snapshotCatalog(record.menu, catalog) : catalog), [record, catalog]);
  const members = household?.members ?? [];
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? '—';

  const runOp = async (op: MenuOp, opts: { undo?: MenuOp; message?: string } = {}) => {
    if (!record) return null;
    setBusy(true);
    try {
      const next = await gateway.applyOp(record.id, op, record.revision);
      setRecord(next);
      if (opts.message) {
        toast(opts.message, {
          tone: 'success',
          undo: opts.undo
            ? async () => {
                try {
                  setRecord(await gateway.applyOp(next.id, opts.undo as MenuOp, next.revision));
                } catch (e) {
                  reportError(e);
                }
              }
            : undefined,
        });
      }
      return next;
    } catch (e) {
      reportError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const quickReplace = async (ref: DishRef) => {
    if (!ref.recipe) return;
    const next = await runOp({ op: 'replace', item_id: ref.item.id, recipe_id: null }, { undo: { op: 'replace', item_id: ref.item.id, recipe_id: ref.recipe.id, method_id: ref.methodId } });
    if (next) {
      const batch = next.menu.batches.find((b) => b.id === next.menu.meals.flatMap((m) => m.items).find((i) => i.id === ref.item.id)?.batch_id);
      const name = batch ? next.menu.snapshot.recipes[batch.recipe_id]?.name : '';
      toast(`Заменили на «${name}»`, {
        tone: 'success',
        undo: async () => {
          try {
            setRecord(await gateway.applyOp(next.id, { op: 'replace', item_id: ref.item.id, recipe_id: ref.recipe?.id ?? null, method_id: ref.methodId }, next.revision));
          } catch (e) {
            reportError(e);
          }
        },
      });
    }
  };

  if (loading && !record) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!household) return <Loading />;
  if (members.length === 0) {
    return (
      <Empty icon="users" title="Сначала семья" action={<Link className="btn primary" to="/start">Начать</Link>}>
        Укажите, для кого готовим, — меню соберётся сразу.
      </Empty>
    );
  }
  if (!record) {
    return (
      <>
        <PageHead title="Меню" />
        <Empty icon="calendar" title="Меню ещё нет" action={<button className="btn primary big" onClick={() => setNewOpen(true)}>Составить меню</button>}>
          Соберём завтраки, обеды, перекусы и ужины с учётом запретов и техники на кухне.
        </Empty>
        <NewMenuSheet open={newOpen} onClose={() => setNewOpen(false)} record={null} onCreated={(r) => { setCurrentMenuId(r.id); setRecord(r); }} />
      </>
    );
  }

  const menu = record.menu;
  const dates = [...new Set(menu.meals.map((m) => m.date))];
  const current = date ?? dates[0] ?? today;
  const end = addDaysIso(menu.start_date, menu.days - 1);
  const memberFilter = (ref: DishRef) => who === 'all' || ref.item.portions[who] !== undefined;
  const itemKcal = (ref: DishRef, memberId: string) => (ref.recipe ? summarize(snap, ref.recipe).perServing.kcal.value * (ref.item.portions[memberId] ?? 0) : 0);

  const problems = (
    <>
      {menu.conflicts.map((c, i) => (
        <Banner key={`${c.code}-${i}`} tone="warn" icon="warn">
          <strong>{c.message}</strong> {c.suggestion}
          {c.code === 'unique_mode_catalog_too_small' && (
            <div style={{ marginTop: 10 }}>
              <button
                className="btn small"
                onClick={async () => {
                  await gateway.updateHousehold({ settings: { ...household.settings, plan: { ...household.settings.plan, repeat: { ...household.settings.plan.repeat, mode: 'allow' } } } });
                  await app.refreshHousehold();
                  setNewOpen(true);
                }}
              >
                Разрешить повторы
              </button>
            </div>
          )}
          {c.code === 'budget_exceeded' && (
            <div style={{ marginTop: 10 }}>
              <Link className="btn small" to="/settings#budget">
                Изменить бюджет
              </Link>
            </div>
          )}
        </Banner>
      ))}
      {menu.warnings.map((w) => (
        <Banner key={w} icon="info">
          {w}
        </Banner>
      ))}
    </>
  );

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <PageHead
        eyebrow={record.title || 'Меню'}
        title={dateRange(menu.start_date, end)}
        subtitle={`${menu.days} ${menu.days === 1 ? 'день' : menu.days < 5 ? 'дня' : 'дней'} · ${members.length} ${members.length === 1 ? 'человек' : 'чел.'}`}
        actions={
          <>
            <Link className="btn ghost" to="/menu/history">
              <Icon name="list" size={18} /> История
            </Link>
            <button className="btn primary" onClick={() => setNewOpen(true)}>
              <Icon name="sparkle" size={18} /> Новое меню
            </button>
          </>
        }
      />
      {problems}
      <div className="row wrap between">
        {members.length > 1 && (
          <Segmented label="Чьё меню показать" value={who} onChange={setWho} options={[{ value: 'all', label: 'Все' }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
        )}
        <Segmented label="Вид" value={view} onChange={(v) => setView(v)} options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }]} />
      </div>
      {view === 'day' ? (
        <>
          <div className="day-strip" role="group" aria-label="Дни меню">
            {dates.map((d) => (
              <button key={d} className="day-pill" aria-pressed={d === current} onClick={() => setDate(d)}>
                <span className="tiny">{d === today ? 'сег.' : weekdayShort(d)}</span>
                <b>{Number(d.slice(8))}</b>
              </button>
            ))}
          </div>
          <h2>{humanDate(current, today)}</h2>
          <div className="stack">
            {menu.slots.map((slot) => {
              const refs = dishRefs(menu, record.cooked_batches, current, slot).filter(memberFilter);
              const unfilled = menu.unfilled.filter((u) => u.date === current && u.slot === slot && (who === 'all' || u.member_ids.includes(who)));
              return (
                <section key={slot} className="meal">
                  <div className="meal-head">
                    <span className="meal-slot">{SLOT_NAMES[slot]}</span>
                  </div>
                  {refs.map((ref) => (
                    <DishCard
                      key={ref.item.id}
                      refData={ref}
                      members={members}
                      who={who}
                      kcalFor={(id) => itemKcal(ref, id)}
                      busy={busy}
                      onReplace={() => void quickReplace(ref)}
                      onOpen={() => setDish({ ref, date: current, slot })}
                    />
                  ))}
                  {unfilled.map((u, i) => (
                    <div key={i} className="card flat" style={{ borderStyle: 'dashed' }}>
                      <p className="small">
                        <strong>Нет блюда{u.member_ids.length < members.length ? ` для: ${u.member_ids.map(memberName).join(', ')}` : ''}.</strong> {u.message}
                      </p>
                    </div>
                  ))}
                  {refs.length === 0 && unfilled.length === 0 && <p className="muted small">Ничего не запланировано.</p>}
                </section>
              );
            })}
          </div>
          <DayNutrition report={report} members={members} who={who} date={current} />
        </>
      ) : (
        <WeekView record={record} members={members} who={who} today={today} onOpen={(ref, d, slot) => setDish({ ref, date: d, slot })} />
      )}
      <VitaminPanel report={report} members={members} who={who} enabled={menu.settings.vitamins.enabled} targetSet={menu.settings.vitamins.target_set} />
      {dish && (
        <DishSheet
          record={record}
          dish={dish}
          members={members}
          busy={busy}
          onClose={() => setDish(null)}
          runOp={async (op, opts) => {
            const r = await runOp(op, opts);
            if (r) setDish(null);
            return r;
          }}
          onCook={async () => {
            try {
              const r = await gateway.cook(record.id, dish.ref.batchId);
              toast(r.created ? 'Отмечено: продукты списаны из остатков дома' : 'Это блюдо уже отмечено приготовленным', { tone: 'success' });
              setDish(null);
              reload();
            } catch (e) {
              reportError(e);
            }
          }}
          onRecipe={(id) => navigate(`/recipes/${id}`)}
        />
      )}
      <NewMenuSheet open={newOpen} onClose={() => setNewOpen(false)} record={record} onCreated={(r) => { setCurrentMenuId(r.id); setRecord(r); navigate('/menu'); }} />
    </div>
  );
}

function DishCard({ refData, members, who, kcalFor, busy, onReplace, onOpen }: { refData: DishRef; members: Member[]; who: string; kcalFor: (id: string) => number; busy: boolean; onReplace: () => void; onOpen: () => void }) {
  const { catalog } = useApp();
  const r = refData.recipe;
  if (!r) return null;
  const s = summarize(catalog.recipes[r.id] ? catalog : { ...catalog, recipes: { ...catalog.recipes, [r.id]: r } }, r);
  const portions = Object.entries(refData.item.portions);
  return (
    <div className="card dish fade-in">
      <button onClick={onOpen} className="thumb" style={{ border: 0, padding: 0, cursor: 'pointer', background: 'none' }} aria-label={`Действия: ${r.name}`}>
        <RecipeCover recipe={r} rounded />
      </button>
      <div style={{ minWidth: 0 }}>
        <Link to={`/recipes/${r.id}`} className="dish-title">
          {r.name}
        </Link>
        <div className="meta" style={{ marginTop: 4 }}>
          <span>
            <Icon name="clock" size={15} />
            {minutes(s.totalMin)}
          </span>
          {who !== 'all' ? (
            <span>
              <Icon name="flame" size={15} />
              {kcal(kcalFor(who))}
            </span>
          ) : (
            <span>
              <Icon name="users" size={15} />
              {portions.length === members.length && portions.every(([, f]) => f === 1) ? 'всем по порции' : portions.map(([id, f]) => `${members.find((m) => m.id === id)?.name ?? '—'} ${num(f, 2)}`).join(' · ')}
            </span>
          )}
          {refData.item.pinned && <span className="badge blue">закреплено</span>}
          {refData.item.alternative_for && <span className="badge yellow">отдельное блюдо</span>}
          {refData.shared && <span className="badge">из партии</span>}
          {refData.cooked && <span className="badge green">приготовлено</span>}
        </div>
        <div className="dish-actions">
          <button className="btn small" onClick={onReplace} disabled={busy || refData.item.pinned} title={refData.item.pinned ? 'Снимите закрепление, чтобы заменить' : undefined}>
            <Icon name="swap" size={16} /> Заменить
          </button>
          <button className="btn small ghost" onClick={onOpen}>
            Ещё
          </button>
        </div>
      </div>
    </div>
  );
}

function DayNutrition({ report, members, who, date }: { report: MemberReport[] | null; members: Member[]; who: string; date: string }) {
  if (!report) return null;
  const rows = report.filter((r) => who === 'all' || r.member_id === who);
  return (
    <section className="card">
      <h3 style={{ marginBottom: 12 }}>КБЖУ за день</h3>
      <div className="stack">
        {rows.map((r) => {
          const d = r.days.find((x) => x.date === date);
          if (!d) return null;
          const incomplete = !d.totals.kcal.complete || !d.totals.protein.complete;
          return (
            <div key={r.member_id} className="stack" style={{ ['--gap' as string]: '8px' }}>
              {members.length > 1 && <strong>{r.name}</strong>}
              <div className="kbju">
                <div>
                  <b>{num(d.totals.kcal.value)}</b>
                  <small>ккал</small>
                </div>
                <div>
                  <b>{num(d.totals.protein.value)}</b>
                  <small>белки, г</small>
                </div>
                <div>
                  <b>{num(d.totals.fat.value)}</b>
                  <small>жиры, г</small>
                </div>
                <div>
                  <b>{num(d.totals.carbs.value)}</b>
                  <small>углев., г</small>
                </div>
              </div>
              {d.energy_target && d.energy_deviation_pct !== null && (
                <p className={`small ${d.energy_status === 'ok' ? '' : 'muted'}`}>
                  Цель {num(d.energy_target)} ккал:{' '}
                  {d.energy_status === 'ok' ? 'в пределах допуска' : `${d.energy_deviation_pct > 0 ? 'больше' : 'меньше'} на ${num(Math.abs(d.energy_deviation_pct))}%`}
                </p>
              )}
              {incomplete && <p className="muted tiny">Для части продуктов нет данных — значения могут быть занижены.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function VitaminPanel({ report, members, who, enabled, targetSet }: { report: MemberReport[] | null; members: Member[]; who: string; enabled: boolean; targetSet: string | null }) {
  const [open, setOpen] = useState(false);
  if (!report || !targetSet) return null;
  const rows = report.filter((r) => who === 'all' || r.member_id === who);
  return (
    <section className="card">
      <button className="row between" style={{ width: '100%', border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <h3>Витамины за период</h3>
        <span className="row">
          {enabled ? <span className="badge green">учитываются в подборе</span> : <span className="badge">только отчёт</span>}
          <Icon name="down" size={18} />
        </span>
      </button>
      {open && (
        <div className="stack fade-in" style={{ marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.member_id} className="table-wrap">
              {members.length > 1 && <strong>{r.name}</strong>}
              <table className="table">
                <thead>
                  <tr>
                    <th>Витамин</th>
                    <th>Покрытие</th>
                    <th>Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {r.vitamins.map((v) => (
                    <tr key={v.nutrient}>
                      <td>{VITAMIN_NAMES[v.nutrient]}</td>
                      <td className="num">
                        {v.coverage_pct !== null ? `${num(v.coverage_pct)}%` : v.lower_bound_pct !== null ? `не менее ${num(v.lower_bound_pct)}%` : 'не проверяется'}
                      </td>
                      <td className="small muted">{v.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="muted tiny">Данные о витаминах в стартовой базе оценочные. Это не медицинская оценка и не назначение добавок.</p>
        </div>
      )}
    </section>
  );
}

function WeekView({ record, members, who, today, onOpen }: { record: MenuRecord; members: Member[]; who: string; today: string; onOpen: (ref: DishRef, date: string, slot: string) => void }) {
  const menu = record.menu;
  const dates = [...new Set(menu.meals.map((m) => m.date))];
  const [page, setPage] = useState(0);
  const pageDates = dates.slice(page * 7, page * 7 + 7);
  return (
    <section className="stack">
      {dates.length > 7 && (
        <div className="row">
          <button className="btn small ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <Icon name="back" size={16} /> Раньше
          </button>
          <span className="muted small">
            {dayMonth(pageDates[0] as string)} — {dayMonth(pageDates[pageDates.length - 1] as string)}
          </span>
          <button className="btn small ghost" disabled={(page + 1) * 7 >= dates.length} onClick={() => setPage((p) => p + 1)}>
            Позже <Icon name="chevron" size={16} />
          </button>
        </div>
      )}
      <div className="week-table" role="table" aria-label="Меню на неделю">
        {pageDates.map((d) => (
          <div key={d} className="week-col" role="rowgroup">
            <div className="row between" role="columnheader">
              <strong>{d === today ? 'Сегодня' : `${weekdayShort(d)}, ${Number(d.slice(8))}`}</strong>
            </div>
            {menu.slots.map((slot) => {
              const refs = dishRefs(menu, record.cooked_batches, d, slot).filter((r) => who === 'all' || r.item.portions[who] !== undefined);
              const empty = menu.unfilled.some((u) => u.date === d && u.slot === slot);
              return (
                <div key={slot} className="week-cell" role="cell">
                  <div className="meal-slot tiny" style={{ marginBottom: 4 }}>
                    {SLOT_NAMES[slot]}
                  </div>
                  {refs.map((ref) => (
                    <button
                      key={ref.item.id}
                      onClick={() => onOpen(ref, d, slot)}
                      style={{ display: 'block', border: 0, background: 'none', padding: '2px 0', textAlign: 'left', cursor: 'pointer', fontWeight: 600, color: 'var(--text)' }}
                    >
                      {ref.recipe?.name}
                      {ref.item.pinned && ' 📌'}
                      {members.length > 1 && Object.keys(ref.item.portions).length < members.length && (
                        <span className="muted tiny"> · {Object.keys(ref.item.portions).map((id) => members.find((m) => m.id === id)?.name).join(', ')}</span>
                      )}
                    </button>
                  ))}
                  {empty && <span className="tiny" style={{ color: 'var(--accent)' }}>нет блюда</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function DishSheet({
  record,
  dish,
  members,
  busy,
  onClose,
  runOp,
  onCook,
  onRecipe,
}: {
  record: MenuRecord;
  dish: { ref: DishRef; date: string; slot: string };
  members: Member[];
  busy: boolean;
  onClose: () => void;
  runOp: (op: MenuOp, opts?: { undo?: MenuOp; message?: string }) => Promise<MenuRecord | null>;
  onCook: () => Promise<void>;
  onRecipe: (id: string) => void;
}) {
  const { gateway, reportError } = useApp();
  const { ref } = dish;
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const menu = record.menu;
  const recipe = ref.recipe;
  const loadCandidates = async () => {
    try {
      setCandidates(await gateway.candidates(record.id, ref.item.id));
    } catch (e) {
      reportError(e);
    }
  };
  const eaters = Object.keys(ref.item.portions);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? '—';
  const dates = [...new Set(menu.meals.map((m) => m.date))];
  return (
    <Sheet open onClose={onClose} title={recipe?.name ?? 'Блюдо'}>
      <div className="stack">
        <p className="muted small">
          {humanDate(dish.date)} · {SLOT_NAMES[dish.slot]}
          {ref.shared ? ` · партия приготовлена ${dayMonth(ref.cookDate)}` : ''}
        </p>
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          <span className="label">Порции</span>
          {eaters.map((id) => (
            <div key={id} className="row between">
              <span>{name(id)}</span>
              <Stepper
                label={`Порция: ${name(id)}`}
                value={ref.item.portions[id] as number}
                min={0.25}
                max={3}
                step={0.25}
                format={(v) => portionLabel(v)}
                onChange={(v) =>
                  void runOp({ op: 'set_portion', item_id: ref.item.id, member_id: id, portion: v }, { message: `Порция: ${name(id)} — ${portionLabel(v)}`, undo: { op: 'set_portion', item_id: ref.item.id, member_id: id, portion: ref.item.portions[id] as number } })
                }
              />
            </div>
          ))}
        </div>
        <div className="row wrap">
          {recipe && (
            <button className="btn" onClick={() => onRecipe(recipe.id)}>
              <Icon name="book" size={18} /> Рецепт
            </button>
          )}
          <button
            className="btn"
            onClick={() => void runOp({ op: 'pin', item_id: ref.item.id, pinned: !ref.item.pinned }, { message: ref.item.pinned ? 'Закрепление снято' : 'Блюдо закреплено — пересборка его не тронет', undo: { op: 'pin', item_id: ref.item.id, pinned: ref.item.pinned } })}
          >
            <Icon name="pin" size={18} /> {ref.item.pinned ? 'Открепить' : 'Закрепить'}
          </button>
          <button className="btn" onClick={() => setMoveOpen((v) => !v)} aria-expanded={moveOpen}>
            <Icon name="calendar" size={18} /> Перенести
          </button>
          <button className="btn" onClick={() => void onCook()} disabled={ref.cooked}>
            <Icon name="check" size={18} /> {ref.cooked ? 'Приготовлено' : 'Приготовлено — списать продукты'}
          </button>
          <button className="btn danger" onClick={() => void runOp({ op: 'remove', item_id: ref.item.id }, { message: 'Блюдо убрано из меню', undo: recipe ? { op: 'add', date: dish.date, slot: dish.slot, recipe_id: recipe.id, member_ids: eaters, method_id: ref.methodId } : undefined })}>
            <Icon name="trash" size={18} /> Убрать
          </button>
        </div>
        {moveOpen && (
          <div className="card soft stack fade-in">
            <span className="label">Поменять местами с приёмом пищи</span>
            <div className="chips">
              {dates.flatMap((d) =>
                menu.slots
                  .filter((s) => !(d === dish.date && s === dish.slot))
                  .map((s) => (
                    <button
                      key={`${d}-${s}`}
                      className="chip"
                      onClick={() => void runOp({ op: 'move', from: { date: dish.date, slot: dish.slot }, to: { date: d, slot: s } }, { message: 'Приёмы пищи поменялись местами', undo: { op: 'move', from: { date: d, slot: s }, to: { date: dish.date, slot: dish.slot } } })}
                    >
                      {weekdayShort(d)} {Number(d.slice(8))} · {SLOT_NAMES[s]}
                    </button>
                  )),
              )}
            </div>
          </div>
        )}
        {eaters.length > 1 && (
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">Отдельное блюдо для одного участника</span>
            <div className="chips">
              {eaters.map((id) => (
                <button key={id} className="chip" disabled={busy} onClick={() => void runOp({ op: 'split', item_id: ref.item.id, member_id: id, recipe_id: null }, { message: `Для «${name(id)}» подобрано отдельное блюдо` })}>
                  {name(id)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <div className="row between">
            <span className="label">Другие варианты</span>
            {!candidates && (
              <button className="btn small ghost" onClick={() => void loadCandidates()}>
                Показать
              </button>
            )}
          </div>
          {candidates && candidates.length === 0 && <p className="muted small">Других подходящих блюд нет с учётом запретов, техники и режима повторов.</p>}
          {candidates?.slice(0, 8).map((c) => {
            const cr = menu.snapshot.recipes[c.recipe_id];
            return (
              <button
                key={c.recipe_id}
                className="card flat row"
                style={{ textAlign: 'left', cursor: 'pointer', padding: 10 }}
                disabled={busy || c.recipe_id === recipe?.id}
                onClick={() => void runOp({ op: 'replace', item_id: ref.item.id, recipe_id: c.recipe_id, method_id: c.method_id }, { message: 'Блюдо заменено', undo: recipe ? { op: 'replace', item_id: ref.item.id, recipe_id: recipe.id, method_id: ref.methodId } : undefined })}
              >
                <CandidateName id={c.recipe_id} fallback={cr?.name} />
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function CandidateName({ id, fallback }: { id: string; fallback?: string }) {
  const { catalog } = useApp();
  const r = catalog.recipes[id];
  return (
    <>
      <span style={{ width: 52, height: 52, flex: 'none' }}>{r && <RecipeCover recipe={r} rounded />}</span>
      <span className="grow">
        <strong>{r?.name ?? fallback ?? id}</strong>
        {r && <span className="muted small" style={{ display: 'block' }}>{minutes(summarize(catalog, r).totalMin)}</span>}
      </span>
      <Icon name="swap" size={18} />
    </>
  );
}

function NewMenuSheet({ open, onClose, record, onCreated }: { open: boolean; onClose: () => void; record: MenuRecord | null; onCreated: (r: MenuRecord) => void }) {
  const { gateway, household, reportError, toast } = useApp();
  const tz = household?.city?.timezone ?? deviceTimeZone();
  const today = localDate(tz);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState(household?.settings.days ?? 7);
  const [busy, setBusy] = useState(false);
  const hasPins = record?.menu.meals.some((m) => m.items.some((i) => i.pinned)) ?? false;
  const generate = async () => {
    setBusy(true);
    try {
      const r = await gateway.generateMenu({ start_date: start, days });
      onCreated(r);
      onClose();
      toast('Новое меню готово. Прошлое сохранено в истории.', { tone: 'success' });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const regenerate = async () => {
    if (!record) return;
    setBusy(true);
    try {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] as number;
      const r = await gateway.applyOp(record.id, { op: 'regenerate', seed }, record.revision);
      onCreated(r);
      onClose();
      toast('Незакреплённые блюда подобраны заново', { tone: 'success' });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Новое меню">
      <div className="stack">
        <label className="field">
          <span>Начало</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">На сколько дней</span>
          <div className="chips">
            {[1, 3, 7, 14, 28, 35].map((d) => (
              <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary big" onClick={() => void generate()} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="sparkle" size={18} />} Составить
        </button>
        {record && (
          <>
            <hr className="sep" />
            <p className="muted small">
              {hasPins ? 'Закреплённые блюда останутся на своих местах, остальные подберутся заново.' : 'Закрепите блюда, которые хотите оставить, — пересборка их не тронет.'}
            </p>
            <button className="btn" onClick={() => void regenerate()} disabled={busy}>
              <Icon name="swap" size={18} /> Пересобрать текущее меню
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
