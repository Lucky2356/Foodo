import { defineConfig, devices } from '@playwright/test';

// Two suites:
//  - guest: the static (GitHub Pages) build, no server at all;
//  - account (E2E_ACCOUNT=1): the server build behind `vite preview` proxying /api to Django.
// E2E_BASE_URL runs the guest suite against an already deployed site (the Pages smoke check)
// instead of a local preview; it must end with a slash, e.g. https://owner.github.io/Foodo/.
const account = process.env.E2E_ACCOUNT === '1';
const deployedSite = account ? undefined : process.env.E2E_BASE_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: account ? /account\.spec\.ts/ : /guest\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: account ? 'http://localhost:4174' : (deployedSite ?? 'http://localhost:4173'),
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
  webServer: deployedSite
    ? undefined
    : account
    ? { command: 'npx vite build && npx vite preview --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 180_000 }
    : { command: 'npx vite build --mode static && npx vite preview --mode static --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 },
});
