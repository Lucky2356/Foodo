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
      <h2 className="h3">{info ? `Установлена версия ${info.versionName}` : 'Версия приложения'}</h2>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        <button className="btn primary" onClick={() => void checkNow(true)} disabled={phase.kind === 'checking' || phase.kind === 'downloading' || phase.kind === 'installing'}>
          Проверить обновления
        </button>
        {lastCheckedAt !== null && (
          <span className="muted small">Проверено в {new Date(lastCheckedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
      <p className={phase.kind === 'error' ? 'small' : 'muted small'} role="status" style={phase.kind === 'error' ? { color: 'var(--danger)' } : undefined}>
        {status}
      </p>
      <Switch checked={autoCheck} onChange={setAutoCheck} label="Проверять самостоятельно" hint="При запуске приложения и раз в 6 часов, пока оно открыто. Когда выйдет новая версия, вверху экрана появится предложение обновиться." />
      <details className="disclosure">
        <summary>Как это работает</summary>
        <p className="muted small">
          Новые версии публикуются на GitHub. Приложение спрашивает у GitHub номер последней версии без входа: GitHub видит только обычные данные запроса (IP-адрес и версию приложения), меню и профили не отправляются. Скачанный файл проверяется — контрольная сумма, подпись и номер версии — и только потом Android предлагает его установить.
        </p>
      </details>
    </section>
  );
}
