import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Member, MemberReport, Recipe } from '../engine';
import { useApp, useLoad } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { Banner, Loading, RecipeCover } from '../ui/kit';
import { Illustration } from '../ui/illustrations';
import { APP_NAME, STATIC_BUILD } from '../lib/config';
import { addDaysIso, dayMonth, deviceTimeZone, humanDate, localDate } from '../lib/dates';
import { kcal, num, plural } from '../lib/format';
import { SLOT_NAMES } from '../lib/recipes';
import { cookingPlan } from '../lib/cooking';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'calendar', title: 'Меню на 1–35 дней', text: 'Завтрак, обед, перекус и ужин под вашу семью. Любое блюдо меняется одним нажатием.' },
  { icon: 'users', title: 'Порции для каждого', text: 'Одно блюдо — разные порции. КБЖУ считается по своей порции, а не по средней.' },
  { icon: 'shield', title: 'Запреты соблюдаются', text: 'Аллергены и исключённые продукты проверяются по составу, а не по названию блюда.' },
  { icon: 'cart', title: 'Список покупок сам', text: 'Собирается из меню по отделам магазина и вычитает то, что уже есть дома.' },
  { icon: 'store', title: 'Ваш город и магазин', text: 'Город определяется на устройстве, сети подбираются по региону, бюджет проверяется честно.' },
  { icon: 'leaf', title: 'Витамины и ПП', text: 'Режим ПП и учёт витаминов влияют на подбор, а неполные данные помечены.' },
];

/** A few dishes with real photos from each main category, in a stable order. */
function showcase(recipes: Recipe[], perCategory: number): Recipe[] {
  const out: Recipe[] = [];
  for (const category of ['main', 'soup', 'salad', 'breakfast', 'dessert', 'baking']) {
    out.push(...recipes.filter((r) => r.category === category && r.image?.url && r.visibility !== 'private').slice(0, perCategory));
  }
  return out;
}

function Landing() {
  const { catalog } = useApp();
  const dishes = showcase(Object.values(catalog.recipes), 2).slice(0, 8);
  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      <section className="landing-hero fade-in">
        <div className="landing-art" aria-hidden="true">
          <Illustration name="cooking" />
        </div>
        <span className="badge green" style={{ marginBottom: 16 }}>
          <Icon name="sparkle" size={14} /> Бесплатно, без регистрации
        </span>
        <h1>Что готовить, сколько и что купить</h1>
        <p className="lead">
          {APP_NAME} составит меню на неделю для всей семьи, посчитает порции и КБЖУ и соберёт список покупок с учётом того, что есть дома.
        </p>
        <div className="row wrap hero-actions" style={{ marginTop: 26 }}>
          <Link to="/start" className="btn primary big">
            Составить меню бесплатно
            <Icon name="chevron" size={18} />
          </Link>
          <Link to="/recipes" className="btn ghost big">
            Смотреть рецепты
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          Короткая анкета: семья, цель, запреты и вкусы — и меню готово. Данные остаются на этом устройстве{STATIC_BUILD ? '' : ', аккаунт — по желанию'}.
        </p>
      </section>
      {dishes.length > 0 && (
        <section className="stack" style={{ ['--gap' as string]: '12px' }} aria-label="Блюда из каталога">
          <div className="row between">
            <h2>Из каталога</h2>
            <Link to="/recipes" className="btn small ghost">
              Все рецепты <Icon name="chevron" size={16} />
            </Link>
          </div>
          <div className="dish-strip">
            {dishes.map((r) => (
              <Link key={r.id} to={`/recipes/${r.id}`} className="dish-tile">
                <RecipeCover recipe={r} />
                <span>{r.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="grid features-grid" aria-label="Возможности">
        {FEATURES.map((f) => (
          <div key={f.title} className="card feature fade-in">
            <div className="ficon">
              <Icon name={f.icon} />
            </div>
            <h3>{f.title}</h3>
            <p className="muted small">{f.text}</p>
          </div>
        ))}
      </section>
      <section className="card soft">
        <h2 style={{ marginBottom: 10 }}>Честно о данных</h2>
        <p className="muted">
          Пищевая ценность большинства продуктов — из открытых государственных баз (USDA и шведской Livsmedelsverket), остальное — оценки, они помечены в карточках. Если данных нет, мы пишем «нет данных», а не ноль. {APP_NAME} не
          обещает похудения или экономии и не заменяет врача.
        </p>
      </section>
    </div>
  );
}

function memberToday(report: MemberReport[] | null, memberId: string, date: string) {
  return report?.find((r) => r.member_id === memberId)?.days.find((d) => d.date === date) ?? null;
}

function WaterQuick({ member }: { member: Member }) {
  const { gateway, reportError, toast } = useApp();
  const water = useLoad(() => gateway.water(member.id, 1), [gateway, member.id]);
  const total = water.data ? (water.data.totals[water.data.today] ?? 0) : 0;
  const goal = member.water_goal_ml ?? 2000;
  const add = async (ml: number) => {
    try {
      await gateway.addWater(member.id, ml);
      water.reload();
      toast(`+${ml} мл воды`, { tone: 'success' });
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <div className="card span-2 water-quick">
      <div className="row between">
        <h3>Вода</h3>
        <Link to="/habits" className="small">
          Подробнее
        </Link>
      </div>
      <div className="water-quick-body">
        <div className="ring big" style={{ ['--p' as string]: String(Math.min(100, Math.round((total / goal) * 100))) }}>
          <span>{num(total / 1000, 2)} л</span>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '8px', minWidth: 0 }}>
          <span className="muted small">
            {member.name}: цель {num(goal / 1000, 1)} л
          </span>
          <div className="row wrap">
            <button className="btn small primary" onClick={() => void add(250)} aria-label="Добавить 250 мл воды">
              +250 мл
            </button>
            <button className="btn small" onClick={() => void add(500)} aria-label="Добавить 500 мл воды">
              +500 мл
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const { household, catalog, gateway } = useApp();
  const navigate = useNavigate();
  const { record, loading } = useCurrentMenu();
  const today = localDate(household?.city?.timezone ?? deviceTimeZone());
  const [report, setReport] = useState<MemberReport[] | null>(null);
  useEffect(() => {
    if (record) gateway.getReport(record.id).then(setReport).catch(() => setReport(null));
  }, [record, gateway]);
  if (!household) return <Loading />;
  const members = household.members;
  const first = members[0] as Member;
  const menu = record?.menu;
  const inRange = menu ? menu.meals.some((m) => m.date === today) : false;
  const date = inRange ? today : (menu?.start_date ?? today);
  const meals = menu ? menu.meals.filter((m) => m.date === date) : [];
  const batches = new Map(menu?.batches.map((b) => [b.id, b]) ?? []);
  const recipeOf = (batchId: string) => {
    const b = batches.get(batchId);
    return b ? (menu?.snapshot.recipes[b.recipe_id] ?? catalog.recipes[b.recipe_id]) : undefined;
  };
  const day = memberToday(report, first.id, date);
  const cookToday = record ? (cookingPlan(record.menu, record.cooked_batches).find((d) => d.date === today)?.tasks.filter((t) => !t.cooked).length ?? 0) : 0;
  // «Скоро в меню» shows the whole next day of the menu, one card per meal.
  const nextDate = menu?.meals.find((m) => m.date > date)?.date ?? null;
  const ended = menu ? addDaysIso(menu.start_date, menu.days - 1) < today : false;
  // A family of children only (or «Я» from the questionnaire) is not greeted by a child's name.
  const greetName = members.length === 1 && first.name !== 'Я' && !(first.age !== null && first.age !== undefined && first.age < 18) ? first.name : null;
  return (
    <div className="stack" style={{ ['--gap' as string]: '18px' }}>
      <header className="page-head fade-in">
        <div>
          <div className="eyebrow">{humanDate(date, today)}</div>
          <h1>Привет{greetName ? `, ${greetName}` : ''}!</h1>
        </div>
        <button className="btn primary" onClick={() => navigate('/menu')}>
          <Icon name="calendar" size={18} /> Открыть меню
        </button>
      </header>
      {ended && menu && (
        <Banner icon="calendar">
          <div className="grow">
            Меню с {dayMonth(menu.start_date)} уже закончилось. Составьте новое — повторы прошлых блюд учтутся.
          </div>
          <Link className="btn small" to="/menu?new=1">
            Новое меню
          </Link>
        </Banner>
      )}
      <div className="bento">
        <div className="card hero span-4">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="muted small">{menu ? (inRange ? 'Сегодня в меню' : ended ? 'Первый день прошлого меню' : 'Первый день меню') : 'Меню ещё нет'}</div>
              <h2 style={{ marginTop: 6 }}>{menu ? dishCount(meals.reduce((s, m) => s + m.items.length, 0)) : 'Составим за пару секунд'}</h2>
            </div>
            {day && (
              <div style={{ textAlign: 'right' }}>
                <div className="muted small">{first.name}</div>
                <div style={{ fontSize: 26, fontWeight: 750 }}>{kcal(day.totals.kcal.value)}</div>
              </div>
            )}
          </div>
          {loading ? null : menu ? (
            <div className="stack" style={{ marginTop: 16, ['--gap' as string]: '10px' }}>
              {meals.map((meal) => {
                const r = meal.items[0] ? recipeOf(meal.items[0].batch_id) : undefined;
                return (
                  <Link key={meal.slot} to={r ? `/recipes/${r.id}` : '/menu'} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="badge" style={{ background: 'color-mix(in srgb, var(--hero-ink) 14%, transparent)', color: 'var(--hero-ink)', minWidth: 78, justifyContent: 'center' }}>
                      {SLOT_NAMES[meal.slot]}
                    </span>
                    <span className="grow" style={{ fontWeight: 600 }}>
                      {r ? r.name : 'нет подходящего блюда'}
                      {meal.items.length > 1 ? ` и ещё ${meal.items.length - 1}` : ''}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Link to="/start" className="btn big" style={{ marginTop: 18, ['--btn-bg' as string]: 'var(--hero-ink)', ['--btn-ink' as string]: 'var(--hero-btn-ink)' }}>
              Составить меню
            </Link>
          )}
        </div>
        <WaterQuick member={first} />
        <Link to="/shopping" className="card card-link span-2">
          <div className="feature" style={{ padding: 0 }}>
            <div className="ficon">
              <Icon name="cart" />
            </div>
            <h3>Покупки</h3>
            <p className="muted small">Список по отделам с учётом остатков дома</p>
          </div>
        </Link>
        <Link to="/pantry" className="card card-link span-2">
          <div className="feature" style={{ padding: 0 }}>
            <div className="ficon">
              <Icon name="box" />
            </div>
            <h3>Дома</h3>
            <p className="muted small">Что уже есть и когда истекает срок</p>
          </div>
        </Link>
        <Link to="/cooking" className="card card-link span-2">
          <div className="feature" style={{ padding: 0 }}>
            <div className="ficon">
              <Icon name="chef" />
            </div>
            <h3>Готовка</h3>
            <p className="muted small">{cookToday > 0 ? `Сегодня приготовить: ${cookToday} ${plural(cookToday, 'блюдо', 'блюда', 'блюд')}` : 'Что и когда готовить по меню'}</p>
          </div>
        </Link>
      </div>
      {menu && nextDate && (
        <section className="section">
          <div className="section-title">
            <h2>Скоро в меню</h2>
            <Link to="/menu">Вся неделя</Link>
          </div>
          <div className="grid fill-row" style={{ ['--n' as string]: String(menu.meals.filter((m) => m.date === nextDate).length) }}>
            {menu.meals
              .filter((m) => m.date === nextDate)
              .map((meal) => {
                const r = meal.items[0] ? recipeOf(meal.items[0].batch_id) : undefined;
                if (!r) return null;
                return (
                  <Link key={`${meal.date}-${meal.slot}`} to={`/recipes/${r.id}`} className="card card-link recipe-card">
                    <div className="cover">
                      <RecipeCover recipe={r} />
                    </div>
                    <div className="body">
                      <span className="muted small">
                        {humanDate(meal.date, today)} · {SLOT_NAMES[meal.slot]}
                      </span>
                      <h3>{r.name}</h3>
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  const { household } = useApp();
  if (!household) return <Loading />;
  if (household.members.length === 0) return <Landing />;
  return <Dashboard />;
}

function dishCount(n: number): string {
  return n === 0 ? 'Блюд нет' : `${n} ${plural(n, 'блюдо', 'блюда', 'блюд')}`;
}
