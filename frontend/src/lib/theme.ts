export type ThemeChoice = 'system' | 'light' | 'dark';

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem('foodo:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const THEME_COLORS = { light: '#fffbf2', dark: '#000000' } as const;

/**
 * The browser bar follows the chosen theme: index.html has one theme-color per system scheme, and a
 * forced theme pins both to its own colour (otherwise a dark app would get a light bar).
 */
function syncThemeColor(choice: ThemeChoice): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLORS[choice === 'system' ? scheme : choice];
  });
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  syncThemeColor(choice);
  try {
    localStorage.setItem('foodo:theme', choice);
  } catch {
    // theme still applies for this session
  }
}

export function applyStoredTheme(): void {
  applyTheme(storedTheme());
}
