import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ManualLine } from '../engine';
import type { ShoppingView } from '../data/types';
import { downloadBlob } from '../data/backup';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { CityChooser } from '../ui/CityChooser';
import { Banner, Empty, ErrorBox, Field, Loading, NumberInput, PageHead, Sheet } from '../ui/kit';
import { dayMonth } from '../lib/dates';
import { buyAmount, newId, num, plural, quantity, rub } from '../lib/format';
import { buildExportModel, shoppingText } from '../export/model';

type Line = ShoppingView['lines'][number];

const KIND_NAMES: Record<string, string> = { manual: 'ваша цена', receipt: 'чек', community: 'цены пользователей', scraped: 'сайт сети', rosstat: 'средняя цена Росстата (оценка)' };

/** Units a hand-added line can have; the value is stored as typed, not converted. */
const MANUAL_UNITS = ['шт.', 'уп.', 'г', 'кг', 'мл', 'л'];

const qty = quantity;

/** « · 2 уп. по 900 г»; pieces sold one by one read «· 3 шт.», not «3 уп. по 1 шт.». */
function packageText(pkg: { count: number; size: number; unit: string } | null): string {
  if (!pkg || pkg.count <= 0) return '';
  if (pkg.unit === 'pcs' && pkg.size === 1) return '';
  return ` · ${pkg.count} уп. по ${qty(pkg.size, pkg.unit)}`;
}

export default function ShoppingPage() {
  const { gateway, household, reportError, toast, bump, refreshHousehold } = useApp();
  const { record, loading: menuLoading } = useCurrentMenu();
  const [view, setView] = useState<ShoppingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [detail, setDetail] = useState<Line | null>(null);
  const [editing, setEditing] = useState<ManualLine | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const seenSent = useRef<string | null>(null);

  const load = async () => {
    if (!record) return;
    try {
      setView(await gateway.getShopping(record.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить список.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.revision, gateway]);

  // Remember the quantities the user has seen, so later menu edits can mark what changed. The marks
  // stay until the user confirms them («Понятно»); without changes the record is kept up to date quietly.
  useEffect(() => {
    if (!view || !record) return;
    const key = `${record.id}:${record.revision}`;
    if (seenSent.current === key) return;
    seenSent.current = key;
    if (view.lines.some((l) => l.changed)) return;
    const seen: Record<string, number> = {};
    for (const l of view.lines) seen[l.id] = l.to_buy;
    const same = Object.keys(seen).length === Object.keys(view.state.seen).length && Object.entries(seen).every(([k, v]) => view.state.seen[k] === v);
    if (!same) void gateway.patchShopping(record.id, { seen }, null).catch(() => undefined);
  }, [view, record, gateway]);

  const acknowledgeChanges = () => {
    if (!view) return;
    const seen: Record<string, number> = {};
    for (const l of view.lines) seen[l.id] = l.to_buy;
    void patch({ seen }, (v) => ({ ...v, lines: v.lines.map((l) => ({ ...l, changed: false })) }));
  };

  const patch = async (p: Partial<ShoppingView['state']>, optimistic?: (v: ShoppingView) => ShoppingView) => {
    if (!record || !view) return;
    if (optimistic) setView(optimistic(view));
    try {
      setView(await gateway.patchShopping(record.id, p, view.shopping_revision));
    } catch (e) {
      reportError(e);
      void load();
    }
  };

  const toggle = (id: string, field: 'purchased' | 'at_home') => {
    if (!view) return;
    const current = view.state.marks[id] ?? {};
    const next = { ...current, [field]: !current[field] };
    void patch({ marks: { [id]: next } }, (v) => ({
      ...v,
      lines: v.lines.map((l) => (l.id === id ? { ...l, [field]: !l[field] } : l)),
      manual_lines: v.manual_lines.map((l) => (l.id === id ? { ...l, [field]: !l[field] } : l)),
    }));
  };

  const addManual = () => {
    const name = newItem.trim();
    if (!name || !view) return;
    const line: ManualLine = { id: `manual:${newId('line')}`, name, qty: null, unit: null, department: 'Другое', price_kop: null };
    setNewItem('');
    void patch({ manual_lines: [...view.state.manual_lines, line] });
  };

  const saveManual = (line: ManualLine) => {
    if (!view) return;
    setEditing(null);
    void patch({ manual_lines: view.state.manual_lines.map((l) => (l.id === line.id ? line : l)) });
  };

  const removeManual = (id: string) => {
    if (!view) return;
    const before = view.state.manual_lines;
    void patch({ manual_lines: before.filter((l) => l.id !== id) });
    toast('Строка удалена', { undo: () => patch({ manual_lines: before }) });
  };

  const transfer = async (ids: string[]) => {
    if (!record) return;
    try {
      const r = await gateway.transferPurchases(record.id, ids);
      toast(r.added.length > 0 ? `В остатки добавлено: ${r.added.length} ${plural(r.added.length, 'продукт', 'продукта', 'продуктов')}` : 'Эти покупки уже перенесены в остатки', { tone: 'success' });
      bump();
      void load();
    } catch (e) {
      reportError(e);
    }
  };

  const grouped = useMemo(() => {
    const out = new Map<string, Line[]>();
    for (const l of view?.lines ?? []) {
      if (hideDone && (l.purchased || l.at_home || l.to_buy === 0)) continue;
      const list = out.get(l.department) ?? [];
      list.push(l);
      out.set(l.department, list);
    }
    return out;
  }, [view, hideDone]);

  if (menuLoading) return <Loading />;
  if (!record)
    return (
      <>
        <PageHead title="Покупки" />
        <Empty icon="cart" title="Список появится вместе с меню" action={<Link to="/menu" className="btn primary">Составить меню</Link>}>
          Список собирается из меню автоматически и учитывает то, что есть дома.
        </Empty>
      </>
    );
  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!view) return <Loading />;

  const remaining = view.lines.filter((l) => !l.purchased && !l.at_home && l.to_buy > 0).length + view.manual_lines.filter((l) => !l.purchased && !l.at_home).length;
  const total = view.lines.filter((l) => l.to_buy > 0).length + view.manual_lines.length;
  const purchasedIds = view.lines.filter((l) => l.purchased && !l.transferred && l.convertible && l.buy_qty > 0).map((l) => l.id);
  const manualShown = view.manual_lines.filter((l) => !(hideDone && (l.purchased || l.at_home)));
  const changed = view.lines.filter((l) => l.changed).length;
  const budget = view.budget;
  const anyPrice = view.lines.some((l) => l.price_kop !== null);
  const members = household?.members ?? [];

  const doExport = async (kind: 'xlsx' | 'pdf' | 'share') => {
    setExporting(kind);
    try {
      const model = buildExportModel(record, view, members);
      if (kind === 'share') {
        const text = shoppingText(model);
        if (navigator.share) await navigator.share({ title: 'Список покупок', text });
        else {
          await navigator.clipboard.writeText(text);
          toast('Список скопирован в буфер обмена', { tone: 'success' });
        }
      } else if (kind === 'xlsx') {
        const { buildXlsx } = await import('../export/files');
        await downloadBlob(`foodo-${record.menu.start_date}.xlsx`, await buildXlsx(model));
      } else {
        const { buildPdf } = await import('../export/files');
        await downloadBlob(`foodo-${record.menu.start_date}.pdf`, await buildPdf(model));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) reportError(e);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <PageHead
        eyebrow={`Меню с ${dayMonth(record.menu.start_date)} · ${record.menu.days} ${plural(record.menu.days, 'день', 'дня', 'дней')}`}
        title="Покупки"
        subtitle={total === 0 ? 'Покупать ничего не нужно' : `Осталось купить: ${remaining} из ${total} ${plural(total, 'позиции', 'позиций', 'позиций')}`}
        actions={
          <>
            <button className="btn ghost small" onClick={() => void doExport('share')} disabled={exporting !== null}>
              <Icon name="share" size={16} /> Поделиться
            </button>
            <button className="btn ghost small" onClick={() => void doExport('pdf')} disabled={exporting !== null}>
              {exporting === 'pdf' ? <span className="spinner" /> : <Icon name="download" size={16} />} PDF
            </button>
            <button className="btn ghost small" onClick={() => void doExport('xlsx')} disabled={exporting !== null}>
              {exporting === 'xlsx' ? <span className="spinner" /> : <Icon name="download" size={16} />} XLSX
            </button>
          </>
        }
      />
      <div className="progress" role="progressbar" aria-label="Куплено" aria-valuemin={0} aria-valuemax={total} aria-valuenow={total - remaining} aria-valuetext={`Куплено ${total - remaining} из ${total}`}>
        <span style={{ width: `${total ? ((total - remaining) / total) * 100 : 100}%` }} />
      </div>
      {/* Without any price there is nothing to total: one card explains how to get prices instead of
          a «—» total next to an empty budget card. */}
      {!anyPrice ? (
        <section className="card prices-empty">
          <span className="prices-empty-icon" aria-hidden="true">
            <Icon name="store" size={22} />
          </span>
          <div className="stack grow" style={{ ['--gap' as string]: '6px' }}>
            <h2 className="h3">Сколько это стоит?</h2>
            <p className="muted small">
              {household?.city
                ? `Для города ${household.city.name} пока нет опубликованных цен. Введите свои цены — итог и бюджет посчитаются по ним.`
                : 'Укажите город — подставим средние цены Росстата, а для METRO и «Магнита» — цены магазинов. Итог на кассе и проверка бюджета появятся сразу.'}
            </p>
            {budget.status !== 'none' && <p className="small">Бюджет {rub(budget.limit_kop)} проверим, когда будут цены.</p>}
            <div className="row wrap" style={{ marginTop: 6 }}>
              <button className="btn primary small" onClick={() => setPlaceOpen(true)}>
                <Icon name="location" size={16} /> {household?.city ? 'Сменить город' : 'Выбрать город'}
              </button>
              <Link to="/settings/shopping#prices" className="btn ghost small">
                Ввести свои цены
              </Link>
            </div>
          </div>
        </section>
      ) : (
      <div className="bento">
        <div className="card span-3">
          <div className="muted small">На кассе (упаковки)</div>
          <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: '-.03em' }}>{rub(view.totals.purchase_kop)}</div>
          <div className="muted small">Стоимость использованного: {rub(view.totals.usage_kop)}</div>
          {!view.totals.complete && (
            <div className="badge yellow" style={{ marginTop: 8 }}>
              {`Итог неполный: нет цены у ${view.totals.missing_prices.length} ${plural(view.totals.missing_prices.length, 'позиции', 'позиций', 'позиций')}`}
            </div>
          )}
          {view.totals.estimated && <div className="badge blue" style={{ marginTop: 8, marginLeft: 4 }}>часть цен — средние Росстата (оценка)</div>}
        </div>
        <div className="card span-3">
          <div className="muted small">Бюджет</div>
          {budget.status === 'none' ? (
            <>
              <div style={{ fontWeight: 700, marginTop: 4 }}>Не задан</div>
              <Link to="/settings/shopping#budget" className="small">
                Задать лимит
              </Link>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 750, fontSize: 20, marginTop: 4 }}>
                {budget.status === 'ok' ? 'Укладывается' : budget.status === 'exceeded' ? 'Превышен' : 'Не подтверждён'}
                {budget.status === 'ok' && budget.estimated ? ' (по оценке)' : ''}
              </div>
              <div className="muted small">
                Лимит {rub(budget.limit_kop)}
                {/* A margin is only known when every price is: with missing prices it would mislead. */}
                {budget.status === 'ok' && budget.diff_kop !== null ? ` · запас ${rub(budget.diff_kop)}` : ''}
                {budget.status === 'exceeded' && budget.diff_kop !== null ? ` · больше на ${rub(Math.abs(budget.diff_kop))}` : ''}
                {budget.status === 'unconfirmed' && budget.diff_kop !== null && budget.diff_kop >= 0 ? ` · по известным ценам ${rub(view.totals.purchase_kop)}` : ''}
              </div>
              {budget.status === 'unconfirmed' && <div className="small" style={{ marginTop: 4 }}>Известны не все цены — <Link to="/settings/shopping#prices">добавить цены</Link></div>}
              {budget.status === 'exceeded' && !view.totals.complete && <div className="small" style={{ marginTop: 4 }}>Лимит превышен уже по известным ценам; с остальными сумма будет больше.</div>}
            </>
          )}
        </div>
      </div>
      )}
      {changed > 0 && (
        <Banner icon="info">
          После изменений меню или остатков обновились количества у {changed} {plural(changed, 'позиции', 'позиций', 'позиций')} — они отмечены.{' '}
          <button className="btn small ghost" onClick={acknowledgeChanges}>
            Понятно
          </button>
        </Banner>
      )}
      {view.expired_skipped.length > 0 && (
        <Banner tone="warn" icon="warn">
          Некоторые продукты из остатков просрочены к дню готовки и не учтены: {view.expired_skipped.map((e) => view.lines.find((l) => l.product_id === e.product_id)?.name ?? e.product_id).join(', ')}.
        </Banner>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          addManual();
        }}
      >
        <input className="input grow" placeholder="Добавить своё: салфетки, хлеб…" value={newItem} onChange={(e) => setNewItem(e.target.value)} aria-label="Добавить свою строку" />
        <button className="btn primary" type="submit" disabled={!newItem.trim()} aria-label="Добавить">
          <Icon name="plus" size={18} />
        </button>
      </form>
      <div className="row between wrap">
        <label className="switch" style={{ minHeight: 36 }}>
          <input type="checkbox" role="switch" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span className="small">Скрыть купленное</span>
        </label>
        {purchasedIds.length > 0 && (
          <button className="btn small" onClick={() => void transfer(purchasedIds)} title="Купленные упаковки целиком добавятся в «Остатки»">
            <Icon name="box" size={16} /> Купленное — в остатки ({purchasedIds.length})
          </button>
        )}
      </div>
      {/* Departments flow into two columns on wide screens instead of one long narrow list. */}
      <div className="shop-columns">
      {[...grouped.entries()].map(([dept, lines]) => (
        <section key={dept}>
          <h2 className="shop-dept">
            {dept} <span className="shop-count">{lines.length}</span>
          </h2>
          <div className="shop-group">
          {lines.map((l) => {
            const done = l.purchased || l.at_home || l.to_buy === 0;
            return (
              <div key={l.id} className={`shop-line ${done ? 'done' : ''}`}>
                <input className="check" type="checkbox" checked={l.purchased || l.to_buy === 0} disabled={l.to_buy === 0} onChange={() => toggle(l.id, 'purchased')} aria-label={`Куплено: ${l.name}`} />
                <button onClick={() => setDetail(l)} style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}>
                  <div className="shop-name" style={{ fontWeight: 650 }}>
                    {l.name} {l.changed && <span className="badge yellow">изменилось</span>}
                  </div>
                  <div className="muted small">
                    {l.to_buy === 0 ? 'всё есть дома' : qty(buyAmount(l.to_buy, l.unit), l.unit)}
                    {l.from_pantry > 0 && l.to_buy > 0 ? ` · дома ${qty(l.from_pantry, l.unit)}` : ''}
                    {packageText(l.package)}
                    {l.at_home ? ' · есть дома' : ''}
                  </div>
                </button>
                <span className="num small" style={{ textAlign: 'right', fontWeight: 650 }}>
                  {l.purchase_cost_kop !== null ? rub(l.purchase_cost_kop) : l.to_buy > 0 && !l.at_home && anyPrice ? <span className="faint">нет цены</span> : ''}
                </span>
              </div>
            );
          })}
          </div>
        </section>
      ))}
      {manualShown.length > 0 && (
        <section>
          <h2 className="shop-dept">
            Добавлено вручную <span className="shop-count">{manualShown.length}</span>
          </h2>
          <div className="shop-group">
            {manualShown.map((l) => (
              <div key={l.id} className={`shop-line ${l.purchased ? 'done' : ''}`}>
                <input className="check" type="checkbox" checked={l.purchased} onChange={() => toggle(l.id, 'purchased')} aria-label={`Куплено: ${l.name}`} />
                <button
                  onClick={() => setEditing(view.state.manual_lines.find((x) => x.id === l.id) ?? null)}
                  style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}
                  aria-label={`Изменить: ${l.name}`}
                >
                  <div className="shop-name" style={{ fontWeight: 650 }}>
                    {l.name}
                  </div>
                  <div className="muted small">{l.qty !== null ? `${num(l.qty, 2)} ${l.unit ?? ''}`.trim() : 'количество не указано'}</div>
                </button>
                <span className="num small" style={{ textAlign: 'right', fontWeight: 650 }}>
                  {l.price_kop !== null ? rub(l.price_kop) : !l.at_home && anyPrice ? <span className="faint">нет цены</span> : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
      {placeOpen && (
        <Sheet open onClose={() => setPlaceOpen(false)} title="Город и магазин">
          <CityChooser
            cityId={household?.city?.id ?? null}
            chainId={household?.store_chain_id ?? null}
            onCity={async (c) => {
              try {
                await gateway.updateHousehold({ city_id: c.id });
                await refreshHousehold();
                await load();
                toast(`Город: ${c.name}`, { tone: 'success' });
              } catch (e) {
                reportError(e);
              }
            }}
            onChain={async (ch) => {
              try {
                await gateway.updateHousehold({ store_chain_id: ch?.id ?? null });
                await refreshHousehold();
                await load();
                setPlaceOpen(false);
              } catch (e) {
                reportError(e);
              }
            }}
          />
        </Sheet>
      )}
      {editing && <ManualLineSheet line={editing} onClose={() => setEditing(null)} onSave={saveManual} onRemove={() => { setEditing(null); removeManual(editing.id); }} />}
      <p className="muted tiny">
        «Корзина покупок» — это список внутри Foodo: заказ и доставку мы не оформляем. Выбор магазина не загружает его реальные цены — источник каждой цены указан в строке.
      </p>
      {detail && (
        <Sheet open onClose={() => setDetail(null)} title={detail.name}>
          <div className="stack">
            <table className="table">
              <tbody>
                <tr>
                  <td>Нужно по меню</td>
                  <td className="num">{qty(detail.needed, detail.unit)}</td>
                </tr>
                <tr>
                  <td>Есть дома (учтено)</td>
                  <td className="num">{qty(detail.from_pantry, detail.unit)}</td>
                </tr>
                <tr>
                  <td>Купить</td>
                  <td className="num">
                    <strong>{qty(detail.to_buy, detail.unit)}</strong>
                  </td>
                </tr>
                {detail.package && (
                  <tr>
                    <td>Упаковки</td>
                    <td className="num">
                      {detail.package.count} × {qty(detail.package.size, detail.package.unit)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td>Цена</td>
                  <td>
                    {detail.price_kop !== null
                      ? `${rub(detail.price_kop)}${detail.price_per ? ` за ${qty(detail.price_per.size, detail.price_per.unit)}` : ''} · ${KIND_NAMES[detail.price_kind ?? 'manual'] ?? detail.price_kind}, ${detail.price_date ? new Date(detail.price_date).toLocaleDateString('ru-RU') : ''}`
                      : 'неизвестна'}
                  </td>
                </tr>
              </tbody>
            </table>
            {detail.package_note && <p className="muted small">{detail.package_note}</p>}
            <div>
              <span className="label">Для каких блюд</span>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {detail.sources.map((s, i) => (
                  <li key={i} className="small">
                    {s.recipe_name}, {dayMonth(s.cook_date)} — {qty(s.qty, detail.unit)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="row wrap">
              <button className="btn" onClick={() => { toggle(detail.id, 'at_home'); setDetail(null); }}>
                <Icon name="home" size={18} /> {detail.at_home ? 'Нет дома' : 'Есть дома'}
              </button>
              <Link className="btn ghost" to={`/settings/shopping?price=${detail.product_id}#prices`}>
                <Icon name="store" size={18} /> Указать цену
              </Link>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** A hand-added line: name, an optional amount as typed and the price paid for the whole line. */
function ManualLineSheet({ line, onClose, onSave, onRemove }: { line: ManualLine; onClose: () => void; onSave: (l: ManualLine) => void; onRemove: () => void }) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState<number | null>(line.qty);
  const [unit, setUnit] = useState(line.unit ?? 'шт.');
  const [price, setPrice] = useState<number | null>(line.price_kop === null ? null : line.price_kop / 100);
  const amountBad = amount !== null && !(Number.isFinite(amount) && amount > 0 && amount <= 100000);
  const priceBad = price !== null && !(Number.isFinite(price) && price >= 0 && price <= 1000000);
  const invalid = !name.trim() || amountBad || priceBad;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Своя строка"
      footer={
        <>
          <button
            className="btn primary"
            disabled={invalid}
            onClick={() => onSave({ ...line, name: name.trim().slice(0, 120), qty: amount, unit: amount === null ? null : unit, price_kop: price === null ? null : Math.round(price * 100) })}
          >
            Сохранить
          </button>
          <button className="btn danger ghost" onClick={onRemove}>
            Удалить строку
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Название">
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Количество (необязательно)" error={amountBad ? 'Число больше нуля.' : undefined}>
            <NumberInput decimal value={amount} onChange={setAmount} invalid={amountBad} style={{ width: 140 }} />
          </Field>
          <Field label="Единица">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 110 }}>
              {MANUAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Цена за всю строку, ₽ (необязательно)" hint="Без цены итог и бюджет остаются неполными." error={priceBad ? 'Сумма в рублях, 0 или больше.' : undefined}>
          <NumberInput decimal value={price} onChange={setPrice} invalid={priceBad} style={{ width: 160 }} />
        </Field>
      </div>
    </Sheet>
  );
}
