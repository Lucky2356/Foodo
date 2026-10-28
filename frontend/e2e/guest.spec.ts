import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { noHorizontalScroll, onboard, walkQuestionnaire } from './helpers';

test.describe('guest mode (static site, no server)', () => {
  test('family → menu → shopping survives a reload; 360 px; no horizontal scroll (checks 1, 17)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await onboard(page, ['Без риса', 'Без макарон']);
    await noHorizontalScroll(page);
    const firstDish = await page.locator('.dish-title').first().innerText();
    await page.reload();
    await expect(page.locator('.dish-title').first()).toHaveText(firstDish);
    await page.getByRole('link', { name: 'Покупки' }).last().click();
    await expect(page.getByRole('heading', { name: 'Покупки' })).toBeVisible();
    await noHorizontalScroll(page);
    const items = await page.locator('.shop-name').allInnerTexts();
    expect(items.join(' ')).not.toMatch(/Рис белый|Макароны|Спагетти|Яичная лапша/);
    for (const path of ['#/recipes', '#/profile', '#/pantry', '#/habits', '#/settings/menu', '#/settings/kitchen', '#/settings/food', '#/settings/shopping', '#/settings/look', '#/cooking', '#/account', '#/about']) {
      await page.goto(`./${path}`);
      await page.waitForTimeout(300);
      await noHorizontalScroll(page);
    }
  });

  test('«О сервисе» shows the author and the source link the licence requires (NOTICE.md)', async ({ page }) => {
    await page.goto('./#/about');
    await expect(page.getByText('Основано на Foodo — автор')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lucky (github.com/Lucky2356)' })).toHaveAttribute('href', 'https://github.com/Lucky2356');
    await expect(page.getByRole('link', { name: 'Исходный код' })).toHaveAttribute('href', 'https://github.com/Lucky2356/Foodo');
  });

  test('settings: the profile lists short screens with current values; the gear opens it (settings)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await onboard(page);
    await page.getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/#\/profile$/);
    const list = page.getByRole('navigation', { name: 'Настройки' });
    await expect(list.getByRole('link', { name: /Меню.*приёма пищи · неделя/ })).toBeVisible();
    await expect(list.getByRole('link', { name: /Покупки и цены.*город не выбран/ })).toBeVisible();
    await list.getByRole('link', { name: /^Готовка/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Готовка' })).toBeVisible();
    await page.getByRole('button', { name: 'Начинаю' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    await page.getByRole('link', { name: 'Профиль' }).first().click();
    await expect(list.getByRole('link', { name: /Готовка.*простые блюда/ })).toBeVisible();
    // Old links still land on the screen that holds the setting.
    await page.goto('./#/settings#budget');
    await expect(page.getByRole('heading', { level: 1, name: 'Покупки и цены' })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('cooking: today first with portions and meals; «Приготовлено» marks the dish (cooking)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await onboard(page);
    await page.goto('./#/cooking');
    await expect(page.getByRole('heading', { level: 1, name: 'Готовка' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Сегодня' })).toBeVisible();
    const first = page.locator('.cook-task').first();
    await expect(first).toContainText('Едим: на');
    await expect(first).toContainText(/порци/);
    await first.getByRole('button', { name: 'Приготовлено' }).click();
    await expect(first.getByText('Приготовлено')).toBeVisible();
    await expect(first.getByRole('button', { name: 'Приготовлено' })).toHaveCount(0);
    // Later days are folded into one line each.
    await expect(page.locator('details.cook-day').first()).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('the Content Security Policy blocks nothing the app needs (security)', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await onboard(page);
    for (const path of ['#/recipes', '#/shopping', '#/settings', '#/profile', '#/']) {
      await page.goto(`./${path}`);
      await page.waitForTimeout(400);
    }
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self'");
    expect(violations).toEqual([]);
  });

  test('one-tap replace with undo updates the menu (check 6)', async ({ page }) => {
    await onboard(page);
    const before = await page.locator('.dish-title').first().innerText();
    await page.getByRole('button', { name: 'Заменить' }).first().click();
    await expect(page.locator('.dish-title').first()).not.toHaveText(before);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator('.dish-title').first()).toHaveText(before);
  });

  test('keyboard only: start and finish onboarding (check 17)', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Tab');
    await expect(page.getByText('Перейти к содержимому')).toBeFocused();
    const cta = page.getByRole('link', { name: 'Составить меню бесплатно' }).first();
    await cta.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Для кого готовим?' })).toBeVisible();
    for (let step = 0; step < 8; step += 1) {
      const heading = await page.getByRole('heading', { level: 1 }).innerText();
      await page.getByRole('button', { name: 'Дальше' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(heading);
    }
    await expect(page.getByRole('heading', { name: 'Проверьте ответы' })).toBeVisible();
    await page.getByRole('button', { name: 'Составить меню' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/menu/);
  });

  test('guest planning sends no profile data anywhere (check 18)', async ({ page }) => {
    const requests: { url: string; method: string; body: string | null }[] = [];
    page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
    await onboard(page, ['Молоко и лактоза']);
    await page.goto('./#/account');
    await page.waitForTimeout(500);
    for (const r of requests) {
      expect(r.method).toBe('GET');
      expect(r.body).toBeNull();
      expect(decodeURIComponent(r.url)).not.toMatch(/Взрослый|milk|dairy/);
    }
  });

  test('PDF and XLSX exports contain the current list with Cyrillic (check 15)', async ({ page }) => {
    await onboard(page);
    await page.goto('./#/shopping');
    const firstItem = (await page.locator('.shop-name').first().innerText()).trim().split('\n')[0] as string;
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'XLSX' }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await xlsx.path()) as string);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Меню', 'Покупки', 'Готовка']);
    const names = wb.getWorksheet('Покупки')!.getColumn(2).values.map(String);
    expect(names).toContain(firstItem);
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    const bytes = readFileSync((await pdf.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('DejaVu');
    expect(bytes.length).toBeGreaterThan(20000);
  });

  test('works offline after the first visit (PWA cache, check 17)', async ({ page, context }) => {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('Нет сети')).toBeVisible();
    await page.goto('./#/shopping');
    await expect(page.getByRole('heading', { name: 'Покупки' })).toBeVisible();
    await page.goto('./#/recipes/borshch-s-govyadinoy');
    await expect(page.getByRole('heading', { name: 'Борщ с говядиной' })).toBeVisible();
    await page.goto('./#/menu');
    await page.getByRole('button', { name: 'День', exact: true }).click();
    await page.getByRole('button', { name: 'Заменить' }).first().click();
    await expect(page.getByText(/Заменили на/)).toBeVisible();
    await context.setOffline(false);
  });

  test('bottom sheets and cooking mode open on screen at phone width', async ({ page }) => {
    // A transformed page ancestor used to become the containing block of these fixed overlays and
    // pushed their buttons below the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./#/recipes');
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    await expect(page.getByRole('button', { name: /^Показать \d+/ })).toBeInViewport();
    await page.keyboard.press('Escape');
    await page.locator('a[href*="#/recipes/"]:not([href$="/new"])').first().click();
    await page.getByRole('button', { name: 'Режим готовки' }).click();
    await expect(page.getByText(/^Шаг 1 из \d+/)).toBeInViewport();
  });

  test('beginner with only a stove gets no oven dishes (check 21)', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('link', { name: 'Составить меню бесплатно' }).first().click();
    await walkQuestionnaire(page, {
      'Кухня и время': async () => {
        await page.getByRole('button', { name: /^Начинающий/ }).click();
        // Only the stove stays selected.
        for (const name of ['Духовка', 'Микроволновка', 'Мультиварка', 'Блендер', 'Аэрогриль']) {
          const chip = page.getByRole('button', { name, exact: true });
          if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
        }
      },
    });
    await page.getByRole('button', { name: 'Составить меню' }).click();
    await page.waitForURL(/#\/menu/);
    const backup = await page.evaluate(async () => {
      const req = indexedDB.open('foodo-guest');
      const db: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const tx = db.transaction('menus');
      const all: { menu: { batches: { method_id: string; recipe_id: string }[] } }[] = await new Promise((res) => {
        const r = tx.objectStore('menus').getAll();
        r.onsuccess = () => res(r.result);
      });
      return all[0]!.menu.batches;
    });
    expect(backup.length).toBeGreaterThan(0);
    expect(backup.every((b) => b.method_id !== 'oven' && b.method_id !== 'airfryer' && b.method_id !== 'microwave')).toBe(true);
    expect(backup.some((b) => ['syrniki', 'kotlety-iz-indeyki', 'pirog-s-kapustoy', 'lenivye-golubtsy'].includes(b.recipe_id))).toBe(false);
  });
});

test.describe('published prices', () => {
  // page.route() does not see requests a service worker makes; the worker takes the page over at once
  // (clientsClaim), so it is blocked here to serve the mocked price files. Offline use has its own test.
  test.use({ serviceWorkers: 'block' });

  test('published Rosstat prices for the chosen city appear as estimates (prices)', async ({ page }) => {
    const entry = (product_id: string, price_kop: number) => ({
      product_id,
      price_kop,
      package_size: 1,
      package_unit: 'kg',
      currency: 'RUB',
      date: '2026-09-30',
      source: 'Росстат, средние потребительские цены, 09.2026',
      kind: 'rosstat',
      loose: true,
    });
    const requested: string[] = [];
    await page.route('**/data/prices/**', async (route) => {
      const url = route.request().url();
      requested.push(url);
      if (url.endsWith('/index.json')) {
        return route.fulfill({
          json: {
            files: { 'region:Республика Татарстан': 'tat.json' },
            status: { sources: { rosstat: { ok: true, period: '2026-09', updated_at: '2026-10-16T00:00:00+00:00' }, pyaterochka: { collected: false, reason: 'Сайт недоступен из сети GitHub Actions.' } } },
          },
        });
      }
      if (url.endsWith('/tat.json')) return route.fulfill({ json: { entries: [entry('potato', 4550), entry('onion', 3990), entry('carrot', 4200)] } });
      return route.fulfill({ status: 404, body: '' });
    });
    await onboard(page);
    await page.goto('./#/settings/shopping');
    await page.getByPlaceholder('Или найдите город вручную').fill('Казань');
    await page.getByRole('button', { name: /^Казань/ }).first().click();
    await page.getByText('Откуда цены').click();
    await expect(page.getByText('период 2026-09')).toBeVisible();
    await expect(page.getByText('Сайт недоступен из сети GitHub Actions.')).toBeVisible();
    await page.goto('./#/shopping');
    await expect(page.getByText('часть цен — средние Росстата (оценка)')).toBeVisible();
    // Only file names were requested — no profile data in the URL.
    expect(requested.every((u) => /\/data\/prices\/(index|tat)\.json$/.test(u))).toBe(true);
  });

  test('a city chosen in the questionnaire gives prices on the first shopping list (prices)', async ({ page }) => {
    await page.route('**/data/prices/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/index.json')) return route.fulfill({ json: { files: { 'region:Республика Татарстан': 'tat.json' }, status: null } });
      if (url.endsWith('/tat.json')) {
        const entry = (product_id: string, price_kop: number) => ({ product_id, price_kop, package_size: 1, package_unit: 'kg', currency: 'RUB', date: '2026-09-30', source: 'Росстат, 09.2026', kind: 'rosstat', loose: true });
        return route.fulfill({ json: { entries: [entry('potato', 4550), entry('onion', 3990), entry('carrot', 4200)] } });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('./');
    await page.getByRole('link', { name: 'Составить меню бесплатно' }).first().click();
    await walkQuestionnaire(page, {
      'Где покупаете продукты?': async () => {
        await page.getByPlaceholder('Или найдите город вручную').fill('Казань');
        await page.getByRole('button', { name: /^Казань/ }).first().click();
        await expect(page.getByText('Казань, Республика Татарстан')).toBeVisible();
      },
    });
    await expect(page.getByText('Казань, любой магазин')).toBeVisible();
    await page.getByRole('button', { name: 'Составить меню' }).click();
    await page.waitForURL(/#\/menu/);
    await page.goto('./#/shopping');
    await expect(page.getByText('часть цен — средние Росстата (оценка)')).toBeVisible();
    await expect(page.getByText('Сколько это стоит?')).toHaveCount(0);
  });

  test('without any price the shopping list offers to choose a city right there (prices)', async ({ page }) => {
    await page.route('**/data/prices/**', (route) => route.fulfill({ status: 404, body: '' }));
    await onboard(page);
    await page.goto('./#/shopping');
    await expect(page.getByText('Сколько это стоит?')).toBeVisible();
    await page.getByRole('button', { name: 'Выбрать город' }).click();
    await page.getByRole('dialog').getByPlaceholder('Или найдите город вручную').fill('Казань');
    await page.getByRole('dialog').getByRole('button', { name: /^Казань/ }).first().click();
    await expect(page.getByRole('dialog').getByText('Казань, Республика Татарстан')).toBeVisible();
  });
});
