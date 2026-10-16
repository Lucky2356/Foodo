import { useState } from 'react';
import type { Member } from '../engine';
import { useApp, useLoad } from '../state/app';
import { Icon } from '../ui/icons';
import { Empty, Loading, PageHead, Segmented } from '../ui/kit';
import { addDaysIso, localDate, weekdayShort } from '../lib/dates';
import { num } from '../lib/format';

function WaterCard({ member }: { member: Member }) {
  const { gateway, reportError, toast } = useApp();
  const water = useLoad(() => gateway.water(member.id, 7), [gateway, member.id]);
  const goal = member.water_goal_ml ?? 2000;
  const today = water.data?.today ?? localDate(member.timezone ?? 'Europe/Moscow');
  const total = water.data?.totals[today] ?? 0;
  const add = async (ml: number) => {
    try {
      await gateway.addWater(member.id, ml);
      water.reload();
      toast(`+${ml} мл`, {
        tone: 'success',
        undo: async () => {
          const fresh = await gateway.water(member.id, 1);
          const last = fresh.entries.find((e) => e.amount_ml === ml && e.local_date === fresh.today);
          if (last) await gateway.deleteWater(last.id);
          water.reload();
        },
      });
    } catch (e) {
      reportError(e);
    }
  };
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i - 6));
  const max = Math.max(goal, ...days.map((d) => water.data?.totals[d] ?? 0));
  return (
    <section className="card stack">
      <div className="row" style={{ ['--gap' as string]: '18px' }}>
        <div className="ring" style={{ ['--p' as string]: String(Math.min(100, Math.round((total / goal) * 100))) }}>
          <span>{num(total / 1000, 2)} л</span>
        </div>
        <div className="grow">
          <h3>Вода сегодня</h3>
          <p className="muted small">
            Цель {num(goal / 1000, 1)} л · день по часовому поясу {member.timezone}
          </p>
        </div>
      </div>
      <div className="row wrap">
        {[150, 250, 330, 500].map((ml) => (
          <button key={ml} className={`btn ${ml === 250 ? 'primary' : ''}`} onClick={() => void add(ml)}>
            <Icon name="drop" size={18} /> +{ml}
          </button>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'flex-end', height: 90, ['--gap' as string]: '8px' }} aria-label="Вода за неделю">
        {days.map((d) => {
          const v = water.data?.totals[d] ?? 0;
          return (
            <div key={d} className="grow" style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
              <div title={`${num(v)} мл`} style={{ width: '100%', maxWidth: 34, height: Math.max(4, (v / max) * 64), borderRadius: 8, background: v >= goal ? 'var(--primary)' : 'var(--surface-3)' }} />
              <span className="tiny muted">{weekdayShort(d)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function HabitsPage() {
  const { household, gateway, reportError } = useApp();
  const members = household?.members ?? [];
  const [who, setWho] = useState<string | null>(null);
  const habits = useLoad(() => gateway.habits(), [gateway]);
  const [name, setName] = useState('');
  if (!household) return <Loading />;
  if (members.length === 0) return <Empty icon="users" title="Сначала добавьте участников семьи" />;
  const member = members.find((m) => m.id === who) ?? (members[0] as Member);
  const today = localDate(member.timezone ?? 'Europe/Moscow');
  const days = Array.from({ length: 14 }, (_, i) => addDaysIso(today, i - 13));
  const mine = (habits.data ?? []).filter((h) => h.member_id === member.id);
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <PageHead eyebrow="Каждый день" title="Вода и привычки" />
      {members.length > 1 && <Segmented label="Участник" value={member.id} onChange={setWho} options={members.map((m) => ({ value: m.id, label: m.name }))} />}
      <WaterCard key={member.id} member={member} />
      <section className="card stack">
        <h3>Привычки</h3>
        {mine.length === 0 && <p className="muted small">Например: «Овощи к обеду», «Прогулка 30 минут».</p>}
        {mine.map((h) => {
          const done = h.marks.includes(today);
          return (
            <div key={h.id} className="stack" style={{ ['--gap' as string]: '6px' }}>
              <div className="row">
                <input
                  type="checkbox"
                  className="check"
                  checked={done}
                  aria-label={`Сегодня: ${h.name}`}
                  onChange={async () => {
                    try {
                      await gateway.markHabit(h.id, today, !done);
                      habits.reload();
                    } catch (e) {
                      reportError(e);
                    }
                  }}
                />
                <strong className="grow">{h.name}</strong>
                <button
                  className="icon-btn small"
                  aria-label={`Удалить привычку ${h.name}`}
                  onClick={async () => {
                    await gateway.deleteHabit(h.id).catch(reportError);
                    habits.reload();
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="row" style={{ ['--gap' as string]: '4px' }} aria-label="Две недели">
                {days.map((d) => (
                  <span key={d} title={d} style={{ width: 14, height: 14, borderRadius: 4, background: h.marks.includes(d) ? 'var(--primary)' : 'var(--surface-3)' }} />
                ))}
              </div>
            </div>
          );
        })}
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await gateway.addHabit(member.id, name);
              setName('');
              habits.reload();
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <input className="input grow" placeholder="Новая привычка" value={name} onChange={(e) => setName(e.target.value)} aria-label="Новая привычка" />
          <button className="btn primary" type="submit" disabled={!name.trim()} aria-label="Добавить привычку">
            <Icon name="plus" size={18} />
          </button>
        </form>
        <p className="muted tiny">Напоминания не включены по умолчанию и не обязательны для работы.</p>
      </section>
    </div>
  );
}
