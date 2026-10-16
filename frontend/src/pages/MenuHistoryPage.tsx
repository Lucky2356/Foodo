import { Link, useNavigate } from 'react-router-dom';
import { useApp, useLoad } from '../state/app';
import { Icon } from '../ui/icons';
import { Empty, ErrorBox, Loading, PageHead } from '../ui/kit';
import { addDaysIso, dayMonth } from '../lib/dates';

export default function MenuHistoryPage() {
  const { gateway, currentMenuId, setCurrentMenuId, reportError, toast } = useApp();
  const navigate = useNavigate();
  const { data, loading, error, reload, setData } = useLoad(() => gateway.listMenus(), [gateway]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const menus = data ?? [];
  const favorites = menus.filter((m) => m.is_favorite);
  const rest = menus.filter((m) => !m.is_favorite);
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
        <strong>{m.title || `${dayMonth(m.start_date)} — ${dayMonth(addDaysIso(m.start_date, m.days - 1))}`}</strong>
        <span className="muted small" style={{ display: 'block' }}>
          {m.days} дн. · изменено {new Date(m.updated_at).toLocaleDateString('ru-RU')}
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
        aria-label="Удалить меню"
        onClick={async () => {
          try {
            await gateway.deleteMenu(m.id);
            setData(menus.filter((x) => x.id !== m.id));
            if (m.id === currentMenuId) setCurrentMenuId(null);
            toast('Меню удалено', { tone: 'success' });
          } catch (e) {
            reportError(e);
          }
        }}
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
          <section className="stack">
            <h2>Все меню</h2>
            {rest.map(row)}
          </section>
        </>
      )}
    </div>
  );
}
