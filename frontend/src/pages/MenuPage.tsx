import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isRecipeSafeFor, isoWeekday, recipeSkillRank, selectMethod, skillAllows, snapshotCatalog } from '../engine';
import type { Member, MemberReport, Menu, MenuItem, RankedCandidate, Recipe } from '../engine';
import type { MenuOp } from '../engine/menuOps';
import type { MenuRecord } from '../data/types';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { Banner, Empty, ErrorBox, Loading, PageHead, RecipeCover, Segmented, Sheet, Stepper } from '../ui/kit';
import { addDaysIso, dateRange, dayMonth, deviceTimeZone, humanDate, localDate, weekdayLong, weekdayShort } from '../lib/dates';
import { kcal, lowerFirst, minutes, num, plural, portionLabel } from '../lib/format';
import { matchesSearch, searchTokens, SLOT_NAMES, summarize } from '../lib/recipes';
import { useFullCatalog } from '../state/catalog';

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
  const [dish, setDish] = useState<{ itemId: string; date: string; slot: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // «Новое меню» from the home banner opens the sheet right away.
  const [newOpen, setNewOpen] = useState(() => searchParams.get('new') === '1');
  useEffect(() => {
    if (searchParams.get('new') === '1') setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const [adding, setAdding] = useState<{ date: string; slot: string; memberIds: string[] } | null>(null);
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
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? 'удалённый участник';

  // The latest record, for «Отменить» in a toast that may be pressed after later edits.
  const latest = useRef(record);
  latest.current = record;
  // Dishes «Заменить» has already offered for each meal item, so repeated taps go down the list.
  const offered = useRef(new Map<string, string[]>());
  useEffect(() => offered.current.clear(), [record?.id]);

  const undoAction = (next: MenuRecord, undo: MenuOp | undefined) =>
    undo
      ? async () => {
          // Undo only the last edit: after a later one the old revision would be stale.
          if (latest.current?.id !== next.id || latest.current.revision !== next.revision) {
            toast('Отменить уже нельзя: после этого меню снова изменилось.', { tone: 'error' });
            return;
          }
          try {
            setRecord(await gateway.applyOp(next.id, undo, next.revision));
          } catch (e) {
            reportError(e);
          }
        }
      : undefined;

  const runOp = async (op: MenuOp, opts: { undo?: MenuOp; message?: string } = {}) => {
    if (!record) return null;
    setBusy(true);
    try {
      const next = await gateway.applyOp(record.id, op, record.revision);
      setRecord(next);
      if (opts.message) toast(opts.message, { tone: 'success', undo: undoAction(next, opts.undo) });
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
    const seen = [...new Set([...(offered.current.get(ref.item.id) ?? []), ref.recipe.id])];
    const next = await runOp({ op: 'replace', item_id: ref.item.id, recipe_id: null, avoid: seen });
    if (next) {
      const batch = next.menu.batches.find((b) => b.id === next.menu.meals.flatMap((m) => m.items).find((i) => i.id === ref.item.id)?.batch_id);
      const name = batch ? next.menu.snapshot.recipes[batch.recipe_id]?.name : '';
      // Once every candidate was offered the engine starts over; so does the memory.
      offered.current.set(ref.item.id, batch && seen.includes(batch.recipe_id) ? [batch.recipe_id] : [...seen, ...(batch ? [batch.recipe_id] : [])]);
      toast(`Заменили на «${name}»`, {
        tone: 'success',
        undo: undoAction(next, { op: 'replace', item_id: ref.item.id, recipe_id: ref.recipe.id, method_id: ref.methodId }),
      });
    }
  };

  if (loading && !record) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!household) return <Loading />;
  if (members.length === 0) {
    return (
      <Empty page icon="users" title="Сначала семья" action={<Link className="btn primary" to="/start">Начать</Link>}>
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
  // A family of one has no «Все»: show that person's calories right away.
  const viewer = members.length === 1 ? (members[0] as Member).id : who;
  const memberFilter = (ref: DishRef) => viewer === 'all' || ref.item.portions[viewer] !== undefined;
  const dishRef = dish ? dishRefs(menu, record.cooked_batches, dish.date, dish.slot).find((r) => r.item.id === dish.itemId) : undefined;
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
              <Link className="btn small" to="/settings/shopping#budget">
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
        subtitle={`${menu.days} ${plural(menu.days, 'день', 'дня', 'дней')} · ${menu.member_ids.length} ${plural(menu.member_ids.length, 'человек', 'человека', 'человек')}`}
        actions={
          <>
            <Link className="btn ghost" to="/menu/history">
              <Icon name="list" size={18} /> История
            </Link>
            <Link className="btn ghost" to="/cooking">
              <Icon name="chef" size={18} /> Готовка
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
              <button key={d} className={`day-pill${d === today ? ' today' : ''}`} aria-pressed={d === current} aria-current={d === today ? 'date' : undefined} onClick={() => setDate(d)}>
                <span className="tiny">{weekdayShort(d)}</span>
                <b>{Number(d.slice(8))}</b>
              </button>
            ))}
          </div>
          <h2>{humanDate(current, today)}</h2>
          <div className="stack">
            {menu.slots.map((slot) => {
              const refs = dishRefs(menu, record.cooked_batches, current, slot).filter(memberFilter);
              const unfilled = unfilledNotes(menu, current, slot, viewer);
              const container = isContainerMeal(menu, current, slot);
              return (
                <section key={slot} className="meal">
                  <div className="meal-head">
                    <span className="meal-slot">{SLOT_NAMES[slot]}</span>
                    {container && <span className="badge">в контейнер</span>}
                  </div>
                  {refs.map((ref) => (
                    <DishCard
                      key={ref.item.id}
                      refData={ref}
                      members={members}
                      who={viewer}
                      today={today}
                      kcalFor={(id) => itemKcal(ref, id)}
                      busy={busy}
                      onReplace={() => void quickReplace(ref)}
                      onOpen={() => setDish({ itemId: ref.item.id, date: current, slot })}
                    />
                  ))}
                  {unfilled.map((u) => (
                    <div key={u.message} className="card flat" style={{ borderStyle: 'dashed' }}>
                      <p className="small">
                        <strong>Нет блюда{u.member_ids.length < menu.member_ids.length ? ` для: ${u.member_ids.map(memberName).join(', ')}` : ''}.</strong> {u.message}
                      </p>
                    </div>
                  ))}
                  {refs.length === 0 && unfilled.length === 0 && <p className="muted small">Ничего не запланировано.</p>}
                  {(refs.length === 0 || unfilled.length > 0) && (
                    <div>
                      <button className="btn small" onClick={() => setAdding({ date: current, slot, memberIds: unfilled.length > 0 ? [...new Set(unfilled.flatMap((u) => u.member_ids))] : menu.member_ids })}>
                        <Icon name="plus" size={16} /> Добавить блюдо
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <DayNutrition report={report} members={members} who={viewer} date={current} />
        </>
      ) : (
        <WeekView
          key={record.id}
          record={record}
          members={members}
          who={viewer}
          today={today}
          onOpen={(ref, d, slot) => setDish({ itemId: ref.item.id, date: d, slot })}
          onDay={(d) => {
            setDate(d);
            setView('day');
          }}
        />
      )}
      <VitaminPanel report={report} members={members} who={who} enabled={menu.settings.vitamins.enabled} targetSet={menu.settings.vitamins.target_set} />
      {dish && dishRef && (
        <DishSheet
          key={dish.itemId}
          record={record}
          dish={{ ref: dishRef, date: dish.date, slot: dish.slot }}
          members={members}
          busy={busy}
          today={today}
          onClose={() => setDish(null)}
          runOp={async (op, opts) => {
            const r = await runOp(op, opts);
            // The portion steppers stay open for a few taps; every other action finishes the sheet.
            if (r && op.op !== 'set_portion') setDish(null);
            return r;
          }}
          onCook={async () => {
            try {
              const r = await gateway.cook(record.id, dishRef.batchId);
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
      {adding && (
        <AddDishSheet
          target={adding}
          menu={menu}
          busy={busy}
          onClose={() => setAdding(null)}
          onAdd={async (recipeId) => {
            const r = await runOp({ op: 'add', date: adding.date, slot: adding.slot, recipe_id: recipeId, member_ids: adding.memberIds }, { message: 'Блюдо добавлено' });
            if (r) setAdding(null);
          }}
        />
      )}
      <NewMenuSheet open={newOpen} onClose={() => setNewOpen(false)} record={record} onCreated={(r) => { setCurrentMenuId(r.id); setRecord(r); navigate('/menu'); }} />
    </div>
  );
}

/** Unfilled notes of one meal, merged: the generator writes one per member with the same reason. */
function unfilledNotes(menu: Menu, date: string, slot: string, viewer: string): { message: string; member_ids: string[] }[] {
  const out: { message: string; member_ids: string[] }[] = [];
  for (const u of menu.unfilled) {
    if (u.date !== date || u.slot !== slot || (viewer !== 'all' && !u.member_ids.includes(viewer))) continue;
    const same = out.find((x) => x.message === u.message);
    if (same) same.member_ids = [...new Set([...same.member_ids, ...u.member_ids])];
    else out.push({ message: u.message, member_ids: [...u.member_ids] });
  }
  return out;
}

function isContainerMeal(menu: Menu, date: string, slot: string): boolean {
  return slot === 'lunch' && menu.settings.container_days.includes(isoWeekday(date));
}

function DishCard({
  refData,
  members,
  who,
  today,
  kcalFor,
  busy,
  onReplace,
  onOpen,
}: {
  refData: DishRef;
  members: Member[];
  who: string;
  today: string;
  kcalFor: (id: string) => number;
  busy: boolean;
  onReplace: () => void;
  onOpen: () => void;
}) {
  const r = refData.recipe;
  if (!r) return null;
  // The time of the cooking method chosen for this menu, not of the fastest one in the recipe.
  const method = r.methods.find((m) => m.id === refData.methodId) ?? r.methods[0];
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
            {method ? minutes(method.total_min) : '—'}
          </span>
          {who !== 'all' ? (
            <span>
              <Icon name="flame" size={15} />
              {kcal(kcalFor(who))}
            </span>
          ) : (
            <span>
              <Icon name="users" size={15} />
              {portions.length === members.length && portions.every(([, f]) => f === 1) ? 'всем по порции' : portions.map(([id, f]) => `${members.find((m) => m.id === id)?.name ?? 'удалённый участник'} — ${portionLabel(f)}`).join(' · ')}
            </span>
          )}
          {refData.item.pinned && <span className="badge blue">закреплено</span>}
          {refData.item.alternative_for && <span className="badge yellow">отдельное блюдо</span>}
          {refData.shared && <span className="badge">{batchNote(refData, today)}</span>}
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

/** «из партии» with when it is cooked: a future batch is not «приготовлена» yet. */
function batchNote(ref: DishRef, today: string): string {
  if (ref.cooked) return `партия от ${dayMonth(ref.cookDate)}`;
  return ref.cookDate >= today ? `партия: готовим ${ref.cookDate === today ? 'сегодня' : dayMonth(ref.cookDate)}` : `партия от ${dayMonth(ref.cookDate)}`;
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

function WeekView({
  record,
  members,
  who,
  today,
  onOpen,
  onDay,
}: {
  record: MenuRecord;
  members: Member[];
  who: string;
  today: string;
  onOpen: (ref: DishRef, date: string, slot: string) => void;
  onDay: (date: string) => void;
}) {
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
      {/* Each day is its own labelled section: the grid is a visual layout, not a data table. */}
      <div className="week-table" style={{ ['--rows' as string]: String(menu.slots.length + 1) }}>
        {pageDates.map((d) => (
          <section key={d} className="week-col" aria-labelledby={`week-${d}`}>
            <div className="row between">
              <h3 id={`week-${d}`} className="week-day">
                {d === today ? 'Сегодня' : `${weekdayShort(d)}, ${Number(d.slice(8))}`}
              </h3>
            </div>
            {menu.slots.map((slot) => {
              const refs = dishRefs(menu, record.cooked_batches, d, slot).filter((r) => who === 'all' || r.item.portions[who] !== undefined);
              const notes = unfilledNotes(menu, d, slot, who);
              return (
                <div key={slot} className="week-cell">
                  <div className="meal-slot tiny" style={{ marginBottom: 4 }}>
                    {SLOT_NAMES[slot]}
                  </div>
                  {refs.map((ref) => (
                    <button key={ref.item.id} className="week-dish" onClick={() => onOpen(ref, d, slot)}>
                      {ref.recipe && (
                        <span className="week-thumb" aria-hidden="true">
                          <RecipeCover recipe={ref.recipe} />
                        </span>
                      )}
                      {ref.recipe?.name}
                      {ref.item.pinned && ' 📌'}
                      {members.length > 1 && Object.keys(ref.item.portions).length < members.length && (
                        <span className="muted tiny"> · {Object.keys(ref.item.portions).map((id) => members.find((m) => m.id === id)?.name).join(', ')}</span>
                      )}
                    </button>
                  ))}
                  {notes.length > 0 && (
                    <button className="week-dish" onClick={() => onDay(d)} title={notes.map((n) => n.message).join(' ')}>
                      <span className="tiny" style={{ color: 'var(--accent)' }}>
                        нет блюда — почему?
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </section>
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
  today,
  onClose,
  runOp,
  onCook,
  onRecipe,
}: {
  record: MenuRecord;
  dish: { ref: DishRef; date: string; slot: string };
  members: Member[];
  busy: boolean;
  today: string;
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
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? 'удалённый участник';
  const dates = [...new Set(menu.meals.map((m) => m.date))];
  return (
    <Sheet open onClose={onClose} title={recipe?.name ?? 'Блюдо'}>
      <div className="stack">
        <p className="muted small">
          {humanDate(dish.date)} · {SLOT_NAMES[dish.slot]}
          {ref.shared ? ` · ${batchNote(ref, today)}` : ''}
          {isContainerMeal(menu, dish.date, dish.slot) ? ' · в контейнер' : ''}
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
          <button
            className="btn danger"
            onClick={() =>
              void runOp(
                { op: 'remove', item_id: ref.item.id },
                {
                  message: 'Блюдо убрано из меню',
                  // Undo puts back the same dish: its portions, pin and batch.
                  undo: recipe ? { op: 'add', date: dish.date, slot: dish.slot, recipe_id: recipe.id, member_ids: eaters, method_id: ref.methodId, portions: { ...ref.item.portions }, pinned: ref.item.pinned, batch_id: ref.batchId } : undefined,
                },
              )
            }
          >
            <Icon name="trash" size={18} /> Убрать
          </button>
        </div>
        {moveOpen && (
          <div className="card soft stack fade-in">
            <span className="label">Поменять местами с приёмом пищи</span>
            {/* One row per day: a flat list of 4 × 7 chips was hard to scan. */}
            <div className="move-days">
              {dates.map((d) => (
                <div key={d} className="move-day" role="group" aria-label={`${weekdayLong(d)}, ${dayMonth(d)}`}>
                  <span className="move-day-name">
                    {weekdayShort(d)} <b>{Number(d.slice(8))}</b>
                  </span>
                  <div className="chips">
                    {menu.slots.map((s) =>
                      d === dish.date && s === dish.slot ? (
                        <span key={s} className="chip current" aria-current="true">
                          {SLOT_NAMES[s]} · сейчас
                        </span>
                      ) : (
                        <button
                          key={s}
                          className="chip"
                          disabled={busy}
                          aria-label={`${`${weekdayLong(d)}, ${dayMonth(d)}`}, ${SLOT_NAMES[s]?.toLowerCase()}`}
                          onClick={() => void runOp({ op: 'move', from: { date: dish.date, slot: dish.slot }, to: { date: d, slot: s } }, { message: 'Приёмы пищи поменялись местами', undo: { op: 'move', from: { date: d, slot: s }, to: { date: dish.date, slot: dish.slot } } })}
                        >
                          {SLOT_NAMES[s]}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
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
            {[...new Set([1, 3, 7, 14, 30, 35, household?.settings.days ?? 7])]
              .sort((a, b) => a - b)
              .map((d) => (
                <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d} {plural(d, 'день', 'дня', 'дней')}
                </button>
              ))}
          </div>
        </div>
        <button className="btn primary big" onClick={() => void generate()} disabled={busy} data-autofocus>
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

/** A dish for an empty meal: recipes for this meal that are safe for everyone eating it. */
function AddDishSheet({ target, menu, busy, onClose, onAdd }: { target: { date: string; slot: string; memberIds: string[] }; menu: Menu; busy: boolean; onClose: () => void; onAdd: (recipeId: string) => Promise<void> }) {
  const { household } = useApp();
  const { catalog } = useFullCatalog();
  const [query, setQuery] = useState('');
  const settings = menu.settings;
  const used = useMemo(() => new Set(menu.batches.map((b) => b.recipe_id)), [menu]);
  const weekend = [0, 6].includes(new Date(`${target.date}T00:00:00Z`).getUTCDay());
  const limit = weekend && settings.max_total_min_weekend !== undefined ? settings.max_total_min_weekend : settings.max_total_min;
  const unique = settings.repeat.mode === 'unique';
  const fitting = useMemo(() => {
    const people = (household?.members ?? []).filter((m) => target.memberIds.includes(m.id));
    return Object.values(catalog.recipes)
      .filter(
        (r) =>
          r.meal_types.includes(target.slot) &&
          selectMethod(r, settings.equipment) !== null &&
          skillAllows(settings.skill, recipeSkillRank(catalog.reference, r)) &&
          people.every((m) => isRecipeSafeFor(catalog, r, m)),
      )
      .map((r) => {
        const s = summarize(catalog, r);
        const inMenu = used.has(r.id);
        const tooLong = limit !== null && s.totalMin > limit;
        const liked = people.some((m) => m.preferences.liked_recipes.includes(r.id));
        // Liked and quick-enough dishes first; ones already in the menu or over the time limit last.
        const rank = (liked ? 0 : 1) + (tooLong ? 2 : 0) + (inMenu ? 4 : 0);
        return { r, s, inMenu, tooLong, liked, rank };
      })
      .sort((a, b) => a.rank - b.rank || a.r.name.localeCompare(b.r.name, 'ru'));
  }, [catalog, target, household, settings, used, limit]);
  const tokens = searchTokens(query);
  const shown = fitting.filter((x) => matchesSearch(x.r.name, tokens)).slice(0, 30);
  return (
    <Sheet open onClose={onClose} title={`${SLOT_NAMES[target.slot]}, ${lowerFirst(humanDate(target.date))}`}>
      <div className="stack">
        <input className="input" type="search" placeholder="Блюдо или продукт" aria-label="Поиск блюда" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
        <p className="muted small">
          {fitting.length > 0
            ? `Подходят ${fitting.length} ${plural(fitting.length, 'рецепт', 'рецепта', 'рецептов')}: с учётом запретов, техники и уровня готовки.`
            : 'Ни один рецепт не подходит под запреты, технику и уровень готовки для этого приёма пищи.'}
        </p>
        {shown.map(({ r, s, inMenu, tooLong, liked }) => {
          // «Разные блюда каждый день» does not allow a dish that is already in this menu.
          const blocked = unique && inMenu;
          return (
            <button key={r.id} className="card flat row pick-dish" disabled={busy || blocked} onClick={() => void onAdd(r.id)}>
              <span style={{ width: 52, height: 52, flex: 'none' }}>
                <RecipeCover recipe={r} rounded />
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong>{r.name}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  {minutes(s.totalMin)} · {kcal(s.perServing.kcal.value)} на порцию
                </span>
                {(liked || inMenu || tooLong) && (
                  <span className="row wrap" style={{ ['--gap' as string]: '4px', marginTop: 4 }}>
                    {liked && <span className="badge green">любимое</span>}
                    {inMenu && <span className="badge">{blocked ? 'уже в меню — повторы выключены' : 'уже в меню'}</span>}
                    {tooLong && <span className="badge yellow">дольше лимита времени</span>}
                  </span>
                )}
              </span>
              {!blocked && <Icon name="plus" size={18} />}
            </button>
          );
        })}
        {query && fitting.length > 0 && shown.length === 0 && <p className="muted small">Ничего не нашлось — попробуйте другое слово.</p>}
      </div>
    </Sheet>
  );
}
