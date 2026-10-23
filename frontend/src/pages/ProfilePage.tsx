import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimateEnergy, spiceTolerance } from '../engine';
import type { Member } from '../engine';
import { useApp } from '../state/app';
import { downloadJson, exportGuestData, importGuestData, migrateExport } from '../data/backup';
import type { GuestExport } from '../data/backup';
import { ApiError } from '../data/api';
import { Icon } from '../ui/icons';
import { Banner, Chip, Field, Loading, NumberInput, PageHead, Segmented, Sheet, Stepper } from '../ui/kit';
import { rangeError } from '../lib/numbers';
import { ProductPicker } from '../ui/ProductPicker';
import { applyTheme, storedTheme } from '../lib/theme';
import type { ThemeChoice } from '../lib/theme';
import { num, plural } from '../lib/format';
import { QUICK_EXCLUSIONS, quickExclusionsActive, toggleQuickExclusion } from '../lib/recipes';
import { deviceTimeZone, localDate, TIMEZONES, timeZoneName } from '../lib/dates';
import { NATIVE_BUILD } from '../lib/config';
import type { IconName } from '../ui/icons';

const MORE_LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/favorites', label: 'Избранные рецепты', icon: 'heart' },
  { to: '/menu/history', label: 'История и избранные меню', icon: 'list' },
  { to: '/habits', label: 'Вода и привычки', icon: 'drop' },
  { to: '/articles', label: 'Статьи о питании', icon: 'leaf' },
  { to: '/about', label: 'О сервисе', icon: 'info' },
];


export default function ProfilePage() {
  const { household, gateway, user, catalog, reportError, toast, refreshHousehold, bump, setCurrentMenuId } = useApp();
  const [restoring, setRestoring] = useState<GuestExport | null>(null);
  const restore = async (mode: 'replace' | 'merge') => {
    if (!restoring) return;
    try {
      const r = await importGuestData(restoring, mode, catalog);
      setRestoring(null);
      if (mode === 'replace') setCurrentMenuId(null);
      await refreshHousehold();
      bump();
      toast(`Восстановлено: ${r.members} ${plural(r.members, 'участник', 'участника', 'участников')}, ${r.menus} меню`, { tone: 'success' });
    } catch (err) {
      reportError(err);
    }
  };
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  // Removal is confirmed first: undoing it would give the person a new id and detach them from the menu.
  const [removing, setRemoving] = useState<Member | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme());
  const fileRef = useRef<HTMLInputElement>(null);
  if (!household) return <Loading />;

  const removeMember = async (m: Member) => {
    try {
      await gateway.deleteMember(m.id);
      setRemoving(null);
      await refreshHousehold();
      toast(`${m.name}: удалено из семьи.`, { tone: 'success' });
      // Focus goes to the heading of the list instead of being lost with the removed card.
      document.getElementById('members-title')?.focus();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '18px' }}>
      <PageHead eyebrow={user ? user.email : 'Гостевой режим'} title={household.name} subtitle="Семья, настройки подбора и ваши данные" />
      <section className="stack">
        <div className="section-title">
          <h2 id="members-title" tabIndex={-1}>
            Кто ест
          </h2>
          <button className="btn small primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> Добавить
          </button>
        </div>
        <div className="grid">
          {household.members.map((m) => {
            const bans = m.restrictions.products.length + m.restrictions.categories.length + m.restrictions.allergens.length;
            return (
              <div key={m.id} className="card row" style={{ alignItems: 'flex-start' }}>
                <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 15, fontWeight: 750, fontSize: 18 }}>
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="grow">
                  <h3>{m.name}</h3>
                  <p className="muted small">
                    {m.portion_mode === 'target' && m.kcal_target ? `${num(m.kcal_target)} ккал/день` : `порция ×${num(m.portion_factor, 2)}`}
                    {m.age !== null ? ` · ${m.age} ${plural(m.age, 'год', 'года', 'лет')}` : ''}
                    {bans > 0 ? ` · запретов: ${bans}` : ''}
                  </p>
                </div>
                <button className="icon-btn small" onClick={() => setEditing(m)} aria-label={`Изменить: ${m.name}`}>
                  <Icon name="edit" size={18} />
                </button>
                {household.members.length > 1 && (
                  <button className="icon-btn small" onClick={() => setRemoving(m)} aria-label={`Удалить: ${m.name}`}>
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="grid">
        <Link to="/settings" className="card card-link row">
          <span className="ficon" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary-soft-ink)' }}>
            <Icon name="settings" />
          </span>
          <span className="grow">
            <strong>Настройки подбора</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Уровень, ПП, техника, повторы, витамины
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
        <Link to="/settings#store" className="card card-link row">
          <span className="ficon" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
            <Icon name="store" />
          </span>
          <span className="grow">
            <strong>{household.city ? household.city.name : 'Город и магазин'}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Цены, бюджет
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
        <Link to="/pantry" className="card card-link row">
          <span className="ficon" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--saffron-soft)', color: 'var(--saffron-ink)' }}>
            <Icon name="box" />
          </span>
          <span className="grow">
            <strong>Остатки дома</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Продукты и сроки годности
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
      </section>
      {/* On a phone the tab bar has five places; the rest of the app is reachable from here. */}
      <nav className="card stack more-links" aria-label="Ещё разделы" style={{ ['--gap' as string]: '0px', padding: 6 }}>
        {MORE_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="row more-link">
            <Icon name={l.icon} size={20} />
            <span className="grow">{l.label}</span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
      </nav>
      <section className="card stack">
        <h2>Оформление</h2>
        <Segmented<ThemeChoice>
          label="Тема"
          value={theme}
          onChange={(t) => {
            setTheme(t);
            applyTheme(t);
          }}
          options={[
            { value: 'system', label: 'Как в системе' },
            { value: 'light', label: 'Светлая' },
            { value: 'dark', label: 'Тёмная' },
          ]}
        />
      </section>
      {gateway.mode === 'guest' && (
        <section className="card stack">
          <h2>Мои данные на этом устройстве</h2>
          <Banner icon="info">
            {NATIVE_BUILD
              ? 'Данные хранятся только на этом телефоне и не синхронизируются. Удаление приложения удалит их — сохраняйте резервную копию.'
              : 'Без аккаунта данные хранятся только в этом браузере и не синхронизируются. Очистка данных браузера удалит их — сохраняйте резервную копию.'}
          </Banner>
          <div className="row wrap">
            <button
              className="btn"
              onClick={async () => {
                try {
                  await downloadJson(`foodo-backup-${localDate(deviceTimeZone())}.json`, await exportGuestData());
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              <Icon name="download" size={18} /> Резервная копия (JSON)
            </button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={18} /> Восстановить из файла
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(await file.text());
                  } catch {
                    throw new ApiError('invalid_import', 'Файл не читается как резервная копия Foodo (JSON).', 400);
                  }
                  setRestoring(migrateExport(parsed));
                } catch (err) {
                  reportError(err);
                }
              }}
            />
          </div>
        </section>
      )}
      <Link to="/account" className="btn ghost big">
        <Icon name={user ? 'shield' : 'user'} size={20} /> {user ? 'Аккаунт и безопасность' : 'Аккаунт: вход и синхронизация'}
      </Link>
      {restoring && (
        <Sheet
          open
          onClose={() => setRestoring(null)}
          title="Восстановить из файла"
          footer={
            <>
              <button className="btn primary" onClick={() => void restore('replace')}>
                Заменить
              </button>
              <button className="btn" onClick={() => void restore('merge')}>
                Добавить к текущим
              </button>
              <button className="btn ghost" onClick={() => setRestoring(null)}>
                Отмена
              </button>
            </>
          }
        >
          <div className="stack">
            <p>
              В файле от {new Date(restoring.exported_at).toLocaleDateString('ru-RU')}: {restoring.members.length} {plural(restoring.members.length, 'участник', 'участника', 'участников')}, {restoring.menus.length} меню, {restoring.pantry.length} {plural(restoring.pantry.length, 'продукт', 'продукта', 'продуктов')} в остатках.
            </p>
            <p className="small">
              <strong>Заменить</strong> — данные в этом {NATIVE_BUILD ? 'приложении' : 'браузере'} будут заменены содержимым файла, включая город, магазин и бюджет.
            </p>
            <p className="small">
              <strong>Добавить к текущим</strong> — ничего не перезаписывается: добавятся только записи, которых здесь ещё нет; настройки семьи останутся текущими.
            </p>
          </div>
        </Sheet>
      )}
      {removing && (
        <Sheet
          open
          onClose={() => setRemoving(null)}
          title={`Удалить: ${removing.name}?`}
          footer={
            <>
              <button className="btn ghost" onClick={() => setRemoving(null)}>
                Отмена
              </button>
              <button className="btn danger" onClick={() => void removeMember(removing)}>
                Удалить
              </button>
            </>
          }
        >
          <p>Запреты, вкусы и порции этого человека перестанут учитываться в новых меню. В уже составленном меню его порции останутся (они помечены «удалённый участник») — чтобы убрать их, составьте меню заново.</p>
        </Sheet>
      )}
      {editing && (
        <MemberSheet
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshHousehold();
          }}
        />
      )}
    </div>
  );
}

export function MemberSheet({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { gateway, catalog, reportError, toast } = useApp();
  const [m, setM] = useState<Member>(
    member ?? {
      id: '',
      name: '',
      age: null,
      sex: null,
      height_cm: null,
      weight_kg: null,
      activity: null,
      goal: null,
      portion_mode: 'simple',
      portion_factor: 1,
      kcal_target: null,
      restrictions: { products: [], categories: [], allergens: [] },
      preferences: { liked_recipes: [], disliked_products: [], liked_products: [] },
      diet_types: [],
      spice_tolerance: 1,
      vitamin_targets_manual: null,
      water_goal_ml: 2000,
      timezone: deviceTimeZone(),
    },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Member>(k: K, v: Member[K]) => setM((x) => ({ ...x, [k]: v }));
  // Checked as the user types, with the same ranges as the server; saving is blocked while any is wrong.
  // Fields of the calorie-target mode are hidden in simple mode: they neither block saving there nor
  // reach the server (stale values are cleared on save).
  const targetMode = m.portion_mode === 'target';
  const minor = m.age !== null && m.age !== undefined && m.age < 18;
  const errors = {
    age: rangeError('age', m.age),
    height_cm: targetMode ? rangeError('height_cm', m.height_cm) : null,
    weight_kg: targetMode ? rangeError('weight_kg', m.weight_kg) : null,
    kcal_target: targetMode ? rangeError('kcal_target', m.kcal_target) : null,
    goal: targetMode && minor && m.goal === 'lose' ? 'Снижение веса не рассчитывается для детей и подростков.' : null,
    water_goal_ml: rangeError('water_goal_ml', m.water_goal_ml),
  };
  const invalid = Object.values(errors).some(Boolean);
  const estimate = estimateEnergy(m);
  const active = quickExclusionsActive(m.restrictions);
  const save = async () => {
    setBusy(true);
    try {
      const { id, ...all } = m;
      const rest = targetMode
        ? all
        : {
            ...all,
            height_cm: rangeError('height_cm', all.height_cm) ? null : all.height_cm,
            weight_kg: rangeError('weight_kg', all.weight_kg) ? null : all.weight_kg,
            kcal_target: rangeError('kcal_target', all.kcal_target) ? null : all.kcal_target,
            goal: minor && all.goal === 'lose' ? null : all.goal,
          };
      if (member) await gateway.updateMember(id, rest);
      else await gateway.addMember(rest);
      toast('Сохранено', { tone: 'success' });
      await onSaved();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={member ? member.name : 'Новый участник'}
      footer={
        <button className="btn primary" onClick={() => void save()} disabled={busy || !m.name.trim() || invalid}>
          Сохранить
        </button>
      }
    >
      <div className="stack">
        <Field label="Имя или псевдоним">
          <input className="input" value={m.name} maxLength={60} onChange={(e) => set('name', e.target.value)} data-autofocus />
        </Field>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <Field label="Возраст" error={errors.age ?? undefined}>
            <NumberInput style={{ width: 110 }} value={m.age ?? null} invalid={!!errors.age} onChange={(v) => set('age', v)} />
          </Field>
          <div className="field">
            <span>Пол</span>
            <Segmented label="Пол" value={m.sex ?? 'none'} onChange={(v) => set('sex', v === 'none' ? null : (v as 'male' | 'female'))} options={[{ value: 'none', label: '—' }, { value: 'female', label: 'Ж' }, { value: 'male', label: 'М' }]} />
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Порции</span>
          <Segmented label="Режим порций" value={m.portion_mode} onChange={(v) => set('portion_mode', v)} options={[{ value: 'simple', label: 'Простые порции' }, { value: 'target', label: 'По цели калорий' }]} />
          {m.portion_mode === 'simple' ? (
            <div className="row between">
              <span className="muted small">Размер порции без расчёта целей</span>
              <Stepper label="Размер порции" value={m.portion_factor} onChange={(v) => set('portion_factor', v)} min={0.25} max={3} step={0.25} format={(v) => `×${num(v, 2)}`} />
            </div>
          ) : (
            <div className="stack" style={{ ['--gap' as string]: '10px' }}>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <Field label="Рост, см" error={errors.height_cm ?? undefined}>
                  <NumberInput decimal style={{ width: 110 }} value={m.height_cm ?? null} invalid={!!errors.height_cm} onChange={(v) => set('height_cm', v)} />
                </Field>
                <Field label="Вес, кг" error={errors.weight_kg ?? undefined}>
                  <NumberInput decimal style={{ width: 110 }} value={m.weight_kg ?? null} invalid={!!errors.weight_kg} onChange={(v) => set('weight_kg', v)} />
                </Field>
              </div>
              <Field label="Активность">
                <select className="input" value={m.activity ?? ''} onChange={(e) => set('activity', (e.target.value || null) as Member['activity'])}>
                  <option value="">не указана</option>
                  <option value="low">низкая</option>
                  <option value="light">лёгкая</option>
                  <option value="moderate">умеренная</option>
                  <option value="high">высокая</option>
                  <option value="very_high">очень высокая</option>
                </select>
              </Field>
              <Field label="Цель" error={errors.goal ?? undefined}>
                <select className="input" value={m.goal ?? ''} aria-invalid={Boolean(errors.goal)} onChange={(e) => set('goal', (e.target.value || null) as Member['goal'])}>
                  <option value="">не указана</option>
                  <option value="maintain">поддержание</option>
                  <option value="lose" disabled={minor && m.goal !== 'lose'}>
                    снижение веса{minor ? ' (недоступно до 18 лет)' : ''}
                  </option>
                  <option value="gain">набор</option>
                </select>
              </Field>
              {/* The button stays outside the <label>: inside it would become part of the field's name. */}
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Цель, ккал в день" error={errors.kcal_target ?? undefined}>
                  <NumberInput style={{ width: 130 }} value={m.kcal_target ?? null} invalid={!!errors.kcal_target} onChange={(v) => set('kcal_target', v)} />
                </Field>
                <button type="button" className="btn small" style={{ marginBottom: errors.kcal_target ? 24 : 4 }} disabled={!estimate.available} onClick={() => set('kcal_target', estimate.kcal)}>
                  Рассчитать
                </button>
              </div>
              <p className="muted tiny">Можно задать вручную. Расчёт — ориентир, а не медицинская рекомендация.</p>
              <p className="muted tiny">{estimate.available ? `Метод: ${estimate.method}. Ориентир: ${num(estimate.kcal ?? 0)} ккал.` : estimate.reason}</p>
            </div>
          )}
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Тип питания (строгое правило)</span>
          <div className="chips">
            {(catalog.reference.diet_types ?? []).map((t) => {
              const on = (m.diet_types ?? []).includes(t.id);
              return (
                <Chip key={t.id} on={on} onClick={() => set('diet_types', on ? (m.diet_types ?? []).filter((x) => x !== t.id) : [...(m.diet_types ?? []), t.id])}>
                  {t.name}
                </Chip>
              );
            })}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Острота</span>
          <Segmented
            label="Острота"
            value={String(spiceTolerance(m))}
            onChange={(v) => set('spice_tolerance', Number(v))}
            options={[
              { value: '0', label: 'Без остроты' },
              { value: '1', label: 'Немного' },
              { value: '2', label: 'Острое' },
            ]}
          />
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Нельзя (жёсткие запреты)</span>
          <div className="chips">
            {QUICK_EXCLUSIONS.map((q) => (
              <Chip key={q.id} tone="ban" on={active.has(q.id)} onClick={() => set('restrictions', toggleQuickExclusion(m.restrictions, q.id, !active.has(q.id)))}>
                {q.label}
              </Chip>
            ))}
          </div>
          <ProductPicker
            label="Запретить конкретный продукт"
            value={null}
            exclude={m.restrictions.products}
            onChange={(p) => set('restrictions', { ...m.restrictions, products: [...m.restrictions.products, p.id] })}
          />
          {m.restrictions.products.length > 0 && (
            <div className="chips">
              {m.restrictions.products.map((id) => (
                <Chip key={id} tone="ban" on onClick={() => set('restrictions', { ...m.restrictions, products: m.restrictions.products.filter((x) => x !== id) })}>
                  {catalog.products[id]?.name ?? id}
                </Chip>
              ))}
            </div>
          )}
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Люблю (такие блюда будут чаще)</span>
          <ProductPicker
            label="Добавить любимый продукт"
            value={null}
            exclude={m.preferences.liked_products ?? []}
            onChange={(p) => set('preferences', { ...m.preferences, liked_products: [...(m.preferences.liked_products ?? []), p.id], disliked_products: m.preferences.disliked_products.filter((x) => x !== p.id) })}
          />
          <div className="chips">
            {(m.preferences.liked_products ?? []).map((id) => (
              <Chip key={id} on onClick={() => set('preferences', { ...m.preferences, liked_products: (m.preferences.liked_products ?? []).filter((x) => x !== id) })}>
                {catalog.products[id]?.name ?? id}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="label">Не люблю (влияет только на выбор)</span>
          <ProductPicker
            label="Добавить продукт"
            value={null}
            exclude={m.preferences.disliked_products}
            onChange={(p) => set('preferences', { ...m.preferences, disliked_products: [...m.preferences.disliked_products, p.id] })}
          />
          <div className="chips">
            {m.preferences.disliked_products.map((id) => (
              <Chip key={id} on onClick={() => set('preferences', { ...m.preferences, disliked_products: m.preferences.disliked_products.filter((x) => x !== id) })}>
                {catalog.products[id]?.name ?? id}
              </Chip>
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Вода в день, мл" error={errors.water_goal_ml ?? undefined}>
            <NumberInput style={{ width: 140 }} value={m.water_goal_ml ?? null} invalid={!!errors.water_goal_ml} onChange={(v) => set('water_goal_ml', v)} />
          </Field>
          <Field label="Часовой пояс">
            <select className="input" value={m.timezone ?? 'Europe/Moscow'} onChange={(e) => set('timezone', e.target.value)}>
              {[...new Set([m.timezone ?? 'Europe/Moscow', ...TIMEZONES.map(([tz]) => tz)])].map((tz) => (
                <option key={tz} value={tz}>
                  {timeZoneName(tz)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
