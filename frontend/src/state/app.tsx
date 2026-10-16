import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Catalog } from '../engine';
import { ApiError, serverAvailable } from '../data/api';
import { loadCatalog } from '../data/catalogSource';
import { GuestGateway } from '../data/guestGateway';
import { dropCache } from '../data/localDb';
import { account, RemoteGateway } from '../data/remoteGateway';
import type { AccountUser } from '../data/remoteGateway';
import type { Gateway, HouseholdView } from '../data/types';
import { STATIC_BUILD } from '../lib/config';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  undo?: () => void | Promise<void>;
}

interface AppState {
  ready: boolean;
  bootError: string | null;
  server: boolean;
  online: boolean;
  catalog: Catalog;
  catalogSource: string;
  user: AccountUser | null;
  gateway: Gateway;
  household: HouseholdView | null;
  refreshHousehold: () => Promise<HouseholdView | null>;
  favorites: Set<string>;
  toggleFavorite: (recipeId: string) => Promise<void>;
  currentMenuId: string | null;
  setCurrentMenuId: (id: string | null) => void;
  dataVersion: number;
  bump: () => void;
  toasts: Toast[];
  toast: (message: string, opts?: { tone?: Toast['tone']; undo?: Toast['undo'] }) => void;
  dismissToast: (id: number) => void;
  reportError: (e: unknown) => void;
  login: (user: AccountUser) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

const EMPTY_CATALOG: Catalog = {
  products: {},
  recipes: {},
  targetSets: {},
  reference: {
    sources: [], nutrients: [], allergens: [], categories: [], departments: [], equipment: [], skill_levels: [], techniques: [],
    diet_modes: [], diet_tags: [], diet_rules: { version: '', balanced: {}, regular: {} }, meal_slots: [], recipe_categories: [], stores: [],
  },
};

function menuKey(user: AccountUser | null): string {
  return `foodo:current-menu:${user ? `account-${user.id}` : 'guest'}`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage may be unavailable (private mode); the app still works without it
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [server, setServer] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [catalogSource, setCatalogSource] = useState('');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [household, setHousehold] = useState<HouseholdView | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [currentMenuId, setCurrentMenuIdState] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const toastSeq = useRef(0);

  const gateway: Gateway = useMemo(() => {
    if (user && user.households[0]) return new RemoteGateway(user.households[0].id, `account-${user.id}`);
    return new GuestGateway(() => catalogRef.current, server);
  }, [user, server]);

  const toast = useCallback((message: string, opts: { tone?: Toast['tone']; undo?: Toast['undo'] } = {}) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((list) => [...list.slice(-2), { id, message, tone: opts.tone ?? 'info', undo: opts.undo }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.undo ? 7000 : 4000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const reportError = useCallback(
    (e: unknown) => {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.';
      toast(message, { tone: 'error' });
    },
    [toast],
  );

  const refreshHousehold = useCallback(async () => {
    try {
      const h = await gateway.getHousehold();
      setHousehold(h);
      setFavorites(new Set(await gateway.listFavorites()));
      return h;
    } catch (e) {
      reportError(e);
      return null;
    }
  }, [gateway, reportError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hasServer = STATIC_BUILD ? false : await serverAvailable();
        const loaded = await loadCatalog(hasServer);
        if (cancelled) return;
        setServer(hasServer);
        setCatalog(loaded.catalog);
        setCatalogSource(loaded.source);
        if (hasServer) {
          try {
            setUser(await account.me());
          } catch {
            setUser(null);
          }
        }
      } catch (e) {
        setBootError(e instanceof Error ? e.message : 'Не удалось загрузить данные.');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      cancelled = true;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setCurrentMenuIdState(readStorage(menuKey(user)));
    void refreshHousehold();
  }, [ready, user, refreshHousehold]);

  const setCurrentMenuId = useCallback(
    (id: string | null) => {
      setCurrentMenuIdState(id);
      writeStorage(menuKey(user), id);
    },
    [user],
  );

  const toggleFavorite = useCallback(
    async (recipeId: string) => {
      const on = !favorites.has(recipeId);
      setFavorites((s) => {
        const next = new Set(s);
        if (on) next.add(recipeId);
        else next.delete(recipeId);
        return next;
      });
      try {
        setFavorites(new Set(await gateway.setFavorite(recipeId, on)));
      } catch (e) {
        reportError(e);
        setFavorites(new Set(await gateway.listFavorites().catch(() => [])));
      }
    },
    [favorites, gateway, reportError],
  );

  const login = useCallback(async (u: AccountUser) => {
    setHousehold(null);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    const scope = user ? `account-${user.id}` : null;
    try {
      await account.logout();
    } finally {
      // The account's offline copy is wiped; guest data on this device is untouched.
      if (scope) await dropCache(scope);
      setHousehold(null);
      setUser(null);
    }
  }, [user]);

  const value: AppState = {
    ready,
    bootError,
    server,
    online,
    catalog,
    catalogSource,
    user,
    gateway,
    household,
    refreshHousehold,
    favorites,
    toggleFavorite,
    currentMenuId,
    setCurrentMenuId,
    dataVersion,
    bump: () => setDataVersion((v) => v + 1),
    toasts,
    toast,
    dismissToast,
    reportError,
    login,
    logout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}

/** Loads data with explicit loading/error states; re-runs when deps or the data version change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void; setData: (v: T) => void } {
  const { dataVersion } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить данные.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1), setData };
}
