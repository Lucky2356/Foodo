/**
 * Pure helpers of the Android in-app updater: error texts, the auto-check preference and the
 * schedule. No Capacitor imports, so they are unit-tested in Node (updateLogic.test.ts).
 * The rules about which release is accepted live in Java (UpdatePolicy) next to the installer.
 */

/** Error codes of the native FoodoUpdater plugin (UpdateException.Code in Java). */
export type UpdaterErrorCode =
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'HTTP'
  | 'BAD_RESPONSE'
  | 'NO_UPDATE'
  | 'VERIFY_FAILED'
  | 'INSTALL_PERMISSION'
  | 'INSTALL_FAILED'
  | 'BUSY'
  | 'INTERNAL';

/** Why check() offered nothing (UpdatePolicy.Status in Java, plus "no_release"). */
export type NoUpdateReason = 'up_to_date' | 'no_release' | 'not_a_release' | 'invalid_release';

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const AUTO_CHECK_KEY = 'foodo:app-update:auto-check';

const ERROR_TEXT: Record<UpdaterErrorCode, string> = {
  NETWORK: 'Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.',
  RATE_LIMIT: 'GitHub временно ограничил проверки без входа (обычно на час). Попробуйте позже.',
  HTTP: 'GitHub ответил с ошибкой. Попробуйте позже.',
  BAD_RESPONSE: 'GitHub прислал непонятный ответ. Попробуйте позже.',
  NO_UPDATE: 'Сначала проверьте, есть ли новая версия.',
  VERIFY_FAILED: 'Файл обновления не прошёл проверку (размер, контрольная сумма, подпись или версия). Он удалён и не будет установлен.',
  INSTALL_PERMISSION: 'Разрешите Foodo устанавливать приложения, чтобы поставить обновление.',
  INSTALL_FAILED: 'Android не смог начать установку. Попробуйте ещё раз.',
  BUSY: 'Проверка обновления уже идёт.',
  INTERNAL: 'Не удалось обновить приложение. Попробуйте позже.',
};

const REASON_TEXT: Record<NoUpdateReason, string> = {
  up_to_date: 'Установлена последняя версия.',
  no_release: 'Опубликованных версий пока нет.',
  not_a_release: 'Последняя публикация — предварительная, она не предлагается.',
  invalid_release: 'Новая версия опубликована без проверяемого файла APK, поэтому не предлагается.',
};

/** Explains how to allow installs; shown before opening the system settings. */
export const INSTALL_PERMISSION_HELP =
  'Android устанавливает приложения не из магазина только с разрешения. Откройте настройки, включите для Foodo «Разрешить установку из этого источника» (название пункта зависит от телефона) и вернитесь в приложение — установка продолжится. Разрешение нужно только для обновлений Foodo, которые приложение скачивает из GitHub Releases и проверяет перед установкой.';

export function errorCode(e: unknown): UpdaterErrorCode | null {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === 'string' && code in ERROR_TEXT) return code as UpdaterErrorCode;
  }
  return null;
}

/** A Russian message for any error from the plugin (unknown errors get a generic text). */
export function updateErrorMessage(e: unknown): string {
  const code = errorCode(e);
  return code ? ERROR_TEXT[code] : ERROR_TEXT.INTERNAL;
}

export function noUpdateMessage(reason: string | undefined): string {
  return reason && reason in REASON_TEXT ? REASON_TEXT[reason as NoUpdateReason] : REASON_TEXT.up_to_date;
}

/** Result of the system installer, reported by the native receiver. */
export function installStatusMessage(status: string): string | null {
  if (status === 'aborted') return 'Установка отменена. Обновление можно поставить позже.';
  if (status === 'failure') return 'Android не установил обновление. Попробуйте ещё раз или скачайте APK со страницы релизов.';
  return null;
}

/** «12,4 МБ» */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: mb < 10 ? 1 : 0 })} МБ`;
}

/** Download progress in whole percent, 0…100. */
export function percent(downloaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)));
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage blocked: the setting simply is not remembered.
    return null;
  }
}

/** Automatic checks are on unless the user turned them off. */
export function readAutoCheck(store: KeyValueStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(AUTO_CHECK_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAutoCheck(on: boolean, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(AUTO_CHECK_KEY, on ? '1' : '0');
  } catch {
    // Not persisted (private mode or blocked storage); the current session still uses the value.
  }
}

/** Quiet checks run only when enabled, online and not more often than the interval. */
export function shouldAutoCheck(opts: { enabled: boolean; online: boolean; lastCheckedAt: number | null; now: number }): boolean {
  if (!opts.enabled || !opts.online) return false;
  return opts.lastCheckedAt === null || opts.now - opts.lastCheckedAt >= CHECK_INTERVAL_MS;
}
