import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/app';
import { Icon } from './ui/icons';
import type { IconName } from './ui/icons';
import { Banner, Loading, Toasts } from './ui/kit';
import { usePwaUpdate } from './lib/pwa';
import { APP_NAME } from './lib/config';

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
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Перейти к содержимому</a>
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
                Нет сети. {user ? 'Данные аккаунта доступны только для чтения — изменения сохранятся, когда сеть вернётся и вы повторите действие.' : 'Гостевой режим работает полностью: меню, каталог и покупки хранятся на этом устройстве.'}
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
          {bootError && <Banner tone="error">{bootError}</Banner>}
          {!ready ? (
            <Loading />
          ) : (
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
                  <Route path="*" element={<HomePage />} />
                </Routes>
              </div>
            </Suspense>
          )}
        </main>
      </div>
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
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <ScrollTop />
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
