import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { DietMode, RepeatMode, SkillLevel } from '../engine';
import { estimateEnergy } from '../engine';
import type { Member } from '../engine';
import { useApp } from '../state/app';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { Illustration } from '../ui/illustrations';
import type { IllustrationName } from '../ui/illustrations';
import { Chip, NumberInput, Stepper } from '../ui/kit';
import { budgetError, rangeError } from '../lib/numbers';
import { plural } from '../lib/format';
import { ProductPicker } from '../ui/ProductPicker';
import { deviceTimeZone, localDate } from '../lib/dates';
import { QUICK_EXCLUSIONS, quickExclusionsActive, SLOT_NAMES, toggleQuickExclusion } from '../lib/recipes';
import { defaultAnswers, planHousehold, planSettings, slotsInOrder, TASTE_PRODUCTS } from '../lib/questionnaire';
import type { Answers, Goal } from '../lib/questionnaire';
import { DEFAULT_HOUSEHOLD_SETTINGS } from '../data/guestGateway';

const EQUIPMENT: { id: string; label: string }[] = [
  { id: 'stove', label: 'Плита' },
  { id: 'oven', label: 'Духовка' },
  { id: 'microwave', label: 'Микроволновка' },
  { id: 'multicooker', label: 'Мультиварка' },
  { id: 'blender', label: 'Блендер' },
  { id: 'airfryer', label: 'Аэрогриль' },
];

const TIME_OPTIONS: { value: number | null; label: string }[] = [
  { value: 20, label: 'до 20 мин' },
  { value: 30, label: 'до 30 мин' },
  { value: 45, label: 'до 45 мин' },
  { value: 60, label: 'до часа' },
  { value: 90, label: 'до 1,5 часа' },
  { value: null, label: 'Не важно' },
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const STEPS: { id: string; title: string; hint: string; art: IllustrationName }[] = [
  { id: 'family', title: 'Для кого готовим?', hint: 'Детям блюда подбираются без остроты, а порции меньше.', art: 'family' },
  { id: 'goal', title: 'Какая цель?', hint: 'Можно просто есть вкусно — считать калории не обязательно.', art: 'goal' },
  { id: 'diet', title: 'Как вы питаетесь?', hint: 'Тип питания — это строгое правило: такие продукты в меню не попадут.', art: 'diet' },
  { id: 'ban', title: 'Чего нельзя?', hint: 'Строгие запреты: такие продукты не попадут в меню ни в каком виде. Проверяем по составу, а не по названию.', art: 'ban' },
  { id: 'taste', title: 'Что вы любите?', hint: 'Это пожелания, а не запреты: любимое будет чаще, нелюбимое — реже.', art: 'taste' },
  { id: 'kitchen', title: 'Кухня и время', hint: 'Подберём блюда под вашу технику и время, которое не жалко на готовку.', art: 'kitchen' },
  { id: 'plan', title: 'Меню и покупки', hint: 'На сколько дней составить меню и сколько раз в день вы едите.', art: 'calendar' },
  { id: 'summary', title: 'Проверьте ответы', hint: 'Всё можно поменять позже в профиле и настройках.', art: 'summary' },
];

const GOALS: { value: Goal; title: string; text: string; icon: IconName }[] = [
  { value: 'simple', title: 'Просто вкусно и разнообразно', text: 'Обычные порции, без подсчёта калорий', icon: 'sparkle' },
  { value: 'maintain', title: 'Держать вес', text: 'Порции по вашей норме калорий', icon: 'scale' },
  { value: 'lose', title: 'Снизить вес', text: 'Умеренный дефицит, только для взрослых', icon: 'trend-down' },
  { value: 'gain', title: 'Набрать вес', text: 'Небольшой профицит калорий', icon: 'trend-up' },
];

const DIET_MODES: { value: DietMode; title: string; text: string }[] = [
  { value: 'regular', title: 'Обычное', text: 'Любые блюда без особых правил' },
  { value: 'balanced', title: 'ПП', text: 'Больше овощей и цельных круп, меньше жарки и сладкого' },
  { value: 'high_protein', title: 'Больше белка', text: 'Чаще нежирное мясо, рыба и бобовые' },
];

const SPICE: { value: number; title: string; text: string }[] = [
  { value: 0, title: 'Без остроты', text: 'Без чили и острых соусов; чеснок и чёрный перец — как обычно' },
  { value: 1, title: 'Немного', text: 'Щепотка чили, умеренно острые блюда' },
  { value: 2, title: 'Люблю острое', text: 'Чили, аджика и острые соусы' },
];

const SKILLS: { value: SkillLevel; title: string; text: string }[] = [
  { value: 'beginner', title: 'Начинающий', text: 'Простые блюда без сложных приёмов' },
  { value: 'confident', title: 'Уверенно готовлю', text: 'Обычные домашние блюда' },
  { value: 'any', title: 'Любой уровень', text: 'Включая тесто, запекание и сложные техники' },
];

const REPEATS: { value: RepeatMode; title: string; text: string }[] = [
  { value: 'unique', title: 'Разные блюда каждый день', text: 'Без повторов за весь период' },
  { value: 'allow', title: 'Повторы можно', text: 'Любимые блюда иногда возвращаются' },
  { value: 'batch', title: 'Готовлю на 2–3 дня', text: 'Одна кастрюля — на несколько обедов и ужинов' },
];

function OptionCard({ selected, onClick, title, text, icon, multi }: { selected: boolean; onClick: () => void; title: string; text?: string; icon?: IconName; multi?: boolean }) {
  return (
    <button type="button" className={`option-card${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onClick}>
      {icon && (
        <span className="option-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className="grow">
        <span className="option-title">{title}</span>
        {text && <span className="option-text">{text}</span>}
      </span>
      <span className={`option-check${multi ? ' square' : ''}`} aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ ['--gap' as string]: '10px' }}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/**
 * «Анкета»: the user describes the family, goal, diet, bans, tastes, kitchen and plan first; the
 * menu is generated only after the summary is confirmed. Answers pre-fill from an existing
 * household, so the questionnaire can be taken again from the settings.
 */
export default function StartPage() {
  const { gateway, household, catalog, refreshHousehold, setCurrentMenuId, reportError, toast } = useApp();
  const navigate = useNavigate();
  // The answers the questionnaire started with: taking it again applies only what was changed.
  const [initial] = useState<Answers>(() => defaultAnswers(household));
  // The step lives in the address (#/start?step=3): the browser's Back goes to the previous step.
  const [params, setParams] = useSearchParams();
  // A draft survives a reload in the middle of the questionnaire; a fresh start (no step in the
  // address) ignores it, and it is dropped when the menu is made.
  const [answers, setAnswers] = useState<Answers>(() => (params.has('step') ? readDraft() : null) ?? initial);
  const step = Math.min(STEPS.length - 1, Math.max(0, Number(params.get('step') ?? '1') - 1 || 0));
  const prevStep = useRef(step);
  const direction: 'next' | 'back' = step >= prevStep.current ? 'next' : 'back';
  useEffect(() => {
    prevStep.current = step;
  }, [step]);
  // Set after «Изменить» in the summary, so the user can jump straight back to it.
  const [fromSummary, setFromSummary] = useState(false);
  useEffect(() => {
    writeDraft(answers);
  }, [answers]);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const existing = household?.members ?? [];
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setAnswers((a) => ({ ...a, [key]: value }));

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const tasteProducts = useMemo(() => TASTE_PRODUCTS.filter((id) => catalog.products[id]), [catalog]);
  const cuisines = catalog.reference.cuisines ?? [];
  const dietTypes = catalog.reference.diet_types ?? [];
  const active = quickExclusionsActive(answers.restrictions);
  // Allergens have their own list below; a combined quick exclusion (milk, gluten…) is shown only
  // when an older profile has it on, so it can still be switched off.
  const foodGroups = QUICK_EXCLUSIONS.filter((q) => !q.allergens || active.has(q.id));
  const cycleTaste = (id: string) =>
    setAnswers((a) => {
      const liked = a.liked_products.includes(id);
      const disliked = a.disliked_products.includes(id);
      if (!liked && !disliked) return { ...a, liked_products: [...a.liked_products, id] };
      if (liked) return { ...a, liked_products: a.liked_products.filter((x) => x !== id), disliked_products: [...a.disliked_products, id] };
      return { ...a, disliked_products: a.disliked_products.filter((x) => x !== id) };
    });
  const meEstimate = estimateEnergy({ ...(answers.me as Partial<Member>), goal: answers.goal === 'simple' ? null : answers.goal } as Member);
  const plan = planHousehold(answers, initial, existing, household?.city?.timezone ?? deviceTimeZone());

  const go = (to: number) => setParams({ step: String(to + 1) });

  // Personal data is checked on its own step, before anything is saved (the server rules are the same).
  const meErrors = {
    age: rangeError('age', answers.me.age) ?? (answers.me.age !== null && answers.me.age !== undefined && answers.me.age < 18 ? 'Расчёт нормы — только для взрослых (18+).' : null),
    height_cm: rangeError('height_cm', answers.me.height_cm),
    weight_kg: rangeError('weight_kg', answers.me.weight_kg),
  };
  const budgetErr = budgetError(answers.budget_rub);
  const canContinue = (() => {
    if (STEPS[step]?.id === 'family') return answers.adults + answers.children.length > 0;
    if (STEPS[step]?.id === 'goal') return answers.adults === 0 || answers.goal === 'simple' || !Object.values(meErrors).some(Boolean);
    if (STEPS[step]?.id === 'plan') return answers.slots.length > 0 && !budgetErr;
    return true;
  })();

  const finish = async () => {
    setBusy(true);
    try {
      const tz = household?.city?.timezone ?? deviceTimeZone();
      // Existing members keep their names, own bans and tastes; adults and children are matched separately.
      for (const { member, patch } of plan.update) await gateway.updateMember(member.id, patch);
      for (const draft of plan.add) await gateway.addMember(draft);
      for (const gone of plan.remove) await gateway.deleteMember(gone.id);
      const settings = household?.settings ?? DEFAULT_HOUSEHOLD_SETTINGS;
      await gateway.updateHousehold({
        settings: { ...settings, onboarded: true, slots: slotsInOrder(answers.slots), days: answers.days, plan: planSettings(answers, settings.plan) },
      });
      await refreshHousehold();
      const record = await gateway.generateMenu({ start_date: localDate(tz), days: answers.days });
      setCurrentMenuId(record.id);
      toast('Меню готово. Любое блюдо можно заменить одним нажатием.', { tone: 'success' });
      clearDraft();
      navigate('/menu');
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="generating fade-in" role="status" aria-live="polite">
        <Illustration name="cooking" />
        <h1>Подбираем блюда…</h1>
        <p className="muted">Проверяем запреты по составу, считаем порции и собираем список покупок.</p>
        <div className="generating-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }

  const current = STEPS[step]!;
  const total = STEPS.length;

  return (
    <div className="wizard">
      <div className="wizard-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-valuetext={`Шаг ${step + 1} из ${total}: ${current.title}`}>
        <div className="wizard-progress-bar">
          <span style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <span className="small muted num">
          {step + 1} / {total}
        </span>
      </div>

      <div key={step} className={`wizard-step slide-${direction}`}>
        <div className="wizard-head">
          <div className="wizard-art">
            <Illustration name={current.art} />
          </div>
          <div>
            <h1 ref={headingRef} tabIndex={-1}>
              {current.title}
            </h1>
            <p className="muted wizard-hint">{current.hint}</p>
          </div>
        </div>

        {current.id === 'family' && (
          <div className="stack">
            {existing.length > 0 && (
              <p className="small muted">
                Сейчас в семье: {existing.map((m) => m.name).join(', ')}. Имена, личные запреты и вкусы сохранятся, общие ответы анкеты применятся ко всем.
              </p>
            )}
            <div className="card stack">
              <div className="row between">
                <div>
                  <h3>Взрослые</h3>
                  <p className="muted small">Обычная порция</p>
                </div>
                <Stepper value={answers.adults} onChange={(v) => set('adults', v)} min={answers.children.length > 0 ? 0 : 1} max={10} step={1} label="Взрослые" />
              </div>
              <hr className="sep" style={{ margin: 0 }} />
              <div className="row between">
                <div>
                  <h3>Дети</h3>
                  <p className="muted small">Укажите возраст — от него зависят порция и острота</p>
                </div>
                <Stepper
                  value={answers.children.length}
                  onChange={(n) => set('children', n > answers.children.length ? [...answers.children, { age: 8 }] : answers.children.slice(0, n))}
                  min={0}
                  max={8}
                  step={1}
                  label="Дети"
                />
              </div>
              {answers.children.map((c, i) => (
                <div key={i} className="row between child-row pop-in">
                  <span>Ребёнок {i + 1}</span>
                  <Stepper
                    value={c.age}
                    onChange={(age) => set('children', answers.children.map((x, j) => (j === i ? { age } : x)))}
                    min={1}
                    max={17}
                    step={1}
                    format={yearsLabel}
                    label={`Возраст ребёнка ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {current.id === 'goal' && answers.adults === 0 && (
          <div className="banner" role="status">
            <Icon name="info" />
            <div className="grow">Расчёт нормы калорий делается только для взрослых, а сейчас в семье только дети. Порции будут обычными, по возрасту.</div>
          </div>
        )}

        {current.id === 'goal' && answers.adults > 0 && (
          <div className="stack">
            <div className="option-grid">
              {GOALS.map((g) => (
                <OptionCard key={g.value} selected={answers.goal === g.value} onClick={() => set('goal', g.value)} title={g.title} text={g.text} icon={g.icon} />
              ))}
            </div>
            {answers.goal !== 'simple' && (
              <div className="card stack pop-in">
                <p className="small muted">Норма считается для вас (первого взрослого) по формуле Миффлина — Сан Жеора. Это ориентир, а не медицинская рекомендация. Детям дефицит калорий не рассчитывается.</p>
                <div className="form-grid">
                  <label className="field">
                    <span>Пол</span>
                    <select className="input" value={answers.me.sex ?? ''} onChange={(e) => set('me', { ...answers.me, sex: (e.target.value || null) as Answers['me']['sex'] })}>
                      <option value="">Не указан</option>
                      <option value="female">Женский</option>
                      <option value="male">Мужской</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Возраст, лет</span>
                    <NumberInput value={answers.me.age ?? null} invalid={!!meErrors.age} onChange={(v) => set('me', { ...answers.me, age: v })} />
                    {meErrors.age && <span className="field-error">{meErrors.age}</span>}
                  </label>
                  <label className="field">
                    <span>Рост, см</span>
                    <NumberInput value={answers.me.height_cm ?? null} invalid={!!meErrors.height_cm} onChange={(v) => set('me', { ...answers.me, height_cm: v })} />
                    {meErrors.height_cm && <span className="field-error">{meErrors.height_cm}</span>}
                  </label>
                  <label className="field">
                    <span>Вес, кг</span>
                    <NumberInput decimal value={answers.me.weight_kg ?? null} invalid={!!meErrors.weight_kg} onChange={(v) => set('me', { ...answers.me, weight_kg: v })} />
                    {meErrors.weight_kg && <span className="field-error">{meErrors.weight_kg}</span>}
                  </label>
                  <label className="field">
                    <span>Активность</span>
                    <select className="input" value={answers.me.activity ?? 'moderate'} onChange={(e) => set('me', { ...answers.me, activity: e.target.value as Member['activity'] })}>
                      <option value="low">Сидячая работа, без спорта</option>
                      <option value="light">Лёгкая: 1–3 тренировки в неделю</option>
                      <option value="moderate">Средняя: 3–5 тренировок</option>
                      <option value="high">Высокая: 6–7 тренировок</option>
                      <option value="very_high">Очень высокая, физический труд</option>
                    </select>
                  </label>
                </div>
                <div className={`banner ${meEstimate.available ? 'ok' : 'warn'}`}>
                  <Icon name={meEstimate.available ? 'sparkle' : 'info'} />
                  <div className="grow">
                    {meEstimate.available ? (
                      <>
                        Ваша ориентировочная норма — <strong className="num">{meEstimate.kcal} ккал</strong> в день.
                      </>
                    ) : (
                      <>{meEstimate.reason} Пока данных нет, порции будут обычными.</>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {current.id === 'diet' && (
          <div className="stack">
            <Field label="Тип питания — можно несколько">
              <div className="chips">
                <Chip on={answers.diet_types.length === 0} onClick={() => set('diet_types', [])}>
                  Ем всё
                </Chip>
                {dietTypes.map((t) => (
                  <Chip key={t.id} on={answers.diet_types.includes(t.id)} onClick={() => set('diet_types', toggle(answers.diet_types, t.id))}>
                    {t.name}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Стиль питания">
              <div className="option-grid three">
                {DIET_MODES.map((d) => (
                  <OptionCard key={d.value} selected={answers.diet_mode === d.value} onClick={() => set('diet_mode', d.value)} title={d.title} text={d.text} />
                ))}
              </div>
            </Field>
          </div>
        )}

        {current.id === 'ban' && (
          <div className="stack">
            {existing.length > 1 && <p className="small muted">Здесь общие запреты для всей семьи. Личные запреты участников сохранятся — их можно изменить в профиле.</p>}
            <Field label="Аллергия или непереносимость">
              <div className="chips">
                {catalog.reference.allergens.map((a) => (
                  <Chip
                    key={a.id}
                    tone="ban"
                    on={answers.restrictions.allergens.includes(a.id)}
                    onClick={() => set('restrictions', { ...answers.restrictions, allergens: toggle(answers.restrictions.allergens, a.id) })}
                  >
                    {a.name}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Не едим совсем">
              <div className="chips" role="group" aria-label="Исключения">
                {foodGroups.map((q) => (
                  <Chip key={q.id} on={active.has(q.id)} onClick={() => set('restrictions', toggleQuickExclusion(answers.restrictions, q.id, !active.has(q.id)))} tone="ban">
                    {q.label}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Конкретный продукт">
              <ProductPicker
                value={null}
                label="Название продукта"
                exclude={answers.restrictions.products}
                onChange={(p) => set('restrictions', { ...answers.restrictions, products: [...answers.restrictions.products, p.id] })}
              />
              {answers.restrictions.products.length > 0 && (
                <div className="chips">
                  {answers.restrictions.products.map((id) => (
                    <Chip key={id} tone="ban" on onClick={() => set('restrictions', { ...answers.restrictions, products: answers.restrictions.products.filter((x) => x !== id) })}>
                      {catalog.products[id]?.name ?? id}
                    </Chip>
                  ))}
                </div>
              )}
            </Field>
          </div>
        )}

        {current.id === 'taste' && (
          <div className="stack">
            {/* Only adults choose spiciness: a family of children gets mild dishes without being asked. */}
            {answers.adults > 0 ? (
              <Field label="Острота для взрослых">
                <div className="option-grid three">
                  {SPICE.map((o) => (
                    <OptionCard key={o.value} selected={answers.spice === o.value} onClick={() => set('spice', o.value)} title={o.title} text={o.text} />
                  ))}
                </div>
                {answers.children.length > 0 && <p className="small muted">Детям острые блюда не подбираются — это меняется в профиле ребёнка.</p>}
              </Field>
            ) : (
              <p className="small muted">Детям острые блюда не подбираются — это меняется в профиле ребёнка.</p>
            )}
            <Field label="Любимые кухни">
              <div className="chips">
                {cuisines.map((c) => (
                  <Chip key={c.id} on={answers.cuisines.includes(c.id)} onClick={() => set('cuisines', toggle(answers.cuisines, c.id))}>
                    {c.name}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Продукты">
              <div className="legend" aria-hidden="true">
                <span>
                  <Icon name="heart" size={14} /> 1 нажатие — люблю
                </span>
                <span>
                  <Icon name="close" size={14} /> 2 нажатия — не люблю
                </span>
              </div>
              <div className="chips">
                {tasteProducts.map((id) => {
                  const name = catalog.products[id]!.name;
                  const liked = answers.liked_products.includes(id);
                  const disliked = answers.disliked_products.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`chip like${disliked ? ' dislike' : ''}`}
                      aria-pressed={liked}
                      aria-label={`${name}: ${liked ? 'люблю' : disliked ? 'не люблю' : 'без разницы'}`}
                      onClick={() => cycleTaste(id)}
                    >
                      {liked && <Icon name="heart" size={16} />}
                      {disliked && <Icon name="close" size={16} strokeWidth={2.4} />}
                      {name}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}

        {current.id === 'kitchen' && (
          <div className="stack">
            <Field label="Уровень готовки">
              <div className="option-grid three">
                {SKILLS.map((o) => (
                  <OptionCard key={o.value} selected={answers.skill === o.value} onClick={() => set('skill', o.value)} title={o.title} text={o.text} />
                ))}
              </div>
            </Field>
            <Field label="Что есть на кухне">
              <div className="chips">
                {EQUIPMENT.map((e) => (
                  <Chip key={e.id} on={answers.equipment.includes(e.id)} onClick={() => set('equipment', toggle(answers.equipment, e.id))}>
                    {e.label}
                  </Chip>
                ))}
              </div>
              <p className="small muted">Блюда без нагрева доступны всегда.</p>
            </Field>
            <Field label="Время на готовку в будни">
              <div className="chips">
                {TIME_OPTIONS.map((t) => (
                  <Chip key={String(t.value)} on={answers.weekday_min === t.value} onClick={() => set('weekday_min', t.value)}>
                    {t.label}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="В выходные">
              <div className="chips">
                <Chip on={answers.weekend_min === 'same'} onClick={() => set('weekend_min', 'same')}>
                  Как в будни
                </Chip>
                {TIME_OPTIONS.map((t) => (
                  <Chip key={String(t.value)} on={answers.weekend_min === t.value} onClick={() => set('weekend_min', t.value)}>
                    {t.label}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        )}

        {current.id === 'plan' && (
          <div className="stack">
            <Field label="Приёмы пищи">
              <div className="chips">
                {slotsInOrder(['breakfast', 'lunch', 'snack', 'dinner']).map((s) => (
                  <Chip key={s} on={answers.slots.includes(s)} onClick={() => set('slots', toggle(answers.slots, s))}>
                    {SLOT_NAMES[s]}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Меню на">
              <div className="row wrap">
                <div className="chips">
                  {[3, 7, 14, 30].map((d) => (
                    <Chip key={d} on={answers.days === d} onClick={() => set('days', d)}>
                      {d === 7 ? 'неделю' : d === 14 ? '2 недели' : d === 30 ? 'месяц' : `${d} дня`}
                    </Chip>
                  ))}
                </div>
                <Stepper value={answers.days} onChange={(v) => set('days', v)} min={1} max={35} step={1} format={(v) => `${v} дн.`} label="Дней в меню" />
              </div>
            </Field>
            <Field label="Повторы блюд">
              <div className="option-grid three">
                {REPEATS.map((o) => (
                  <OptionCard key={o.value} selected={answers.repeat === o.value} onClick={() => set('repeat', o.value)} title={o.title} text={o.text} />
                ))}
              </div>
            </Field>
            {answers.slots.includes('lunch') && (
              <Field label="Обед в контейнер — в какие дни">
                <div className="chips">
                  {WEEKDAYS.map((d, i) => (
                    <Chip key={d} on={answers.container_days.includes(i + 1)} onClick={() => set('container_days', toggle(answers.container_days, i + 1))}>
                      {d}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            <div className="form-grid">
              <label className="field">
                <span>Бюджет на покупки за период, ₽ (необязательно)</span>
                <NumberInput placeholder="Без лимита" value={answers.budget_rub} invalid={!!budgetErr} onChange={(v) => set('budget_rub', v)} />
                {budgetErr && <span className="field-error">{budgetErr}</span>}
              </label>
              <label className="switch-row">
                <span className="grow">
                  <span className="option-title">Учитывать витамины</span>
                  <span className="option-text">Чаще блюда, которые закрывают нормы A, C, D, E, B6, B12 и фолата</span>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={answers.vitamins} onChange={(e) => set('vitamins', e.target.checked)} />
                </span>
              </label>
            </div>
          </div>
        )}

        {current.id === 'summary' && (
          <Summary
            answers={answers}
            onEdit={(to) => {
              setFromSummary(true);
              go(to);
            }}
            removed={plan.remove.map((m) => m.name)}
          />
        )}
      </div>

      {!canContinue && (
        <p className="small muted" role="status" style={{ textAlign: 'center' }}>
          {current.id === 'family' ? 'Добавьте хотя бы одного человека.' : current.id === 'plan' && answers.slots.length === 0 ? 'Выберите хотя бы один приём пищи.' : 'Исправьте отмеченные поля.'}
        </p>
      )}
      <div className="wizard-nav">
        {step > 0 && (
          <button type="button" className="btn ghost big" onClick={() => go(step - 1)}>
            <Icon name="back" size={18} /> Назад
          </button>
        )}
        {fromSummary && step < total - 1 && (
          <button type="button" className="btn big" onClick={() => go(total - 1)} disabled={!canContinue}>
            К сводке
          </button>
        )}
        {step < total - 1 ? (
          <button type="button" className="btn primary big grow" onClick={() => go(step + 1)} disabled={!canContinue}>
            Дальше <Icon name="chevron" size={18} />
          </button>
        ) : (
          <button type="button" className="btn primary big grow shine" onClick={() => void finish()}>
            <Icon name="sparkle" size={18} /> Составить меню
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({ answers, onEdit, removed }: { answers: Answers; onEdit: (step: number) => void; removed: string[] }) {
  const { catalog } = useApp();
  const names = (ids: string[], list: { id: string; name: string }[]) => ids.map((id) => list.find((x) => x.id === id)?.name ?? id).join(', ');
  const products = (ids: string[]) => ids.map((id) => catalog.products[id]?.name ?? id).join(', ');
  const time = (v: number | null) => (TIME_OPTIONS.find((t) => t.value === v)?.label ?? `до ${v} мин`).toLowerCase();
  const bans = [
    ...[...quickExclusionsActive(answers.restrictions)].map((id) => QUICK_EXCLUSIONS.find((q) => q.id === id)?.label ?? id),
    ...answers.restrictions.allergens.map((a) => catalog.reference.allergens.find((x) => x.id === a)?.name ?? a),
    ...answers.restrictions.products.map((p) => catalog.products[p]?.name ?? p),
  ];
  const rows: { step: number; label: string; value: string }[] = [
    { step: 0, label: 'Семья', value: [answers.adults > 0 ? `${answers.adults} ${plural(answers.adults, 'взрослый', 'взрослых', 'взрослых')}` : '', answers.children.length > 0 ? `дети: ${answers.children.map((c) => yearsLabel(c.age)).join(', ')}` : ''].filter(Boolean).join(', ') },
    {
      step: 1,
      label: 'Цель',
      value:
        answers.adults === 0
          ? 'Обычные порции (в семье только дети)'
          : (GOALS.find((g) => g.value === answers.goal)?.title ?? '') +
            // Without age, height and weight there is nothing to count from: say so before the menu is built.
            (answers.goal !== 'simple' && !estimateEnergy({ ...(answers.me as Partial<Member>), goal: answers.goal } as Member).available ? ' — без роста и веса порции пока обычные' : ''),
    },
    { step: 2, label: 'Питание', value: [answers.diet_types.length ? names(answers.diet_types, catalog.reference.diet_types ?? []) : 'Ем всё', DIET_MODES.find((d) => d.value === answers.diet_mode)?.title].join(' · ') },
    { step: 3, label: 'Нельзя', value: bans.length ? [...new Set(bans)].join(', ') : 'Ничего' },
    { step: 4, label: 'Любимые кухни', value: answers.cuisines.length ? names(answers.cuisines, catalog.reference.cuisines ?? []) : 'Любые' },
    { step: 4, label: 'Люблю / не люблю', value: answers.liked_products.length + answers.disliked_products.length === 0 ? 'Без пожеланий' : `${products(answers.liked_products) || '—'} / ${products(answers.disliked_products) || '—'}` },
    { step: 4, label: 'Острота', value: answers.adults === 0 ? 'Без остроты (дети)' : (SPICE.find((s) => s.value === answers.spice)?.title ?? '') },
    { step: 5, label: 'Готовка', value: `${SKILLS.find((s) => s.value === answers.skill)?.title}; ${answers.equipment.map((e) => EQUIPMENT.find((x) => x.id === e)?.label ?? e).join(', ') || 'без техники'}` },
    { step: 5, label: 'Время', value: `будни — ${time(answers.weekday_min)}; выходные — ${answers.weekend_min === 'same' ? 'как в будни' : time(answers.weekend_min)}` },
    { step: 6, label: 'Меню', value: `${answers.days} дн.; ${slotsInOrder(answers.slots).map((s) => SLOT_NAMES[s]?.toLowerCase()).join(', ')}; ${REPEATS.find((r) => r.value === answers.repeat)?.title.toLowerCase()}` },
    { step: 6, label: 'Бюджет', value: answers.budget_rub ? `${answers.budget_rub.toLocaleString('ru-RU')} ₽` : 'Без лимита' },
    { step: 6, label: 'Витамины', value: answers.vitamins ? 'Учитывать' : 'Не учитывать' },
  ];
  return (
    <div className="stack">
    {removed.length > 0 && (
      <div className="banner warn" role="status">
        <Icon name="warn" />
        <div className="grow">
          Из семьи будут удалены: <strong>{removed.join(', ')}</strong>. Если это не так, измените число взрослых или детей на первом шаге.
        </div>
      </div>
    )}
    <dl className="summary-list">
      {rows.map((r, i) => (
        <div key={i} className="summary-row" style={{ ['--i' as string]: i }}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
          <button type="button" className="btn small ghost" onClick={() => onEdit(r.step)} aria-label={`Изменить: ${r.label}`}>
            Изменить
          </button>
        </div>
      ))}
    </dl>
    </div>
  );
}

function yearsLabel(age: number): string {
  return `${age} ${plural(age, 'год', 'года', 'лет')}`;
}

const DRAFT_KEY = 'foodo:start-draft';

function readDraft(): Answers | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Answers) : null;
  } catch {
    // Storage may be unavailable (private mode): the questionnaire simply starts over.
    return null;
  }
}

function writeDraft(a: Answers): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(a));
  } catch {
    // Not critical: only the draft is lost on reload.
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
