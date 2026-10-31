import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/app';
import { useCurrentMenu } from '../state/menu';
import { Icon } from '../ui/icons';
import { Empty, ErrorBox, Loading, PageHead, RecipeCover } from '../ui/kit';
import { cookingPlan } from '../lib/cooking';
import type { CookDay, CookTask } from '../lib/cooking';
import { dayMonth, deviceTimeZone, humanDate, localDate } from '../lib/dates';
import { minutes, num, plural } from '../lib/format';
import { SLOT_NAMES } from '../lib/recipes';

function portionsLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${num(rounded, 1)} ${Number.isInteger(rounded) ? plural(rounded, 'порция', 'порции', 'порций') : 'порции'}`;
}

/** «Готовка»: what to cook on which day, for how many portions, and what goes to the fridge. */
export default function CookingPage() {
  const { household, gateway, reportError, toast } = useApp();
  const { record, loading, error, reload } = useCurrentMenu();
  const today = localDate(household?.city?.timezone ?? deviceTimeZone());
  const plan = useMemo(() => (record ? cookingPlan(record.menu, record.cooked_batches) : []), [record]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!record) {
    return (
      <Empty
        page
        icon="chef"
        title="Пока нечего готовить"
        action={
          <Link className="btn primary" to="/start">
            Составить меню
          </Link>
        }
      >
        Составьте меню — здесь появится план: что приготовить в какой день и на сколько порций.
      </Empty>
    );
  }

  const cook = async (task: CookTask) => {
    try {
      const r = await gateway.cook(record.id, task.batchId);
      toast(r.created ? `${task.recipe?.name ?? 'Блюдо'}: приготовлено, продукты списаны из остатков дома` : 'Это блюдо уже отмечено', { tone: 'success' });
      reload();
    } catch (e) {
      reportError(e);
    }
  };

  // Days before today with everything cooked fold away; anything left uncooked stays visible.
  const done = plan.filter((d) => d.date < today && d.tasks.every((t) => t.cooked));
  const open = plan.filter((d) => !done.includes(d));

  return (
    <div className="stack medium" style={{ ['--gap' as string]: '18px' }}>
      <PageHead eyebrow={`Меню с ${dayMonth(record.menu.start_date)}`} title="Готовка" subtitle="Что приготовить и когда. Отметьте «Приготовлено» — продукты спишутся из того, что есть дома." />
      {open.length === 0 && (
        <Empty icon="check" title="Всё приготовлено">
          По этому меню готовить больше нечего.
        </Empty>
      )}
      {/* Today and the next cooking day are open; later days fold into one line each. */}
      {open.map((day, i) => (
        <CookDaySection key={day.date} day={day} today={today} onCook={cook} folded={i >= 2} />
      ))}
      {done.length > 0 && (
        <details className="disclosure">
          <summary>
            Уже приготовлено: {done.length} {plural(done.length, 'день', 'дня', 'дней')}
          </summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {done.map((day) => (
              <CookDaySection key={day.date} day={day} today={today} onCook={cook} />
            ))}
          </div>
        </details>
      )}
      <p className="muted tiny">«Съесть до» — день, до которого блюдо запланировано в меню, а не срок годности: сроки хранения рецептов не проверены, ориентируйтесь на свои правила хранения.</p>
    </div>
  );
}

function CookDaySection({ day, today, onCook, folded = false }: { day: CookDay; today: string; onCook: (t: CookTask) => Promise<void>; folded?: boolean }) {
  const left = day.tasks.filter((t) => !t.cooked).length;
  const counts = (
    <span className="muted small">
      {left === 0 ? 'всё приготовлено' : `${left} ${plural(left, 'блюдо', 'блюда', 'блюд')}`}
      {left > 0 && day.activeMin !== null ? ` · активно ≈ ${minutes(day.activeMin)}` : ''}
    </span>
  );
  const tasks = day.tasks.map((t) => <CookTaskCard key={t.batchId} task={t} day={day} onCook={onCook} />);
  if (folded) {
    return (
      <details className="disclosure cook-day">
        <summary>
          <span className="cook-day-title">{humanDate(day.date, today)}</span> {counts}
        </summary>
        <div className="cook-tasks" style={{ marginTop: 12 }}>
          {tasks}
        </div>
      </details>
    );
  }
  return (
    <section className="stack" style={{ ['--gap' as string]: '10px' }} aria-labelledby={`cook-${day.date}`}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h2 id={`cook-${day.date}`} className="h3">
          {humanDate(day.date, today)}
        </h2>
        {counts}
      </div>
      <div className="cook-tasks">{tasks}</div>
    </section>
  );
}

function CookTaskCard({ task: t, day, onCook }: { task: CookTask; day: CookDay; onCook: (t: CookTask) => Promise<void> }) {
  const sameDay = t.meals.filter((m) => m.date === day.date).map((m) => (SLOT_NAMES[m.slot] ?? m.slot).toLowerCase());
  const later = t.meals.filter((m) => m.date !== day.date).map((m) => `${(SLOT_NAMES[m.slot] ?? m.slot).toLowerCase()} ${dayMonth(m.date)}`);
  return (
    <article className={`card cook-task${t.cooked ? ' done' : ''}`}>
      <div className="cook-thumb" aria-hidden="true">
        {t.recipe && <RecipeCover recipe={t.recipe} />}
      </div>
      <div className="stack grow" style={{ ['--gap' as string]: '6px' }}>
        <h3 className="cook-name">{t.recipe?.name ?? 'Рецепт недоступен'}</h3>
        <p className="muted small">
          {t.totalMin !== null ? `${minutes(t.totalMin)}${t.activeMin !== null ? ` · активно ${minutes(t.activeMin)}` : ''} · ` : ''}
          {portionsLabel(t.portions)}
          {t.methodName ? ` · ${t.methodName.toLowerCase()}` : ''}
        </p>
        <p className="small">
          <span className="muted">Едим: </span>
          {[sameDay.length ? `на ${sameDay.join(' и ')}` : null, ...later].filter(Boolean).join(', ')}
        </p>
        {t.leftoverPortions > 0 && (
          <p className="small">
            <span className="badge blue">
              <Icon name="box" size={13} /> В холодильник {portionsLabel(t.leftoverPortions)} · съесть до {dayMonth(t.lastMealDate)}
            </span>
          </p>
        )}
        <div className="row wrap" style={{ marginTop: 4 }}>
          {t.recipe && (
            <Link className="btn small ghost" to={`/recipes/${t.recipeId}`}>
              <Icon name="book" size={16} /> Как готовить
            </Link>
          )}
          {t.cooked ? (
            <span className="badge green">
              <Icon name="check" size={13} /> Приготовлено
            </span>
          ) : (
            <button className="btn small primary" onClick={() => void onCook(t)}>
              <Icon name="check" size={16} /> Приготовлено
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
