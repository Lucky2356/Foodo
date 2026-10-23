import { Component, lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/app';
import { Icon } from './ui/icons';
import type { IconName } from './ui/icons';
import { Banner, Empty, Loading, Toasts } from './ui/kit';
import { usePwaUpdate } from './lib/pwa';
import { APP_NAME, NATIVE_BUILD } from './lib/config';

const HomePage = lazy(() => import('./pages/HomePage'));
const StartPage = lazy(() => import('./pages/StartPage'));
const MenuPage = lazy(() => import('./pages/MenuPage'));
const MenuHistoryPage = lazy(() => import('./pages/MenuHistoryPage'));
const RecipesPage = lazy(() => import('./pages/RecipesPage'));
const RecipePage = lazy(() => import('./pages/RecipePage'));
const RecipeEditorPage = lazy(() => import('./pages/RecipeEditorPage'));
const ShoppingPage = lazy(() => import('./pages/ShoppingPage'));
const PantryPage = lazy(() => import('./pages/PantryPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const ArticlesPage = lazy(() => import('./pages/ArticlesPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const HabitsPage = lazy(() => import('./pages/HabitsPage'));
// Android app only: updates come as signed APKs from GitHub Releases (the web build has no such code).
const UpdateBanner = NATIVE_BUILD ? lazy(() => import('./native/UpdateBanner')) : null;

const NAV: { to: string; label: string; icon: IconName; end?: boolean; mobile: boolean }[] = [
  { to: '/', label: 'Главная', icon: 'home', end: true, mobile: true },
  { to: '/menu', label: 'Меню', icon: 'calendar', mobile: true },
  { to: '/recipes', label: 'Рецепты', icon: 'book', mobile: true },
  { to: '/shopping', label: 'Покупки', icon: 'cart', mobile: true },
  { to: '/profile', label: 'Профиль', icon: 'user', mobile: true },
  { to: '/pantry', label: 'Дома', icon: 'box', mobile: false },
  { to: '/habits', label: 'Вода и привычки', icon: 'drop', mobile: false },
  { to: '/favorites', label: 'Избранное', icon: 'heart', mobile: false },
  { to: '/articles', label: 'Статьи', icon: 'leaf', mobile: false },
];

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label={`${APP_NAME} — на главную`}>
      <span className="brand-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 12h16c0 4.5-3.6 8-8 8s-8-3.5-8-8z" fill="currentColor" stroke="none" />
          <path d="M9 8c0-2 2-2 2-4M14 8c0-2 2-2 2-4" />
        </svg>
      </span>
      {APP_NAME}
    </NavLink>
  );
}

/** Tab titles by route; a recipe or an article keeps the section name (their own title needs data). */
const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Главная'],
  [/^\/start/, 'Анкета'],
  [/^\/menu\/history/, 'История меню'],
  [/^\/menu/, 'Меню'],
  [/^\/recipes\/new/, 'Новый рецепт'],
  [/^\/recipes/, 'Рецепты'],
  [/^\/shopping/, 'Покупки'],
  [/^\/pantry/, 'Дома'],
  [/^\/profile/, 'Профиль'],
  [/^\/settings/, 'Настройки'],
  [/^\/habits/, 'Вода и привычки'],
  [/^\/favorites/, 'Избранное'],
  [/^\/(account|reset-password)/, 'Аккаунт'],
  [/^\/articles/, 'Статьи'],
  [/^\/about/, 'О сервисе'],
];

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Страница не найдена';
    document.title = `${title} — ${APP_NAME}`;
  }, [pathname]);
  return null;
}

/**
 * A screen that failed to load (its code chunk was not reachable, e.g. offline before the app was
 * cached) shows an explanation and a retry instead of an empty page. Reset when the route changes.
 */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Empty
        page
        icon="offline"
        title="Экран не загрузился"
        action={
          <button className="btn primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        }
      >
        {navigator.onLine ? 'Не удалось загрузить часть приложения. Обновите страницу.' : 'Нет сети, а этот экран ещё не сохранён на устройстве. Подключитесь к интернету и обновите страницу.'}
      </Empty>
    );
  }
}

function NotFound() {
  return (
    <Empty page icon="info" title="Такой страницы нет" action={<Link className="btn primary" to="/">На главную</Link>}>
      Возможно, ссылка устарела или в ней опечатка.
    </Empty>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

function Shell() {
  const { ready, bootError, online, user, server } = useApp();
  const { needRefresh, update } = usePwaUpdate();
  const { pathname } = useLocation();
  // The questionnaire is a focused flow: no tab bar under its own Back / Next bar.
  const focus = pathname === '/start';
  return (
    <div className={`shell${focus ? ' focus-mode' : ''}`}>
      {/* With HashRouter «#main» is a route, so the link moves focus itself instead of navigating. */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      <aside className="sidebar" aria-label="Основная навигация">
        <Brand />
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
            <span className="nav-icon">
              <Icon name={n.icon} />
            </span>
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-footer stack" style={{ ['--gap' as string]: '6px' }}>
          <NavLink to="/account" className="nav-link">
            <span className="nav-icon">
              <Icon name={user ? 'shield' : 'user'} />
            </span>
            {user ? 'Аккаунт' : server ? 'Войти' : 'Данные'}
          </NavLink>
          <NavLink to="/about" className="nav-link">
            <span className="nav-icon">
              <Icon name="info" />
            </span>
            О сервисе
          </NavLink>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <Brand />
          <span className="spacer" />
          <NavLink to="/habits" className="icon-btn" aria-label="Вода и привычки">
            <Icon name="drop" />
          </NavLink>
          <NavLink to="/account" className="icon-btn" aria-label={user ? 'Аккаунт' : 'Вход и данные'}>
            <Icon name={user ? 'shield' : 'settings'} />
          </NavLink>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          {!online && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="warn" icon="offline">
                Нет сети.{' '}
                {user
                  ? 'Данные аккаунта можно только смотреть: изменения не сохранятся, пока сеть не вернётся.'
                  : 'Меню, каталог и покупки работают на этом устройстве; цены магазинов, новые фото и вход в аккаунт — после подключения.'}
              </Banner>
            </div>
          )}
          {needRefresh && (
            <div style={{ marginBottom: 14 }}>
              <div className="banner ok">
                <Icon name="sparkle" />
                <div className="grow">Доступна новая версия {APP_NAME}. Ваши данные сохранятся.</div>
                <button className="btn small primary" onClick={update}>
                  Обновить
                </button>
              </div>
            </div>
          )}
          {UpdateBanner && (
            <Suspense fallback={null}>
              <UpdateBanner />
            </Suspense>
          )}
          {bootError && <Banner tone="error">{bootError}</Banner>}
          {!ready ? (
            <Loading />
          ) : (
            <ScreenBoundary key={pathname}>
            <Suspense fallback={<Loading />}>
              <div className="page" key={pathname}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/start" element={<StartPage />} />
                  <Route path="/menu" element={<MenuPage />} />
                  <Route path="/menu/history" element={<MenuHistoryPage />} />
                  <Route path="/menu/:menuId" element={<MenuPage />} />
                  <Route path="/recipes" element={<RecipesPage />} />
                  <Route path="/recipes/new" element={<RecipeEditorPage />} />
                  <Route path="/recipes/:recipeId/edit" element={<RecipeEditorPage />} />
                  <Route path="/recipes/:recipeId" element={<RecipePage />} />
                  <Route path="/shopping" element={<ShoppingPage />} />
                  <Route path="/pantry" element={<PantryPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/habits" element={<HabitsPage />} />
                  <Route path="/favorites" element={<FavoritesPage />} />
                  <Route path="/account/*" element={<AccountPage />} />
                  <Route path="/reset-password" element={<AccountPage />} />
                  <Route path="/articles" element={<ArticlesPage />} />
                  <Route path="/articles/:articleId" element={<ArticlesPage />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
            </Suspense>
            </ScreenBoundary>
          )}
        </main>
      </div>
      {!focus && (
        <nav className="bottom-nav" aria-label="Основная навигация">
          {NAV.filter((n) => n.mobile).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <span className="nav-icon">
                <Icon name={n.icon} />
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <ScrollTop />
        <DocumentTitle />
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
