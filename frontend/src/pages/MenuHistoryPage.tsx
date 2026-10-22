import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useLoad } from '../state/app';
import { Icon } from '../ui/icons';
import { Empty, ErrorBox, Loading, PageHead, Sheet } from '../ui/kit';
import { addDaysIso, dayMonth } from '../lib/dates';
import { plural } from '../lib/format';

export default function MenuHistoryPage() {
  const { gateway, currentMenuId, setCurrentMenuId, reportError, toast } = useApp();
  const navigate = useNavigate();
  const { data, loading, error, reload, setData } = useLoad(() => gateway.listMenus(), [gateway]);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const menus = data ?? [];
  const favorites = menus.filter((m) => m.is_favorite);
  const rest = menus.filter((m) => !m.is_favorite);
  const titleOf = (m: (typeof menus)[number]) => m.title || `${dayMonth(m.start_date)} — ${dayMonth(addDaysIso(m.start_date, m.days - 1))}`;
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await gateway.deleteMenu(id);
      setData(menus.filter((x) => x.id !== id));
      if (id === currentMenuId) setCurrentMenuId(null);
      setDeleting(null);
      toast('Меню удалено', { tone: 'success' });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const row = (m: (typeof menus)[number]) => (
    <div key={m.id} className="card row">
      <button
        className="grow"
        style={{ textAlign: 'left', border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => {
          setCurrentMenuId(m.id);
          navigate('/menu');
        }}
      >
        <strong>{titleOf(m)}</strong>
        <span className="muted small" style={{ display: 'block' }}>
          {m.days} {plural(m.days, 'день', 'дня', 'дней')} · изменено {new Date(m.updated_at).toLocaleDateString('ru-RU')}
          {m.id === currentMenuId ? ' · открыто сейчас' : ''}
        </span>
      </button>
      <button
        className={`icon-btn ${m.is_favorite ? 'active' : ''}`}
        aria-pressed={m.is_favorite}
        aria-label={m.is_favorite ? 'Убрать из избранных меню' : 'Сохранить в избранные меню'}
        onClick={async () => {
          try {
            await gateway.updateMenuMeta(m.id, { is_favorite: !m.is_favorite });
            setData(menus.map((x) => (x.id === m.id ? { ...x, is_favorite: !x.is_favorite } : x)));
          } catch (e) {
            reportError(e);
          }
        }}
      >
        <Icon name="star" fill={m.is_favorite ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-btn"
        aria-label={`Удалить меню: ${titleOf(m)}`}
        onClick={() => setDeleting({ id: m.id, title: titleOf(m) })}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
  return (
    <div className="stack">
      <PageHead eyebrow="Меню" title="История и избранные меню" />
      {menus.length === 0 ? (
        <Empty icon="calendar" title="Пока нет сохранённых меню" action={<Link className="btn primary" to="/menu">Составить меню</Link>} />
      ) : (
        <>
          {favorites.length > 0 && (
            <section className="stack">
              <h2>Избранные</h2>
              {favorites.map(row)}
            </section>
          )}
          {rest.length > 0 && (
            <section className="stack">
              <h2>{favorites.length > 0 ? 'Остальные' : 'Все меню'}</h2>
              {rest.map(row)}
            </section>
          )}
        </>
      )}
      {deleting && (
        <Sheet
          open
          onClose={() => setDeleting(null)}
          title="Удалить меню?"
          footer={
            <>
              <button className="btn danger" disabled={busy} onClick={() => void remove(deleting.id)}>
                Удалить
              </button>
              <button className="btn ghost" onClick={() => setDeleting(null)}>
                Отмена
              </button>
            </>
          }
        >
          <p>
            Меню «{deleting.title}» и его список покупок будут удалены без возможности восстановления. Продукты в остатках дома останутся.
          </p>
        </Sheet>
      )}
    </div>
  );
}
