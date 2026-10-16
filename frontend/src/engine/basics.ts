// Small deterministic primitives. Every function here has an exact twin in backend/engine/basics.py:
// the TypeScript and Python engines must produce bit-identical results for the shared fixtures.

/** Half-up rounding to a step. Used for model decisions (portion steps, kopecks), not for display. */
export function roundHalfUp(value: number, step: number): number {
  return Math.floor(value / step + 0.5) * step;
}

/** Rounds to an integer number of kopecks, half up. */
export function roundKop(value: number): number {
  return Math.floor(value + 0.5);
}

/** Cleans binary noise in quantities (1e-6 g precision) before they leave the engine. */
export function cleanQty(value: number): number {
  return Math.floor(value * 1e6 + 0.5) / 1e6;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toInt32(n: number): number {
  return n | 0;
}

/** mulberry32 PRNG. Seeds are reduced to unsigned 32-bit integers. */
export class Rng {
  private state: number;
  draws = 0;

  constructor(seed: number) {
    this.state = toInt32(Math.floor(Math.abs(seed)) % 4294967296);
  }

  next(): number {
    this.draws += 1;
    this.state = toInt32(this.state + 0x6d2b79f5);
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = toInt32(t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string): Date {
  const m = ISO_DATE.exec(value);
  if (!m) throw new Error(`Некорректная дата: ${value}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== value) throw new Error(`Некорректная дата: ${value}`);
  return d;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(value: string, days: number): string {
  const d = parseIsoDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(value: string): number {
  const day = parseIsoDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86400000);
}

/** Lexicographic comparison by UTF-16 code units; ids are ASCII so Python's ordering is identical. */
export function compareStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort(compareStr);
}
