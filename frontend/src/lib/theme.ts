export type ThemeChoice = 'system' | 'light' | 'dark';

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem('foodo:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem('foodo:theme', choice);
  } catch {
    // theme still applies for this session
  }
}

export function applyStoredTheme(): void {
  applyTheme(storedTheme());
}
