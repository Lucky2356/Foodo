import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Restrictions, SkillLevel } from '../engine';
import { useApp } from '../state/app';
import { Icon } from '../ui/icons';
import { Chip, Segmented, Stepper } from '../ui/kit';
import { deviceTimeZone, localDate } from '../lib/dates';
import { QUICK_EXCLUSIONS, toggleQuickExclusion } from '../lib/recipes';
import { DEFAULT_HOUSEHOLD_SETTINGS } from '../data/guestGateway';

const EQUIPMENT: { id: string; label: string }[] = [
  { id: 'stove', label: 'Плита' },
  { id: 'oven', label: 'Духовка' },
  { id: 'microwave', label: 'Микроволновка' },
  { id: 'multicooker', label: 'Мультиварка' },
  { id: 'blender', label: 'Блендер' },
  { id: 'airfryer', label: 'Аэрогриль' },
];

/**
 * Quick start in two steps: who eats and what is forbidden. Everything else has sensible defaults
 * and can be changed later in «Настройки».
 */
export default function StartPage() {
  const { gateway, household, refreshHousehold, setCurrentMenuId, reportError, toast } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState(0);
  const [restrictions, setRestrictions] = useState<Restrictions>({ products: [], categories: [], allergens: [] });
  const [active, setActive] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
  const [skill, setSkill] = useState<SkillLevel>('any');
  const [equipment, setEquipment] = useState<string[]>(['stove', 'oven', 'microwave']);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    const on = !active.has(id);
    const next = new Set(active);
    if (on) next.add(id);
    else next.delete(id);
    setActive(next);
    setRestrictions((r) => toggleQuickExclusion(r, id, on));
  };

  const create = async () => {
    setBusy(true);
    try {
      const tz = household?.city?.timezone ?? deviceTimeZone();
      const existing = household?.members.length ?? 0;
      if (existing === 0) {
        for (let i = 0; i < adults; i += 1) {
          await gateway.addMember({ name: adults === 1 ? 'Я' : `Взрослый ${i + 1}`, age: null, portion_mode: 'simple', portion_factor: 1, restrictions, timezone: tz });
        }
        for (let i = 0; i < kids; i += 1) {
          await gateway.addMember({ name: kids === 1 ? 'Ребёнок' : `Ребёнок ${i + 1}`, age: null, portion_mode: 'simple', portion_factor: 0.6, restrictions, timezone: tz });
        }
      }
      const settings = household?.settings ?? DEFAULT_HOUSEHOLD_SETTINGS;
      await gateway.updateHousehold({ settings: { ...settings, onboarded: true, plan: { ...settings.plan, skill, equipment } } });
      await refreshHousehold();
      const record = await gateway.generateMenu({ start_date: localDate(tz), days: settings.days });
      setCurrentMenuId(record.id);
      toast('Меню готово. Любое блюдо можно заменить одним нажатием.', { tone: 'success' });
      navigate('/menu');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack fade-in" style={{ maxWidth: 680, margin: '0 auto', ['--gap' as string]: '20px' }}>
      <div className="row" style={{ ['--gap' as string]: '6px' }} aria-label={`Шаг ${step} из 2`}>
        {[1, 2].map((s) => (
          <span key={s} style={{ height: 6, flex: 1, borderRadius: 999, background: s <= step ? 'var(--primary)' : 'var(--surface-3)', transition: 'background .3s' }} />
        ))}
      </div>
      {step === 1 ? (
        <>
          <div>
            <div className="eyebrow muted small">Шаг 1 из 2</div>
            <h1>Для кого готовим?</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              Имена, возраст и цели можно добавить потом — пока хватит количества.
            </p>
          </div>
          <div className="card stack">
            <div className="row between">
              <div>
                <h3>Взрослые</h3>
                <p className="muted small">Стандартная порция</p>
              </div>
              <Stepper value={adults} onChange={setAdults} min={kids > 0 ? 0 : 1} max={10} step={1} label="Взрослые" />
            </div>
            <hr className="sep" style={{ margin: 0 }} />
            <div className="row between">
              <div>
                <h3>Дети</h3>
                <p className="muted small">Порция поменьше, меняется в профиле</p>
              </div>
              <Stepper value={kids} onChange={setKids} min={0} max={8} step={1} label="Дети" />
            </div>
          </div>
          <button className="btn primary big block" onClick={() => setStep(2)} disabled={adults + kids === 0}>
            Дальше
            <Icon name="chevron" size={18} />
          </button>
        </>
      ) : (
        <>
          <div>
            <div className="eyebrow muted small">Шаг 2 из 2</div>
            <h1>Чего нельзя?</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              Отметьте то, что точно не должно попасть в меню. Запреты проверяются по составу блюда. Если ничего — просто жмите «Составить меню».
            </p>
          </div>
          <div className="chips" role="group" aria-label="Исключения">
            {QUICK_EXCLUSIONS.map((q) => (
              <Chip key={q.id} on={active.has(q.id)} onClick={() => toggle(q.id)} tone="ban">
                {q.label}
              </Chip>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setMore((v) => !v)} aria-expanded={more}>
            <Icon name="settings" size={18} /> {more ? 'Скрыть настройки' : 'Кухня и уровень готовки'}
          </button>
          {more && (
            <div className="card stack fade-in">
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                <span className="label">Уровень готовки</span>
                <Segmented
                  label="Уровень готовки"
                  value={skill}
                  onChange={setSkill}
                  options={[
                    { value: 'beginner', label: 'Начинающий' },
                    { value: 'confident', label: 'Уверенно готовлю' },
                    { value: 'any', label: 'Любой уровень' },
                  ]}
                />
              </div>
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                <span className="label">Что есть на кухне</span>
                <div className="chips">
                  {EQUIPMENT.map((e) => (
                    <Chip key={e.id} on={equipment.includes(e.id)} onClick={() => setEquipment((list) => (list.includes(e.id) ? list.filter((x) => x !== e.id) : [...list, e.id]))}>
                      {e.label}
                    </Chip>
                  ))}
                </div>
                <p className="muted small">Блюда без нагрева доступны всегда, даже если ничего не отмечено.</p>
              </div>
            </div>
          )}
          <div className="row">
            <button className="btn ghost big" onClick={() => setStep(1)}>
              <Icon name="back" size={18} /> Назад
            </button>
            <button className="btn primary big grow" onClick={() => void create()} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="sparkle" size={18} />}
              {busy ? 'Составляем…' : 'Составить меню'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
