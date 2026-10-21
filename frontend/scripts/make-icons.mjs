// Renders the PWA PNG icons from the SVG mark (run once after changing the logo):
//   node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const mark = (size, pad, rounded) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#15803d"/></linearGradient></defs>
<rect width="64" height="64" rx="${rounded ? 16 : 0}" fill="url(#g)"/>
<g transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})">
<path d="M12 32h40c0 11.6-8.9 20-20 20s-20-8.4-20-20z" fill="#fff"/>
<path d="M25 22c0-5 5-5 5-10M36 22c0-5 5-5 5-10" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
<circle cx="46" cy="40" r="4" fill="#ff9f1c"/></g></svg></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad, rounded] of [
  ['public/icons/icon-192.png', 192, 0, true],
  ['public/icons/icon-512.png', 512, 0, true],
  ['public/icons/icon-maskable-512.png', 512, 10, false],
  ['public/icons/apple-touch-icon.png', 180, 4, false],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(mark(size, pad, rounded));
  writeFileSync(file, await page.locator('svg').screenshot({ omitBackground: true }));
}
await browser.close();
console.log('icons written');
