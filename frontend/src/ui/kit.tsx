import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  // Rendered into <body>: a transformed ancestor (a page or card animation) would otherwise become
  // the containing block of this fixed overlay and push it off screen.
  return createPortal(
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
        {/* Only the body scrolls: the title and the action buttons stay on screen however long it is. */}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer row wrap">{footer}</div>}
      </div>
    </div>,
    document.body,
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
          <button className="icon-btn small" style={{ color: 'var(--toast-ink)' }} onClick={() => dismissToast(t.id)} aria-label="Скрыть уведомление">
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

/** Catalog photos are stored as `photos/<id>.webp` next to the app: resolve them against the
 * app base (`/` on the server, `/Foodo/` on GitHub Pages), not against the current route. */
export function photoUrl(url: string): string {
  return /^https:\/\//.test(url) ? url : `${import.meta.env.BASE_URL}${url.replace(/^\/+/, '')}`;
}

/** Catalog photos have a 400 px copy in photos/thumb/ for cards; the browser picks by width. */
export function photoSrcSet(url: string): string | undefined {
  const m = /^photos\/([a-z0-9-]+)\.webp$/.exec(url);
  return m ? `${photoUrl(`photos/thumb/${m[1]}.webp`)} 400w, ${photoUrl(url)} 800w` : undefined;
}

/** Small deterministic hash so the same recipe always gets the same drawn variant. */
function variantOf(text: string, n: number): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % n;
}

const COVER_ART: Record<string, ReactNode> = {
  breakfast: (
    <>
      <ellipse cx="100" cy="98" rx="58" ry="40" fill="var(--c-plate)" />
      <ellipse cx="88" cy="94" rx="26" ry="20" fill="var(--c-light)" />
      <circle cx="90" cy="96" r="10" fill="var(--c-ink)" />
      <rect x="114" y="78" width="34" height="30" rx="8" fill="var(--c-mid)" transform="rotate(12 131 93)" />
      <rect x="119" y="83" width="24" height="20" rx="5" fill="var(--c-light)" transform="rotate(12 131 93)" />
    </>
  ),
  soup: (
    <>
      <path d="M44 88h112c0 32-25 50-56 50s-56-18-56-50z" fill="var(--c-ink)" />
      <ellipse cx="100" cy="88" rx="56" ry="11" fill="var(--c-mid)" />
      <circle cx="84" cy="87" r="5" fill="var(--c-light)" />
      <circle cx="108" cy="89" r="4" fill="var(--c-plate)" />
      <circle cx="124" cy="86" r="4.5" fill="var(--c-light)" />
      <path className="steam" d="M78 66c-6-9 6-13 0-22M100 62c-6-9 6-13 0-22M122 66c-6-9 6-13 0-22" stroke="var(--c-plate)" strokeWidth="5" strokeLinecap="round" fill="none" />
    </>
  ),
  main: (
    <>
      <ellipse cx="96" cy="100" rx="62" ry="38" fill="var(--c-plate)" />
      <ellipse cx="96" cy="98" rx="44" ry="26" fill="var(--c-light)" />
      <path d="M70 100c6-16 30-22 46-12 10 6 10 18-2 22-14 6-38 6-44-10z" fill="var(--c-ink)" />
      <circle cx="112" cy="90" r="6" fill="var(--c-mid)" />
      <circle cx="80" cy="88" r="5" fill="var(--c-mid)" />
      <path d="M168 54v74M178 54v24c0 8-10 8-10 0" stroke="var(--c-plate)" strokeWidth="5" strokeLinecap="round" fill="none" />
    </>
  ),
  salad: (
    <>
      <path d="M42 94h116c0 30-26 48-58 48s-58-18-58-48z" fill="var(--c-plate)" />
      <path d="M60 94c4-22 22-30 34-20 6-16 30-16 36 2 14-6 26 6 22 18z" fill="var(--c-ink)" />
      <circle cx="82" cy="86" r="8" fill="var(--c-light)" />
      <circle cx="118" cy="84" r="7" fill="var(--c-mid)" />
      <circle cx="102" cy="78" r="5" fill="var(--c-light)" />
    </>
  ),
  snack: (
    <>
      <path d="M56 104l44-40 44 40z" fill="var(--c-mid)" />
      <rect x="56" y="102" width="88" height="14" rx="6" fill="var(--c-ink)" />
      <rect x="52" y="114" width="96" height="16" rx="8" fill="var(--c-plate)" />
      <circle cx="88" cy="96" r="6" fill="var(--c-light)" />
      <circle cx="110" cy="90" r="5" fill="var(--c-light)" />
    </>
  ),
  dessert: (
    <>
      <path d="M60 120l36-62 50 30v32z" fill="var(--c-light)" />
      <path d="M60 120l36-62 50 30" fill="none" stroke="var(--c-ink)" strokeWidth="8" strokeLinejoin="round" />
      <path d="M68 104h76M76 90h56" stroke="var(--c-mid)" strokeWidth="6" />
      <circle cx="96" cy="52" r="9" fill="var(--c-ink)" />
      <ellipse cx="104" cy="126" rx="56" ry="9" fill="var(--c-plate)" />
    </>
  ),
  baking: (
    <>
      <path d="M48 118c0-34 24-54 52-54s52 20 52 54z" fill="var(--c-mid)" />
      <path d="M72 84c6 6 6 14 0 20M100 78c6 6 6 16 0 24M128 84c6 6 6 14 0 20" stroke="var(--c-light)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <rect x="40" y="116" width="120" height="14" rx="7" fill="var(--c-ink)" />
    </>
  ),
  drink: (
    <>
      <path d="M72 56h56l-8 78a8 8 0 0 1-8 7H88a8 8 0 0 1-8-7z" fill="var(--c-plate)" />
      <path d="M76 82h48l-5 52a6 6 0 0 1-6 5H87a6 6 0 0 1-6-5z" fill="var(--c-ink)" />
      <path d="M112 40l-8 52" stroke="var(--c-light)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="134" cy="62" r="13" fill="var(--c-mid)" />
    </>
  ),
};

// Decorative bubbles move between four placements so neighbouring covers don't look identical.
const COVER_DOTS = [
  [24, 26, 30],
  [176, 22, 40],
  [30, 140, 26],
  [180, 136, 34],
] as const;

/** Recipe photo, or a clearly drawn cover (never a fake photo). The author and licence of a photo
 * are shown as a full line on the recipe page. Cover colours come from theme tokens per category. */
export function RecipeCover({ recipe, rounded = false }: { recipe: Pick<Recipe, 'name' | 'category' | 'image'>; rounded?: boolean }) {
  if (recipe.image?.url) {
    return (
      <div className="cover-photo" style={{ borderRadius: rounded ? 18 : 0 }}>
        <img className="cover-img" src={photoUrl(recipe.image.url)} srcSet={photoSrcSet(recipe.image.url)} sizes="(max-width: 560px) 92vw, 400px" alt={recipe.name} loading="lazy" decoding="async" />
      </div>
    );
  }
  const category = COVER_ART[recipe.category] ? recipe.category : 'main';
  const v = variantOf(recipe.name, 4);
  const [x1, y1, r1] = COVER_DOTS[v]!;
  const [x2, y2, r2] = COVER_DOTS[(v + 2) % 4]!;
  return (
    <svg className={`cover-art cat-${category}`} viewBox="0 0 200 160" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${recipe.name} — рисунок, не фотография`} style={{ borderRadius: rounded ? 18 : 0 }}>
      <rect width="200" height="160" fill="var(--c-bg)" />
      <circle cx={x1} cy={y1} r={r1} fill="var(--c-light)" opacity="0.5" />
      <circle cx={x2} cy={y2} r={r2 * 0.6} fill="var(--c-mid)" opacity="0.35" />
      <g transform={v % 2 ? 'translate(200 0) scale(-1 1)' : undefined}>
        <g className="cover-motif">{COVER_ART[category]}</g>
      </g>
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
