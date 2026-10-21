import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { NoUpdateReason } from './updateLogic';

/**
 * JavaScript side of the native FoodoUpdater plugin (frontend/android/.../FoodoUpdaterPlugin.java).
 * Loaded only in the Android build; on the web every function is a no-op.
 *
 * The plugin never takes a URL from here: download() fetches the APK of the release accepted by
 * the last check(), and install() installs only a file that passed the size, SHA-256, package,
 * version and signing-certificate checks.
 */

export interface AppInfo {
  versionName: string;
  versionCode: number;
  /** Android allows Foodo to install apps («Установка неизвестных приложений»). */
  canInstall: boolean;
}

export type CheckResult =
  | { available: true; version: string; notes: string; size: number }
  | { available: false; reason: NoUpdateReason };

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export interface InstallStatus {
  status: 'pending' | 'success' | 'aborted' | 'failure';
  message?: string;
}

interface FoodoUpdaterPlugin {
  getInfo(): Promise<AppInfo>;
  check(): Promise<CheckResult>;
  download(): Promise<{ version: string }>;
  install(): Promise<{ started: boolean }>;
  openInstallSettings(): Promise<void>;
  addListener(eventName: 'downloadProgress', listener: (event: DownloadProgress) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'installStatus', listener: (event: InstallStatus) => void): Promise<PluginListenerHandle>;
}

const FoodoUpdater = registerPlugin<FoodoUpdaterPlugin>('FoodoUpdater');

/** True inside the Android app with the updater plugin present. */
export function updaterAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FoodoUpdater');
}

export async function getAppInfo(): Promise<AppInfo | null> {
  return updaterAvailable() ? FoodoUpdater.getInfo() : null;
}

export async function checkForUpdate(): Promise<CheckResult> {
  if (!updaterAvailable()) return { available: false, reason: 'up_to_date' };
  return FoodoUpdater.check();
}

/** Downloads and verifies the update found by checkForUpdate(), reporting progress. */
export async function downloadUpdate(onProgress: (p: DownloadProgress) => void): Promise<string | null> {
  if (!updaterAvailable()) return null;
  const handle = await FoodoUpdater.addListener('downloadProgress', onProgress);
  try {
    return (await FoodoUpdater.download()).version;
  } finally {
    await handle.remove();
  }
}

/** Opens Android's install confirmation for the verified APK. */
export async function installUpdate(): Promise<void> {
  if (!updaterAvailable()) return;
  await FoodoUpdater.install();
}

export async function openInstallSettings(): Promise<void> {
  if (!updaterAvailable()) return;
  await FoodoUpdater.openInstallSettings();
}

export async function onInstallStatus(listener: (status: InstallStatus) => void): Promise<() => void> {
  if (!updaterAvailable()) return () => undefined;
  const handle = await FoodoUpdater.addListener('installStatus', listener);
  return () => void handle.remove();
}
