import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UNIT_NAMES } from '../engine';
import type { ManualLine } from '../engine';
import type { ShoppingView } from '../data/types';
import { downloadBlob } from '../data/backup';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { Banner, Empty, ErrorBox, Loading, PageHead, Sheet } from '../ui/kit';
import { dayMonth } from '../lib/dates';
import { newId, num, rub } from '../lib/format';
import { buildExportModel, shoppingText } from '../export/model';

type Line = ShoppingView['lines'][number];

const KIND_NAMES: Record<string, string> = { manual: 'ваша цена', receipt: 'чек', community: 'цены пользователей', scraped: 'сайт сети', rosstat: 'средняя цена Росстата (оценка)' };

function qty(value: number, unit: string): string {
  const u = (UNIT_NAMES as Record<string, string>)[unit] ?? unit;
  if (unit === 'g' && value >= 1000) return `${num(value / 1000, 2)} кг`;
  if (unit === 'ml' && value >= 1000) return `${num(value / 1000, 2)} л`;
  return `${num(value, value < 10 ? 1 : 0)} ${u}`;
}

export default function ShoppingPage() {
  const { gateway, household, reportError, toast, bump } = useApp();
  const { record, loading: menuLoading } = useCurrentMenu();
  const [view, setView] = useState<ShoppingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [detail, setDetail] = useState<Line | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
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

  // Remember what the user has seen so later menu edits can highlight changed quantities.
  useEffect(() => {
    if (!view || !record) return;
    const key = `${record.id}:${record.revision}`;
    if (seenSent.current === key) return;
    const seen: Record<string, number> = {};
    for (const l of view.lines) seen[l.id] = l.to_buy;
    const same = Object.keys(seen).length === Object.keys(view.state.seen).length && Object.entries(seen).every(([k, v]) => view.state.seen[k] === v);
    seenSent.current = key;
    if (!same) {
      const t = setTimeout(() => void gateway.patchShopping(record.id, { seen }, null).catch(() => undefined), 4000);
      return () => clearTimeout(t);
    }
  }, [view, record, gateway]);

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
    const line: ManualLine = { id: newId('manual'), name, qty: null, unit: null, department: 'Другое', price_kop: null };
    setNewItem('');
    void patch({ manual_lines: [...view.state.manual_lines, line] });
  };

  const removeManual = (id: string) => {
    if (!view) return;
    const before = view.state.manual_lines;
    void patch({ manual_lines: before.filter((l) => l.id !== id) });
    toast('Строка удалена', { undo: () => patch({ manual_lines: before }) });
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
  const purchasedIds = view.lines.filter((l) => l.purchased && !l.transferred && l.convertible && l.to_buy > 0).map((l) => l.id);
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
        eyebrow={`Меню ${dayMonth(record.menu.start_date)} · ${record.menu.days} дн.`}
        title="Покупки"
        subtitle={total === 0 ? 'Покупать ничего не нужно' : `Осталось купить: ${remaining} из ${total}`}
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
      <div className="progress" aria-label="Куплено">
        <span style={{ width: `${total ? ((total - remaining) / total) * 100 : 100}%` }} />
      </div>
      <div className="bento">
        <div className="card span-3">
          <div className="muted small">На кассе (упаковки)</div>
          {/* Without any price a «0 ₽» total would read as «free»: show a dash instead. */}
          <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: '-.03em' }}>{anyPrice ? rub(view.totals.purchase_kop) : '—'}</div>
          {anyPrice && <div className="muted small">Стоимость использованного: {rub(view.totals.usage_kop)}</div>}
          {!view.totals.complete && (
            <div className="badge yellow" style={{ marginTop: 8 }}>
              {anyPrice ? `Итог неполный: цен нет для ${view.totals.missing_prices.length} позиций` : 'Цены ещё не заданы'}
            </div>
          )}
          {!anyPrice && (
            <div className="small" style={{ marginTop: 6 }}>
              <Link to="/settings#store">Выберите город и магазин</Link> или <Link to="/settings#prices">добавьте свои цены</Link>.
            </div>
          )}
          {view.totals.estimated && <div className="badge blue" style={{ marginTop: 8, marginLeft: 4 }}>часть цен — средние Росстата (оценка)</div>}
        </div>
        <div className="card span-3">
          <div className="muted small">Бюджет</div>
          {budget.status === 'none' ? (
            <>
              <div style={{ fontWeight: 700, marginTop: 4 }}>Не задан</div>
              <Link to="/settings#budget" className="small">
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
                Лимит {rub(budget.limit_kop)} · {budget.diff_kop !== null && budget.diff_kop >= 0 ? `запас ${rub(budget.diff_kop)}` : `больше на ${rub(Math.abs(budget.diff_kop ?? 0))}`}
              </div>
              {budget.status === 'unconfirmed' && <div className="small" style={{ marginTop: 4 }}>Известны не все цены — <Link to="/settings#prices">добавить цены</Link></div>}
            </>
          )}
        </div>
      </div>
      {changed > 0 && <Banner icon="info">После изменений меню обновились количества у {changed} позиций — они отмечены.</Banner>}
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
          <button
            className="btn small"
            onClick={async () => {
              try {
                const r = await gateway.transferPurchases(record.id, purchasedIds);
                toast(`В остатки добавлено: ${r.added.length}`, { tone: 'success' });
                bump();
                void load();
              } catch (e) {
                reportError(e);
              }
            }}
          >
            <Icon name="box" size={16} /> Купленное — в остатки ({purchasedIds.length})
          </button>
        )}
      </div>
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
                    {l.to_buy === 0 ? 'всё есть дома' : qty(l.to_buy, l.unit)}
                    {l.from_pantry > 0 && l.to_buy > 0 ? ` · дома ${qty(l.from_pantry, l.unit)}` : ''}
                    {l.package && l.package.count > 0 ? ` · ${l.package.count} уп. по ${qty(l.package.size, l.package.unit)}` : ''}
                    {l.at_home ? ' · есть дома' : ''}
                  </div>
                </button>
                <span className="num small" style={{ textAlign: 'right', fontWeight: 650 }}>
                  {l.purchase_cost_kop !== null ? rub(l.purchase_cost_kop) : l.to_buy > 0 && anyPrice ? <span className="faint">нет цены</span> : ''}
                </span>
              </div>
            );
          })}
          </div>
        </section>
      ))}
      {view.manual_lines.length > 0 && (
        <section>
          <h2 className="shop-dept">Добавлено вручную</h2>
          <div className="shop-group">
          {view.manual_lines.map((l) => (
            <div key={l.id} className={`shop-line ${l.purchased ? 'done' : ''}`}>
              <input className="check" type="checkbox" checked={l.purchased} onChange={() => toggle(l.id, 'purchased')} aria-label={`Куплено: ${l.name}`} />
              <span className="shop-name" style={{ fontWeight: 650 }}>
                {l.name}
              </span>
              <button className="icon-btn small" onClick={() => removeManual(l.id)} aria-label={`Удалить: ${l.name}`}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
          </div>
        </section>
      )}
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
                    {detail.price_kop !== null ? `${rub(detail.price_kop)} · ${KIND_NAMES[detail.price_kind ?? 'manual'] ?? detail.price_kind}, ${detail.price_date}` : 'неизвестна'}
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
              <Link className="btn ghost" to={`/settings?price=${detail.product_id}#prices`}>
                <Icon name="store" size={18} /> Указать цену
              </Link>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
