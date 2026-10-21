import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_KEY,
  CHECK_INTERVAL_MS,
  errorCode,
  formatSize,
  installStatusMessage,
  noUpdateMessage,
  percent,
  readAutoCheck,
  shouldAutoCheck,
  updateErrorMessage,
  writeAutoCheck,
} from '../updateLogic';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const brokenStore = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('updater error messages', () => {
  it('maps plugin error codes to Russian texts', () => {
    expect(updateErrorMessage({ code: 'NETWORK', message: 'GitHub API request failed' })).toMatch(/Нет связи/);
    expect(updateErrorMessage({ code: 'RATE_LIMIT' })).toMatch(/ограничил/);
    expect(updateErrorMessage({ code: 'VERIFY_FAILED' })).toMatch(/не прошёл проверку.*не будет установлен/);
  });

  it('never shows raw English errors', () => {
    expect(updateErrorMessage(new Error('java.io.IOException: boom'))).toBe('Не удалось обновить приложение. Попробуйте позже.');
    expect(updateErrorMessage({ code: 'SOMETHING_NEW' })).toBe('Не удалось обновить приложение. Попробуйте позже.');
    expect(updateErrorMessage(null)).toBe('Не удалось обновить приложение. Попробуйте позже.');
    expect(errorCode({ code: 42 })).toBeNull();
    expect(errorCode({ code: 'INSTALL_PERMISSION' })).toBe('INSTALL_PERMISSION');
  });

  it('explains why no update is offered', () => {
    expect(noUpdateMessage('up_to_date')).toBe('Установлена последняя версия.');
    expect(noUpdateMessage('invalid_release')).toMatch(/без проверяемого файла APK/);
    expect(noUpdateMessage('no_release')).toMatch(/пока нет/);
    expect(noUpdateMessage(undefined)).toBe('Установлена последняя версия.');
  });

  it('reports installer outcomes that need the user', () => {
    expect(installStatusMessage('aborted')).toMatch(/отменена/);
    expect(installStatusMessage('failure')).toMatch(/не установил/);
    expect(installStatusMessage('pending')).toBeNull();
    expect(installStatusMessage('success')).toBeNull();
  });
});

describe('auto-check preference', () => {
  it('is on by default and remembers the choice', () => {
    const store = memoryStore();
    expect(readAutoCheck(store)).toBe(true);
    writeAutoCheck(false, store);
    expect(store.data.get(AUTO_CHECK_KEY)).toBe('0');
    expect(readAutoCheck(store)).toBe(false);
    writeAutoCheck(true, store);
    expect(readAutoCheck(store)).toBe(true);
  });

  it('survives blocked storage', () => {
    expect(readAutoCheck(brokenStore)).toBe(true);
    expect(() => writeAutoCheck(false, brokenStore)).not.toThrow();
    expect(readAutoCheck(null)).toBe(true);
  });
});

describe('check schedule', () => {
  const now = 1_800_000_000_000;
  it('checks on start and then every six hours', () => {
    expect(shouldAutoCheck({ enabled: true, online: true, lastCheckedAt: null, now })).toBe(true);
    expect(shouldAutoCheck({ enabled: true, online: true, lastCheckedAt: now - CHECK_INTERVAL_MS + 1, now })).toBe(false);
    expect(shouldAutoCheck({ enabled: true, online: true, lastCheckedAt: now - CHECK_INTERVAL_MS, now })).toBe(true);
  });

  it('does not check when disabled or offline', () => {
    expect(shouldAutoCheck({ enabled: false, online: true, lastCheckedAt: null, now })).toBe(false);
    expect(shouldAutoCheck({ enabled: true, online: false, lastCheckedAt: null, now })).toBe(false);
  });
});

describe('formatting', () => {
  it('formats sizes and progress', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5,0 МБ');
    expect(formatSize(12.44 * 1024 * 1024)).toBe('12,4 МБ');
    expect(formatSize(0)).toBe('');
    expect(percent(50, 200)).toBe(25);
    expect(percent(10, 0)).toBe(0);
    expect(percent(300, 200)).toBe(100);
  });
});
