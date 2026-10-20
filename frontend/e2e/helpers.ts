import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function onboard(page: Page, bans: string[] = []) {
  await page.goto('./');
  await page.getByRole('link', { name: 'Составить меню бесплатно' }).first().click();
  await walkQuestionnaire(page, {
    'Чего нельзя?': async () => {
      for (const b of bans) await page.getByRole('button', { name: b, exact: true }).click();
    },
  });
  await page.getByRole('button', { name: 'Составить меню' }).click();
  await page.waitForURL(/#\/menu/);
  // Desktop opens the week grid; the day view has the per-dish buttons.
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заменить' }).first()).toBeVisible();
}

/**
 * Goes through the questionnaire up to the summary with the default answers. `steps` runs extra
 * actions on the step with that heading (e.g. ticking bans) before moving on.
 */
export async function walkQuestionnaire(page: Page, steps: Record<string, () => Promise<void>> = {}) {
  await expect(page.getByRole('heading', { name: 'Для кого готовим?' })).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    const heading = await page.getByRole('heading', { level: 1 }).innerText();
    await steps[heading]?.();
    if (heading === 'Проверьте ответы') return;
    await page.getByRole('button', { name: 'Дальше' }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(heading);
  }
  throw new Error('Анкета не дошла до сводки');
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
