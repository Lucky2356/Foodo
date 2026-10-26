import { useState } from 'react';
import { availableDisplayUnits, cleanQty, toBase, UNIT_NAMES } from '../engine';
import type { Product, RecipeUnit } from '../engine';
import { useApp, useLoad } from '../state/app';
import type { PantryRecord } from '../data/types';
import { Icon } from '../ui/icons';
import { Empty, ErrorBox, Field, Loading, NumberInput, PageHead, Sheet } from '../ui/kit';
import { ProductPicker } from '../ui/ProductPicker';
import { addDaysIso, dayMonth, deviceTimeZone, localDate } from '../lib/dates';
import { quantity } from '../lib/format';

const LOCATIONS = ['Холодильник', 'Морозилка', 'Кладовая'];

export default function PantryPage() {
  const { gateway, catalog, reportError, toast, household } = useApp();
  const { data, loading, error, reload, setData } = useLoad(() => gateway.listPantry(), [gateway]);
  const [editing, setEditing] = useState<PantryRecord | 'new' | null>(null);
  const today = localDate(household?.city?.timezone ?? deviceTimeZone());

  const remove = async (item: PantryRecord) => {
    try {
      await gateway.deletePantry(item.id);
      setData((data ?? []).filter((p) => p.id !== item.id));
      toast(`${catalog.products[item.product_id]?.name ?? 'Продукт'} удалён`, {
        undo: async () => {
          const { id: _id, ...rest } = item;
          await gateway.addPantry(rest);
          reload();
        },
      });
    } catch (e) {
      reportError(e);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const items = data ?? [];
  const groups = new Map<string, PantryRecord[]>();
  for (const p of items) {
    const key = p.location || 'Без места';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <div className="stack medium" style={{ ['--gap' as string]: '14px' }}>
      <PageHead
        eyebrow="Остатки"
        title="Что есть дома"
        subtitle="Учитываются в списке покупок по датам готовки, если срок годности не истёк."
        actions={
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} /> Добавить
          </button>
        }
      />
      {items.length === 0 ? (
        <Empty icon="box" title="Пока пусто" action={<button className="btn primary" onClick={() => setEditing('new')}>Добавить продукт</button>}>
          Добавьте то, что лежит в холодильнике и кладовой, — Foodo вычтет это из покупок.
        </Empty>
      ) : (
        [...groups.entries()].map(([loc, list]) => (
          <section key={loc}>
            <h2 className="shop-dept">{loc}</h2>
            {list.map((p) => {
              const product = catalog.products[p.product_id];
              const expired = p.expires !== null && p.expires < today;
              const soon = !expired && p.expires !== null && p.expires <= addDaysIso(today, 2);
              return (
                <div key={p.id} className="shop-line">
                  <span className="ficon" style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}>
                    <Icon name="box" size={18} />
                  </span>
                  <button onClick={() => setEditing(p)} style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>{product?.name ?? p.product_id}</div>
                    <div className="small muted">
                      {quantity(p.qty, p.unit)}
                      {p.expires && ` · до ${dayMonth(p.expires)}`}
                      {expired && <span className="badge orange" style={{ marginLeft: 6 }}>просрочено</span>}
                      {soon && <span className="badge yellow" style={{ marginLeft: 6 }}>скоро истекает</span>}
                    </div>
                  </button>
                  <button className="icon-btn small" onClick={() => void remove(p)} aria-label={`Удалить: ${product?.name}`}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              );
            })}
          </section>
        ))
      )}
      {editing && (
        <PantrySheet
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PantrySheet({ item, onClose, onSaved }: { item: PantryRecord | null; onClose: () => void; onSaved: () => void }) {
  const { gateway, catalog, reportError, toast } = useApp();
  const [productId, setProductId] = useState<string | null>(item?.product_id ?? null);
  const product: Product | undefined = productId ? catalog.products[productId] : undefined;
  const [amount, setAmount] = useState<number | null>(item ? item.qty : null);
  const [unit, setUnit] = useState<RecipeUnit>(item?.unit ?? 'g');
  const [location, setLocation] = useState(item?.location ?? 'Холодильник');
  const [expires, setExpires] = useState(item?.expires ?? '');
  // Kilograms, litres and pieces are accepted where the product allows them; the pantry stores the
  // product's base unit (spoons are not offered: nobody keeps «3 ложки» of a product at home).
  const units = product ? availableDisplayUnits(product).filter((u) => !['tbsp', 'tsp', 'pinch'].includes(u)) : [];
  const chosen = units.includes(unit) ? unit : (product?.base_unit ?? 'g');
  const baseQty = product && amount !== null && Number.isFinite(amount) && amount > 0 ? toBase(product, amount, chosen) : null;
  const amountBad = amount !== null && (baseQty === null || baseQty > 1_000_000);
  const valid = product && baseQty !== null && !amountBad;
  const save = async () => {
    if (!product || baseQty === null) return;
    try {
      const body = { product_id: product.id, qty: cleanQty(baseQty), unit: product.base_unit, location, expires: expires || null };
      if (item) await gateway.updatePantry(item.id, body);
      else await gateway.addPantry(body);
      toast('Сохранено', { tone: 'success' });
      onSaved();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? 'Изменить остаток' : 'Добавить продукт'}
      footer={
        <button className="btn primary" disabled={!valid} onClick={() => void save()}>
          Сохранить
        </button>
      }
    >
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) void save(); }}>
        {!item && <ProductPicker value={productId} onChange={(p) => setProductId(p.id)} />}
        {product && (
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="Количество" hint="Как покупали: с кожурой и упаковкой" error={amountBad ? 'Число больше нуля.' : undefined}>
              <NumberInput decimal value={amount} onChange={setAmount} invalid={amountBad} style={{ width: 140 }} />
            </Field>
            <Field label="Единица">
              <select className="input" value={chosen} onChange={(e) => setUnit(e.target.value as RecipeUnit)} style={{ width: 100 }}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_NAMES[u]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="chips" role="group" aria-label="Где хранится">
          {LOCATIONS.map((l) => (
            <button type="button" key={l} className="chip" aria-pressed={location === l} onClick={() => setLocation(l)}>
              {l}
            </button>
          ))}
        </div>
        <Field label="Годен до (необязательно)">
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}
