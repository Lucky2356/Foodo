import { useEffect } from 'react';
import { Switch } from '../ui/kit';
import { checkNow, loadInfo, setAutoCheck, useUpdateState } from './updateStore';

/** «Обновления приложения» in Settings (Android build only). */
export default function AppUpdatesSection() {
  const { info, phase, autoCheck, lastCheckedAt } = useUpdateState();
  useEffect(() => {
    void loadInfo();
  }, []);

  let status: string | null = null;
  if (phase.kind === 'checking' && phase.manual) status = 'Проверяем…';
  else if (phase.kind === 'none') status = phase.message;
  else if (phase.kind === 'error') status = phase.message;
  else if (phase.kind === 'available' || phase.kind === 'downloading' || phase.kind === 'installing' || phase.kind === 'needsPermission')
    status = `Доступна версия ${phase.version} — см. сообщение вверху экрана.`;

  return (
    <section className="card stack" id="app-updates">
      <h2>Обновления приложения</h2>
      <p className="muted small">
        {info ? `Установлена версия ${info.versionName}. ` : ''}
        Новые версии публикуются в GitHub Releases. Приложение спрашивает GitHub о последней версии без входа: GitHub видит только обычные данные запроса (IP-адрес и версию приложения), меню и профили не отправляются. Скачанный файл APK проверяется (контрольная сумма, подпись, версия) и только потом предлагается к установке.
      </p>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={() => void checkNow(true)} disabled={phase.kind === 'checking' || phase.kind === 'downloading' || phase.kind === 'installing'}>
          Проверить сейчас
        </button>
        {lastCheckedAt !== null && (
          <span className="muted small">Последняя проверка: {new Date(lastCheckedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
      <p className={phase.kind === 'error' ? 'small' : 'muted small'} role="status" style={phase.kind === 'error' ? { color: 'var(--danger)' } : undefined}>
        {status}
      </p>
      <Switch checked={autoCheck} onChange={setAutoCheck} label="Проверять автоматически" hint="При запуске и каждые 6 часов, пока приложение открыто." />
    </section>
  );
}
