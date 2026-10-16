import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { noHorizontalScroll } from './helpers';

// Requires the Django API at FOODO_BACKEND_URL (default http://127.0.0.1:8000) with seed data.
test('account: register, plan on the server, transfer guest data, log out', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  // Guest data first (stays local until the explicit transfer).
  await page.goto('./');
  await page.getByRole('link', { name: 'Составить меню бесплатно' }).first().click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Составить меню' }).click();
  await page.waitForURL(/#\/menu/);

  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') posts.push(r.url());
  });
  await page.goto('./#/account');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  // Opening the account screen sent nothing (check 14/18).
  expect(posts).toEqual([]);
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Пароль').fill(randomBytes(18).toString('base64url'));
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText(email)).toBeVisible();
  expect(posts.every((u) => /auth\/register/.test(u))).toBe(true);

  await page.getByRole('button', { name: 'Посмотреть, что добавится' }).click();
  await expect(page.getByText('добавится').first()).toBeVisible();
  await page.getByRole('button', { name: 'Перенести' }).last().click();
  await expect(page.getByText(/Данные перенесены/)).toBeVisible();

  await page.goto('./#/menu');
  await page.getByRole('button', { name: 'Новое меню' }).click();
  await page.getByRole('button', { name: 'Составить', exact: true }).click();
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заменить' }).first()).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto('./#/account');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.waitForURL(/#\/$/);
  const caches = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(caches.some((n) => n?.startsWith('foodo-cache-account-'))).toBe(false);
  expect(caches).toContain('foodo-guest');
});
