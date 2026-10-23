import { useId, useMemo, useState } from 'react';
import type { Product } from '../engine';
import { useApp } from '../state/app';
import { Icon } from './icons';

/** Accessible combobox over catalog products (by id, searched by name). */
export function ProductPicker({ value, onChange, label = 'Продукт', exclude = [] }: { value: string | null; onChange: (p: Product) => void; label?: string; exclude?: string[] }) {
  const { catalog } = useApp();
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = value ? catalog.products[value] : undefined;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е');
    const all = Object.values(catalog.products).filter((p) => p.purchasable !== false && !exclude.includes(p.id));
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
    const list = q ? all.filter((p) => norm(p.name).includes(q)) : all;
    return list.sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) || a.name.localeCompare(b.name, 'ru')).slice(0, 8);
  }, [catalog, query, exclude]);
  const pick = (p: Product) => {
    onChange(p);
    setQuery('');
    setOpen(false);
  };
  return (
    <div className="field" style={{ position: 'relative' }}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="search">
        <Icon name="search" size={18} />
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          placeholder={selected ? selected.name : 'Начните вводить: картофель, молоко…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          // Focus alone does not open the list: tabbing through a form should not cover the next fields.
          onClick={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!open) setOpen(true);
              else setActive((a) => Math.min(results.length - 1, a + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            // Escape closes the list first; the sheet around it closes on the next press.
            if (e.key === 'Escape' && open) {
              e.preventDefault();
              setOpen(false);
            }
            if (e.key === 'Enter' && open && results[active]) {
              e.preventDefault();
              pick(results[active] as Product);
            }
          }}
        />
      </div>
      {selected && !query && <span className="small muted">Выбрано: {selected.name}</span>}
      {open && results.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          className="card"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, listStyle: 'none', margin: '6px 0 0', padding: 6, maxHeight: 280, overflowY: 'auto', boxShadow: 'var(--shadow)' }}
        >
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: i === active ? 'var(--surface-2)' : 'transparent' }}
            >
              {p.name} <span className="faint small">· {p.department}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
