import type { CityRef } from './types';

export interface City extends CityRef {
  federal_district: string;
  lat: number;
  lon: number;
  population: number | null;
}

export interface Chain {
  id: string;
  name: string;
  kind: string;
  website: string;
  nationwide: boolean;
  federal_districts: string[];
  regions: string[];
  presence_verified: boolean;
  note: string;
}

let citiesPromise: Promise<City[]> | null = null;
let chainsPromise: Promise<Chain[]> | null = null;

/** The city list ships with the app (≈270 KB, loaded on demand) so the location stays on device. */
export function loadCities(): Promise<City[]> {
  citiesPromise ??= import('../../../shared/data/geo/cities.json').then((m) => (m.default as unknown as { cities: City[] }).cities);
  return citiesPromise;
}

export function loadChains(): Promise<Chain[]> {
  chainsPromise ??= import('../../../shared/data/geo/chains.json').then((m) => (m.default as unknown as { chains: Chain[] }).chains);
  return chainsPromise;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function nearestCity(cities: City[], lat: number, lon: number): { city: City; km: number } | null {
  let best: { city: City; km: number } | null = null;
  for (const city of cities) {
    const km = distanceKm(lat, lon, city.lat, city.lon);
    if (!best || km < best.km) best = { city, km };
  }
  return best;
}

export function chainsForCity(chains: Chain[], city: City | CityRef & { federal_district?: string }): Chain[] {
  return chains.filter((c) => c.nationwide || (city.federal_district ? c.federal_districts.includes(city.federal_district) : false) || c.regions.includes(city.region));
}

export function searchCities(cities: City[], query: string, limit = 20): City[] {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return cities.slice(0, limit);
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
  const starts = cities.filter((c) => norm(c.name).startsWith(q));
  const contains = cities.filter((c) => !norm(c.name).startsWith(q) && norm(c.name).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Browser geolocation → nearest city, computed locally. Coordinates are never sent anywhere. */
export function detectCity(): Promise<{ city: City; km: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Браузер не поддерживает определение местоположения.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const found = nearestCity(await loadCities(), pos.coords.latitude, pos.coords.longitude);
        if (!found) reject(new Error('Не удалось определить город.'));
        else resolve(found);
      },
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Доступ к местоположению запрещён. Выберите город вручную.' : 'Не удалось определить местоположение.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60 * 60 * 1000 },
    );
  });
}
