import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Recipe } from '../engine';
import { useApp } from '../state/app';
import { Icon } from './icons';
import type { IconName } from './icons';

export function PageHead({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head fade-in">
      <div className="grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 8 }}>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 id={titleId} className="grow" style={{ fontSize: 21 }}>
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>
        {children}
        {footer && <div className="row wrap" style={{ marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
          <span className="grow">{t.message}</span>
          {t.undo && (
            <button
              className="btn small"
              onClick={() => {
                dismissToast(t.id);
                void t.undo?.();
              }}
            >
              Отменить
            </button>
          )}
          <button className="icon-btn small" style={{ color: '#fff' }} onClick={() => dismissToast(t.id)} aria-label="Скрыть уведомление">
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, step, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string; label: string }) {
  const clampRound = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(clampRound(value - step))} disabled={value <= min} aria-label={`Уменьшить: ${label}`}>
        −
      </button>
      <output aria-live="polite">{format ? format(value) : value}</output>
      <button type="button" onClick={() => onChange(clampRound(value + step))} disabled={value >= max} aria-label={`Увеличить: ${label}`}>
        +
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grow">
        <span style={{ fontWeight: 650 }}>{label}</span>
        {hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  );
}

export function Chip({ on, onClick, children, tone = 'pick' }: { on: boolean; onClick: () => void; children: ReactNode; tone?: 'pick' | 'ban' }) {
  return (
    <button type="button" className={`chip ${tone === 'ban' ? 'ban' : ''}`} aria-pressed={on} onClick={onClick}>
      {on && <Icon name={tone === 'ban' ? 'close' : 'check'} size={16} strokeWidth={2.4} />}
      {children}
    </button>
  );
}

export function Empty({ icon = 'sparkle', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <div className="feature" style={{ padding: 0 }}>
        <div className="ficon" style={{ margin: '0 auto' }}>
          <Icon name={icon} />
        </div>
      </div>
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: '48ch' }}>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner error" role="alert">
      <Icon name="warn" />
      <div className="grow">
        <strong>Не получилось.</strong> {message}
      </div>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 120 : 74 }} />
      ))}
    </div>
  );
}

export function Banner({ tone = 'info', icon = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`banner ${tone === 'info' ? '' : tone}`}>
      <Icon name={icon} />
      <div className="grow">{children}</div>
    </div>
  );
}

const COVER_PALETTES: Record<string, [string, string, string]> = {
  breakfast: ['#ffe7b8', '#ffc979', '#c9761a'],
  soup: ['#ffd9cc', '#ff9f80', '#b3442a'],
  main: ['#dcefdc', '#9fd0a8', '#2e6a4e'],
  salad: ['#e6f5cf', '#b7dd7c', '#4f7f18'],
  snack: ['#f1e2fb', '#cfa9ee', '#6c3d94'],
};

/** Photo with its licence credit, or a clearly illustrative cover (never a fake photo). */
export function RecipeCover({ recipe, rounded = false, showCredit = false }: { recipe: Pick<Recipe, 'name' | 'category' | 'image'>; rounded?: boolean; showCredit?: boolean }) {
  if (recipe.image?.url) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: rounded ? 18 : 0, overflow: 'hidden', background: 'var(--surface-2)' }}>
        <img className="cover-img" src={recipe.image.url} alt={recipe.name} loading="lazy" decoding="async" />
        {showCredit && <span className="cover-credit">{recipe.image.source}</span>}
      </div>
    );
  }
  const [a, b, ink] = COVER_PALETTES[recipe.category] ?? COVER_PALETTES.main as [string, string, string];
  const motif: Record<string, ReactNode> = {
    soup: (
      <>
        <path d="M40 92h120c0 34-26 52-60 52S40 126 40 92z" fill={ink} opacity="0.88" />
        <path d="M70 70c-6-10 6-14 0-24M100 66c-6-10 6-14 0-24M130 70c-6-10 6-14 0-24" stroke={ink} strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.6" />
      </>
    ),
    salad: (
      <>
        <path d="M44 100h112c0 30-25 46-56 46s-56-16-56-46z" fill={ink} opacity="0.85" />
        <circle cx="78" cy="92" r="16" fill="#fff" opacity="0.5" />
        <circle cx="112" cy="86" r="20" fill="#fff" opacity="0.35" />
        <path d="M96 60c18-14 34-8 38 6-16 6-28 4-38-6z" fill={ink} opacity="0.7" />
      </>
    ),
    breakfast: (
      <>
        <circle cx="100" cy="100" r="48" fill="#fff" opacity="0.75" />
        <circle cx="100" cy="100" r="20" fill={ink} opacity="0.85" />
      </>
    ),
    snack: (
      <>
        <path d="M100 60c26-14 52 6 46 40-4 30-26 46-46 38-20 8-42-8-46-38-6-34 20-54 46-40z" fill={ink} opacity="0.82" />
        <path d="M100 60c0-12 6-20 16-24" stroke={ink} strokeWidth="6" strokeLinecap="round" fill="none" />
      </>
    ),
    main: (
      <>
        <ellipse cx="100" cy="106" rx="66" ry="30" fill="#fff" opacity="0.65" />
        <ellipse cx="100" cy="100" rx="40" ry="18" fill={ink} opacity="0.85" />
        <path d="M152 52v66M164 52v26c0 8-12 8-12 0" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.6" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 200 160" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${recipe.name} — иллюстрация, не фотография`} style={{ display: 'block', borderRadius: rounded ? 18 : 0 }}>
      <defs>
        <linearGradient id={`g-${recipe.category}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="200" height="160" fill={`url(#g-${recipe.category})`} />
      <circle cx="180" cy="20" r="44" fill="#fff" opacity="0.18" />
      {motif[recipe.category] ?? motif.main}
    </svg>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
