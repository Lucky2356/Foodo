import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function onboard(page: Page, bans: string[] = []) {
  await page.goto('./');
  await page.getByRole('link', { name: 'Составить меню бесплатно' }).first().click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  for (const b of bans) await page.getByRole('button', { name: b }).click();
  await page.getByRole('button', { name: 'Составить меню' }).click();
  await page.waitForURL(/#\/menu/);
  // Desktop opens the week grid; the day view has the per-dish buttons.
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заменить' }).first()).toBeVisible();
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
