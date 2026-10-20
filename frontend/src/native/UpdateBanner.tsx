import { useEffect } from 'react';
import { Icon } from '../ui/icons';
import { allowInstalls, dismiss, startUpdate, startUpdateService, useUpdateState } from './updateStore';
import { formatSize, INSTALL_PERMISSION_HELP, percent } from './updateLogic';

/**
 * Non-blocking banner about a new Android app version (Android build only). Also starts the
 * quiet background checks. Uses the same banner markup as the PWA update notice in App.tsx.
 */
export default function UpdateBanner() {
  const { phase, dismissedVersion } = useUpdateState();
  useEffect(() => startUpdateService(), []);

  if (phase.kind === 'idle' || phase.kind === 'checking' || phase.kind === 'none') return null;
  if (phase.kind === 'error' && phase.origin !== 'update') return null;
  if ('version' in phase && phase.version !== null && phase.version === dismissedVersion) return null;

  const later = (
    <button className="btn small ghost" onClick={dismiss}>
      Позже
    </button>
  );
  let tone = 'ok';
  let body;
  let actions = null;
  switch (phase.kind) {
    case 'available':
      body = (
        <>
          <strong>Доступна версия {phase.version}</strong>
          {phase.size > 0 && <span className="small"> · {formatSize(phase.size)}</span>}
          <div className="small">Данные на телефоне сохранятся. Файл скачивается из GitHub Releases и проверяется перед установкой.</div>
        </>
      );
      actions = (
        <>
          <button className="btn small primary" onClick={() => void startUpdate()}>
            Обновить
          </button>
          {later}
        </>
      );
      break;
    case 'downloading': {
      const value = percent(phase.downloaded, phase.total);
      body = (
        <>
          <strong>Скачиваем версию {phase.version}… {value}%</strong>
          <div className="progress" role="progressbar" aria-label="Загрузка обновления" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} style={{ marginTop: 8 }}>
            <span style={{ width: `${value}%` }} />
          </div>
        </>
      );
      break;
    }
    case 'installing':
      body = <strong>Файл проверен. Подтвердите установку версии {phase.version} в окне Android.</strong>;
      break;
    case 'needsPermission':
      tone = 'warn';
      body = (
        <>
          <strong>Нужно разрешение на установку</strong>
          <div className="small">{INSTALL_PERMISSION_HELP}</div>
        </>
      );
      actions = (
        <>
          <button className="btn small primary" onClick={() => void allowInstalls()}>
            Открыть настройки
          </button>
          <button className="btn small" onClick={() => void startUpdate()}>
            Установить
          </button>
          {later}
        </>
      );
      break;
    case 'error':
      tone = 'error';
      body = <span>{phase.message}</span>;
      actions = (
        <>
          {phase.retry && phase.version && (
            <button className="btn small" onClick={() => void startUpdate()}>
              Повторить
            </button>
          )}
          <button className="btn small ghost" onClick={dismiss}>
            Закрыть
          </button>
        </>
      );
      break;
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className={`banner ${tone}`} role="status">
        <Icon name={tone === 'error' ? 'warn' : 'download'} />
        <div className="grow stack" style={{ ['--gap' as string]: '8px' }}>
          <div>{body}</div>
          {actions && <div className="row wrap">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
