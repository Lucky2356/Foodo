import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../data/api';
import type { MenuRecord } from '../data/types';
import { useApp } from './app';

/** The menu shown on Menu/Shopping/Home: an explicit id, else the remembered one, else the latest. */
export function useCurrentMenu(explicitId?: string) {
  const { gateway, currentMenuId, setCurrentMenuId, dataVersion } = useApp();
  const [record, setRecord] = useState<MenuRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        let id = explicitId ?? currentMenuId;
        let rec: MenuRecord | null = null;
        if (id) {
          try {
            rec = await gateway.getMenu(id);
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 404)) throw e;
            id = null;
          }
        }
        if (!rec) {
          const list = await gateway.listMenus();
          if (list[0]) rec = await gateway.getMenu(list[0].id);
        }
        if (!cancelled) {
          setRecord(rec);
          setError(null);
          if (rec && rec.id !== currentMenuId && !explicitId) setCurrentMenuId(rec.id);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить меню.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, explicitId, dataVersion, tick]);

  return { record, setRecord, loading, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}
