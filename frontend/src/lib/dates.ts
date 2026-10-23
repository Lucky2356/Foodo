/** Calendar helpers. Menu dates are plain ISO dates; «today» depends on the member's time zone. */

export function localDate(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next Monday (or today if it is Monday) — the default start of a weekly menu. */
export function nextMonday(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const wd = d.getUTCDay();
  const shift = wd === 1 ? 0 : (8 - wd) % 7;
  return addDaysIso(today, shift);
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function weekdayShort(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] as string;
}

export function weekdayLong(date: string): string {
  return WEEKDAYS_LONG[new Date(`${date}T00:00:00Z`).getUTCDay()] as string;
}

export function dayMonth(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function humanDate(date: string, today?: string): string {
  if (today) {
    if (date === today) return 'Сегодня';
    if (date === addDaysIso(today, 1)) return 'Завтра';
    if (date === addDaysIso(today, -1)) return 'Вчера';
  }
  return `${weekdayLong(date).replace(/^./, (c) => c.toUpperCase())}, ${dayMonth(date)}`;
}

/** «16–22 октября» or «28 октября — 3 ноября». */
export function dateRange(start: string, end: string): string {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  if (start === end) return dayMonth(start);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  return `${dayMonth(start)} — ${dayMonth(end)}`;
}

/** Russian time zones by a city people know, with the offset from Moscow. */
export const TIMEZONES: [string, string][] = [
  ['Europe/Kaliningrad', 'Калининград (МСК−1)'],
  ['Europe/Moscow', 'Москва (МСК)'],
  ['Europe/Samara', 'Самара (МСК+1)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (МСК+2)'],
  ['Asia/Omsk', 'Омск (МСК+3)'],
  ['Asia/Krasnoyarsk', 'Красноярск (МСК+4)'],
  ['Asia/Irkutsk', 'Иркутск (МСК+5)'],
  ['Asia/Yakutsk', 'Якутск (МСК+6)'],
  ['Asia/Vladivostok', 'Владивосток (МСК+7)'],
  ['Asia/Magadan', 'Магадан (МСК+8)'],
  ['Asia/Kamchatka', 'Камчатка (МСК+9)'],
];
const TZ_NAMES = new Map(TIMEZONES);

/** «Москва (МСК)» for a known zone; other IANA names as they are. */
export function timeZoneName(tz: string): string {
  return TZ_NAMES.get(tz) ?? tz;
}
