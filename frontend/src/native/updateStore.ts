import { useSyncExternalStore } from 'react';
import { checkForUpdate, downloadUpdate, getAppInfo, installUpdate, onInstallStatus, openInstallSettings } from './updater';
import type { AppInfo } from './updater';
import { errorCode, installStatusMessage, noUpdateMessage, readAutoCheck, shouldAutoCheck, updateErrorMessage, writeAutoCheck } from './updateLogic';

/**
 * Update state shared by the banner (App shell) and the «Обновления приложения» settings section.
 * Android app only; this module is loaded lazily behind NATIVE_BUILD.
 */
export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'none'; message: string }
  | { kind: 'available'; version: string; notes: string; size: number }
  | { kind: 'downloading'; version: string; downloaded: number; total: number }
  | { kind: 'needsPermission'; version: string }
  | { kind: 'installing'; version: string }
  | {
      kind: 'error';
      /** «check»: a manual check failed (shown in settings); «update»: the update itself failed (banner). */
      origin: 'check' | 'update';
      message: string;
      version: string | null;
      /** What «Повторить» does; null when only a new check helps (e.g. verification failed). */
      retry: 'download' | 'install' | null;
    };

export interface UpdateState {
  info: AppInfo | null;
  phase: UpdatePhase;
  autoCheck: boolean;
  lastCheckedAt: number | null;
  /** «Позже» hides the banner for this version until the next manual check or app restart. */
  dismissedVersion: string | null;
}

let state: UpdateState = { info: null, phase: { kind: 'idle' }, autoCheck: readAutoCheck(), lastCheckedAt: null, dismissedVersion: null };
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

function versionOf(phase: UpdatePhase): string | null {
  return 'version' in phase ? phase.version : null;
}

function updateError(message: string, version: string | null, retry: 'download' | 'install' | null): UpdatePhase {
  return { kind: 'error', origin: 'update', message, version, retry };
}

const isBusy = (p: UpdatePhase) => p.kind === 'checking' || p.kind === 'downloading' || p.kind === 'installing';

export async function loadInfo(): Promise<void> {
  try {
    set({ info: await getAppInfo() });
  } catch {
    // The settings section then shows no version number; checks report their own errors.
  }
}

/**
 * Asks GitHub for the latest release. Quiet checks (manual = false) never show errors: a failed
 * background check is not worth interrupting the user, and the next one runs in six hours.
 */
export async function checkNow(manual: boolean): Promise<void> {
  const previous = state.phase;
  if (isBusy(previous)) return;
  // A quiet check does not interrupt an update the user is already looking at.
  if (!manual && previous.kind !== 'idle' && previous.kind !== 'none') return;
  if (manual && !navigator.onLine) {
    set({ phase: { kind: 'error', origin: 'check', message: updateErrorMessage({ code: 'NETWORK' }), version: null, retry: null } });
    return;
  }
  set({ phase: { kind: 'checking', manual } });
  try {
    const result = await checkForUpdate();
    set({ lastCheckedAt: Date.now() });
    if (result.available) {
      set({ phase: { kind: 'available', version: result.version, notes: result.notes, size: result.size }, ...(manual ? { dismissedVersion: null } : {}) });
    } else {
      set({ phase: manual ? { kind: 'none', message: noUpdateMessage(result.reason) } : { kind: 'idle' } });
    }
  } catch (e) {
    set({ phase: manual ? { kind: 'error', origin: 'check', message: updateErrorMessage(e), version: null, retry: null } : previous });
  }
}

/** «Обновить» / «Повторить»: download and verify if needed, then hand the APK to Android's installer. */
export async function startUpdate(): Promise<void> {
  const phase = state.phase;
  const version = versionOf(phase);
  if (!version || isBusy(phase)) return;
  const needsDownload = phase.kind === 'available' || (phase.kind === 'error' && phase.retry === 'download');
  const canInstall = needsDownload || phase.kind === 'needsPermission' || (phase.kind === 'error' && phase.retry === 'install');
  if (!canInstall) return;
  if (needsDownload) {
    set({ phase: { kind: 'downloading', version, downloaded: 0, total: phase.kind === 'available' ? phase.size : 0 } });
    try {
      await downloadUpdate((p) => set({ phase: { kind: 'downloading', version, downloaded: p.downloaded, total: p.total } }));
    } catch (e) {
      // A file that failed verification is deleted by the plugin; only a new check can help.
      set({ phase: updateError(updateErrorMessage(e), version, errorCode(e) === 'VERIFY_FAILED' ? null : 'download') });
      return;
    }
  }
  await install(version);
}

async function install(version: string): Promise<void> {
  set({ phase: { kind: 'installing', version } });
  try {
    await installUpdate();
  } catch (e) {
    const code = errorCode(e);
    if (code === 'INSTALL_PERMISSION') {
      set({ phase: { kind: 'needsPermission', version } });
    } else if (code === 'NO_UPDATE') {
      // The verified file is gone (for example, Android restarted the app).
      set({ phase: updateError('Файл обновления больше недоступен. Скачайте его заново.', version, 'download') });
    } else {
      set({ phase: updateError(updateErrorMessage(e), version, 'install') });
    }
  }
}

export async function allowInstalls(): Promise<void> {
  try {
    await openInstallSettings();
  } catch (e) {
    set({ phase: updateError(updateErrorMessage(e), versionOf(state.phase), 'install') });
  }
}

/** After returning from the settings screen: continue if the permission is now granted. */
async function resumeAfterSettings(): Promise<void> {
  if (state.phase.kind !== 'needsPermission' || document.visibilityState !== 'visible') return;
  const version = state.phase.version;
  try {
    const info = await getAppInfo();
    if (info?.canInstall && state.phase.kind === 'needsPermission') await install(version);
  } catch {
    // Stay on the permission prompt; «Установить» retries.
  }
}

export function dismiss(): void {
  set({ dismissedVersion: versionOf(state.phase), phase: { kind: 'idle' } });
}

export function setAutoCheck(on: boolean): void {
  writeAutoCheck(on);
  set({ autoCheck: on });
  if (on) void checkNow(false);
}

/**
 * Starts the background schedule: a quiet check shortly after start and then every six hours while
 * the app runs, plus the installer status listener. Returns a cleanup function.
 */
export function startUpdateService(): () => void {
  void loadInfo();
  const tick = () => {
    if (shouldAutoCheck({ enabled: state.autoCheck, online: navigator.onLine, lastCheckedAt: state.lastCheckedAt, now: Date.now() })) void checkNow(false);
  };
  // A short delay keeps the first network request away from app start-up.
  const first = setTimeout(tick, 3000);
  // Every 15 minutes: has it been six hours? (Timers pause while the phone sleeps.)
  const timer = setInterval(tick, 15 * 60 * 1000);
  const onVisible = () => {
    void resumeAfterSettings();
    tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  let removeStatus: (() => void) | null = null;
  let stopped = false;
  void onInstallStatus((s) => {
    const message = installStatusMessage(s.status);
    if (message) set({ phase: updateError(message, versionOf(state.phase), 'install') });
  })
    .then((remove) => {
      if (stopped) remove();
      else removeStatus = remove;
    })
    // Without the listener the installer still works; only its result is not shown in the banner.
    .catch(() => undefined);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    removeStatus?.();
  };
}
