import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPriceSourcesStatus, fetchPublicPrices } from '../prices';

const entry = (product_id: string, price_kop: number, kind: string) => ({
  product_id,
  price_kop,
  package_size: 1,
  package_unit: 'kg',
  currency: 'RUB',
  date: '2026-09-30',
  source: kind,
  kind,
  loose: true,
});

afterEach(() => vi.unstubAllGlobals());

describe('published price data on the static site', () => {
  it('layers region → city → chain prices and asks only for ids', async () => {
    const files: Record<string, unknown> = {
      'data/prices/index.json': {
        files: { 'region:Республика Татарстан': 'r.json', 'city:1600000100000': 'c.json', '1600000100000:magnit': 'm.json' },
      },
      'data/prices/r.json': { entries: [entry('potato', 4000, 'rosstat'), entry('onion', 3000, 'rosstat'), entry('beet', 2500, 'rosstat')] },
      'data/prices/c.json': { entries: [entry('potato', 4500, 'rosstat'), entry('onion', 3200, 'rosstat')] },
      'data/prices/m.json': { entries: [entry('potato', 6990, 'scraped')] },
    };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const body = files[String(url)];
        return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
      }),
    );
    const prices = Object.fromEntries((await fetchPublicPrices('1600000100000', 'magnit', false, 'Республика Татарстан')).map((e) => [e.product_id, e.price_kop]));
    expect(prices).toEqual({ potato: 6990, onion: 3200, beet: 2500 });
    expect(urls.every((u) => u.startsWith('data/prices/'))).toBe(true);
  });

  it('works without a city file or chain and with no published data at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await fetchPublicPrices('1600000100000', null, false, 'Республика Татарстан')).toEqual([]);
  });

  it('reads the published status of every source, whatever shape its fields have (settings did crash on Rosstat «cities»: 270)', async () => {
    const index = {
      status: {
        sources: {
          rosstat: { name: 'Росстат', ok: true, regions: 85, cities: 270, period: '2026-09', updated_at: '2026-10-26T08:59:14+00:00' },
          metro: { name: 'Metro', ok: true, cities: [{ city: 'Москва', products: 50 }, { city: 7 }, null], updated_at: '2026-10-26T09:26:42+00:00' },
          lenta: { name: 'lenta', collected: false, reason: 'Проверка браузера' },
          broken: 'not an object',
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(index), { status: 200 })));
    const status = await fetchPriceSourcesStatus();
    expect(status?.rosstat).toMatchObject({ ok: true, regions: 85, city_count: 270, cities: undefined, period: '2026-09' });
    expect(status?.metro?.cities).toEqual([{ city: 'Москва', products: 50 }]);
    expect(status?.lenta).toMatchObject({ collected: false, reason: 'Проверка браузера' });
    expect(status?.broken).toEqual(expect.objectContaining({ name: undefined }));
  });

  it('has no status when the file says nothing about sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: {} }), { status: 200 })));
    expect(await fetchPriceSourcesStatus()).toBeNull();
  });
});
