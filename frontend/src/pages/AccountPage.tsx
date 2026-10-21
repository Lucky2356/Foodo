import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../data/api';
import { downloadJson, exportGuestData } from '../data/backup';
import type { GuestExport } from '../data/backup';
import { account } from '../data/remoteGateway';
import { useApp } from '../state/app';
import { NATIVE_BUILD, STATIC_BUILD } from '../lib/config';
import { Icon } from '../ui/icons';
import { Banner, Field, PageHead, Segmented } from '../ui/kit';

type Mode = 'login' | 'register' | 'reset';

function ResetConfirm({ uid, token }: { uid: string; token: string }) {
  const { reportError, toast } = useApp();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  return (
    <form
      className="card stack"
      style={{ maxWidth: 480 }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await account.confirmReset(uid, token, password);
          toast('Пароль изменён. Войдите с новым паролем.', { tone: 'success' });
          navigate('/account');
        } catch (err) {
          reportError(err);
        }
      }}
    >
      <h2>Новый пароль</h2>
      <Field label="Пароль" hint="Не короче 8 символов">
        <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </Field>
      <button className="btn primary" type="submit">
        Сохранить пароль
      </button>
    </form>
  );
}

function AuthForms() {
  const { login, toast } = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reset') {
        const r = await account.requestReset(email);
        toast(r.message, { tone: 'success' });
        setMode('login');
      } else {
        const user = mode === 'login' ? await account.login(email, password) : await account.register(email, password, name);
        await login(user);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выполнить запрос.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="card stack"
      style={{ maxWidth: 480 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Segmented<Mode> label="Действие" value={mode} onChange={setMode} options={[{ value: 'login', label: 'Вход' }, { value: 'register', label: 'Регистрация' }, { value: 'reset', label: 'Забыли пароль' }]} />
      {mode === 'register' && (
        <Field label="Имя (необязательно)">
          <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
      )}
      <Field label="Почта">
        <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      {mode !== 'reset' && (
        <Field label="Пароль" hint={mode === 'register' ? 'Не короче 8 символов, не только цифры' : undefined}>
          <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} />
        </Field>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary big" type="submit" disabled={busy}>
        {busy && <span className="spinner" />}
        {mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Отправить ссылку'}
      </button>
      <p className="muted tiny">Гостевые данные на этом устройстве не отправляются при входе. Перенести их в аккаунт можно отдельной кнопкой после входа.</p>
    </form>
  );
}

interface Preview {
  members: { guest_id: string; name: string; conflict: { existing_id: string; existing_name: string } | null; default: string }[];
  menus: { guest_id: string; start_date: string; days: number; conflict: { existing_id: string } | null; default: string }[];
  counts: Record<string, number>;
}

function GuestTransfer() {
  const { user, reportError, toast, refreshHousehold, bump } = useApp();
  const [guest, setGuest] = useState<GuestExport | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resolution, setResolution] = useState<{ members: Record<string, string>; menus: Record<string, string> }>({ members: {}, menus: {} });
  const [busy, setBusy] = useState(false);
  const householdId = user?.households[0]?.id;
  useEffect(() => {
    void exportGuestData().then((d) => setGuest(d.members.length + d.menus.length + d.pantry.length > 0 ? d : null));
  }, []);
  if (!guest || !householdId) return null;
  const doPreview = async () => {
    setBusy(true);
    try {
      const p = (await account.importGuest(householdId, guest, 'preview')) as Preview;
      setPreview(p);
      setResolution({ members: Object.fromEntries(p.members.map((m) => [m.guest_id, m.default])), menus: Object.fromEntries(p.menus.map((m) => [m.guest_id, m.default])) });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      await account.importGuest(householdId, guest, 'apply', resolution);
      toast('Данные перенесены в аккаунт. На устройстве они тоже остались.', { tone: 'success' });
      setGuest(null);
      setPreview(null);
      await refreshHousehold();
      bump();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card stack">
      <h2>Перенести гостевые данные</h2>
      <p className="muted small">
        На этом устройстве есть данные гостевого режима: участников {guest.members.length}, меню {guest.menus.length}, остатков {guest.pantry.length}. Они передаются на сервер только после вашего подтверждения.
      </p>
      {!preview ? (
        <button className="btn" onClick={() => void doPreview()} disabled={busy}>
          Посмотреть, что добавится
        </button>
      ) : (
        <div className="stack">
          {preview.members.map((m) => (
            <div key={m.guest_id} className="row wrap between">
              <span>
                <strong>{m.name}</strong>
                {m.conflict && <span className="muted small"> — в аккаунте уже есть «{m.conflict.existing_name}»</span>}
              </span>
              {m.conflict ? (
                <Segmented
                  label={`Участник ${m.name}`}
                  value={resolution.members[m.guest_id] ?? 'add'}
                  onChange={(v) => setResolution((r) => ({ ...r, members: { ...r.members, [m.guest_id]: v } }))}
                  options={[
                    { value: `merge:${m.conflict.existing_id}`, label: 'Это тот же человек' },
                    { value: 'add', label: 'Добавить отдельно' },
                  ]}
                />
              ) : (
                <span className="badge green">добавится</span>
              )}
            </div>
          ))}
          {preview.menus.map((m) => (
            <div key={m.guest_id} className="row wrap between">
              <span>
                Меню с {m.start_date} на {m.days} дн.{m.conflict && <span className="muted small"> — в аккаунте уже есть меню с этой даты</span>}
              </span>
              <Segmented
                label={`Меню с ${m.start_date}`}
                value={resolution.menus[m.guest_id] ?? 'add'}
                onChange={(v) => setResolution((r) => ({ ...r, menus: { ...r.menus, [m.guest_id]: v } }))}
                options={[
                  { value: 'add', label: 'Перенести' },
                  { value: 'skip', label: 'Пропустить' },
                ]}
              />
            </div>
          ))}
          <p className="muted small">
            Также: остатки {preview.counts.pantry ?? 0}, цены {preview.counts.prices ?? 0}, избранное {preview.counts.favorites ?? 0}, свои рецепты {preview.counts.custom_recipes ?? 0}, записи воды {preview.counts.water ?? 0}, привычки {preview.counts.habits ?? 0}.
          </p>
          <button className="btn primary" onClick={() => void apply()} disabled={busy}>
            Перенести
          </button>
        </div>
      )}
    </section>
  );
}

function AccountSettings() {
  const { user, logout, reportError, toast, household } = useApp();
  const navigate = useNavigate();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [acceptCode, setAcceptCode] = useState('');
  const [deletePw, setDeletePw] = useState('');
  const [deleteWord, setDeleteWord] = useState('');
  if (!user) return null;
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px', maxWidth: 760 }}>
      <section className="card row wrap between">
        <div>
          <strong>{user.email}</strong>
          <p className="muted small">Данные хранятся на сервере и доступны с любых устройств. Без сети их можно читать, но не изменять.</p>
        </div>
        <button
          className="btn ghost"
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          <Icon name="logout" size={18} /> Выйти
        </button>
      </section>
      <GuestTransfer />
      {household?.role === 'owner' && (
        <section className="card stack">
          <h2>Пригласить в семью</h2>
          <p className="muted small">Код действует 7 дней и только для указанной почты. Передайте его лично.</p>
          <div className="row wrap">
            <input className="input grow" type="email" placeholder="почта участника" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} aria-label="Почта участника" />
            <Segmented label="Права" value={inviteRole} onChange={setInviteRole} options={[{ value: 'editor', label: 'Может изменять' }, { value: 'viewer', label: 'Только просмотр' }]} />
            <button
              className="btn"
              onClick={async () => {
                try {
                  setInviteCode((await account.invite(user.households[0]?.id ?? '', inviteEmail, inviteRole)).token);
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              Создать код
            </button>
          </div>
          {inviteCode && (
            <Banner tone="ok" icon="copy">
              Код приглашения: <strong style={{ userSelect: 'all' }}>{inviteCode}</strong>
            </Banner>
          )}
        </section>
      )}
      <section className="card stack">
        <h2>Принять приглашение</h2>
        <div className="row">
          <input className="input grow" value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)} placeholder="Код приглашения" aria-label="Код приглашения" />
          <button
            className="btn"
            onClick={async () => {
              try {
                await account.acceptInvitation(acceptCode.trim());
                toast('Вы присоединились к семье. Обновите страницу, чтобы переключиться.', { tone: 'success' });
              } catch (e) {
                reportError(e);
              }
            }}
          >
            Принять
          </button>
        </div>
      </section>
      <section className="card stack">
        <h2>Пароль</h2>
        <div className="row wrap">
          <input className="input grow" type="password" autoComplete="current-password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} aria-label="Текущий пароль" />
          <input className="input grow" type="password" autoComplete="new-password" placeholder="Новый пароль" value={newPw} onChange={(e) => setNewPw(e.target.value)} aria-label="Новый пароль" />
          <button
            className="btn"
            onClick={async () => {
              try {
                await account.changePassword(oldPw, newPw);
                setOldPw('');
                setNewPw('');
                toast('Пароль изменён', { tone: 'success' });
              } catch (e) {
                reportError(e);
              }
            }}
          >
            Изменить
          </button>
        </div>
      </section>
      <section className="card stack">
        <h2>Мои данные</h2>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            try {
              await downloadJson('foodo-account-export.json', await account.exportData());
            } catch (e) {
              reportError(e);
            }
          }}
        >
          <Icon name="download" size={18} /> Выгрузить все данные (JSON)
        </button>
      </section>
      <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
        <h2>Удалить аккаунт</h2>
        <p className="muted small">Будут удалены аккаунт, ваши семьи (где вы владелец), меню, остатки, цены и записи. Это нельзя отменить. Гостевые данные на этом устройстве останутся.</p>
        <div className="row wrap">
          <input className="input grow" placeholder="Введите УДАЛИТЬ" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} aria-label="Подтверждение удаления" />
          <input className="input grow" type="password" placeholder="Пароль" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} aria-label="Пароль" />
          <button
            className="btn danger"
            disabled={deleteWord !== 'УДАЛИТЬ' || !deletePw}
            onClick={async () => {
              try {
                await account.deleteAccount(deletePw, deleteWord);
                await logout().catch(() => undefined);
                toast('Аккаунт удалён', { tone: 'success' });
                navigate('/');
              } catch (e) {
                reportError(e);
              }
            }}
          >
            Удалить навсегда
          </button>
        </div>
      </section>
    </div>
  );
}

export default function AccountPage() {
  const { server, user } = useApp();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const uid = params.get('uid');
  const token = params.get('token');
  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <PageHead eyebrow="Аккаунт" title={user ? 'Аккаунт и безопасность' : 'Вход и синхронизация'} subtitle={user ? undefined : 'Аккаунт не обязателен: всё работает и без него. Он нужен, чтобы видеть меню на нескольких устройствах и вести его вместе с семьёй.'} />
      {!server ? (
        <Banner icon="info">
          {NATIVE_BUILD ? 'Приложение работает в гостевом режиме: аккаунты — на полной версии сайта с сервером.' : STATIC_BUILD ? 'Это гостевая версия сайта: аккаунты работают на полной версии с сервером.' : 'Сервер недоступен — сейчас можно пользоваться гостевым режимом.'} Данные хранятся {NATIVE_BUILD ? 'на этом телефоне' : 'в этом браузере'} — сохраните{' '}
          <Link to="/profile">резервную копию</Link>, чтобы не потерять их.
        </Banner>
      ) : uid && token ? (
        <ResetConfirm uid={uid} token={token} />
      ) : user ? (
        <AccountSettings />
      ) : (
        <AuthForms />
      )}
    </div>
  );
}
