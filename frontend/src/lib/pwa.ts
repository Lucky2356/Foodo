import { useEffect, useState } from 'react';
import { STATIC_BUILD } from './config';

/**
 * Registers the service worker with an explicit update prompt: a new version is activated only
 * when the user presses «Обновить», so an open menu is never reloaded unexpectedly. Updating the
 * app never touches IndexedDB (guest data stays).
 */
export function usePwaUpdate(): { needRefresh: boolean; update: () => void } {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updater, setUpdater] = useState<null | ((reload?: boolean) => Promise<void>)>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const update = registerSW({
          immediate: true,
          onNeedRefresh: () => setNeedRefresh(true),
          onRegisterError: () => undefined,
        });
        setUpdater(() => update);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return { needRefresh, update: () => void updater?.(true) };
}

export const isStatic = STATIC_BUILD;
