import { DAY } from './time';
import { tr } from '../../../i18n';

/**
 * Sesje handlu krypto (24/7) wyznaczone otwarciami trzech rynków, z czasem letnim liczonym przez Intl:
 * Azja od 09:00 w Tokio (00:00 UTC), Londyn od 08:00 czasu londyńskiego, Nowy Jork od 09:30 czasu
 * nowojorskiego (otwarcie giełdy kasowej). Każda sesja trwa do otwarcia następnej, więc doba UTC
 * dzieli się na trzy sąsiednie odcinki.
 */

export type SessionId = 'asia' | 'london' | 'ny';

export interface Session {
  id: SessionId;
  start: number;
  end: number;
}

export const SESSION_LABEL: Record<SessionId, string> = { asia: tr('Azja', 'Asia'), london: tr('Londyn', 'London'), ny: tr('Nowy Jork', 'New York') };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Przesunięcie strefy względem UTC w chwili `t` (ms; dodatnie na wschód). */
export function tzOffsetMs(tz: string, t: number): number {
  const parts = formatter(tz).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(t / 1000) * 1000;
}

/** Chwila UTC dla czasu ściennego (rok, miesiąc 1–12, dzień, godzina, minuta) w strefie `tz`. */
export function zonedToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(tz, guess);
  // Druga iteracja poprawia wynik, gdy zmiana czasu wypada między zgadnięciem a wynikiem
  return guess - tzOffsetMs(tz, first);
}

const openCache = new Map<number, [number, number, number]>();

/** Otwarcia sesji Azja, Londyn, NY w dobie UTC zaczynającej się o `dayStart`. */
export function sessionOpens(dayStart: number): [number, number, number] {
  let o = openCache.get(dayStart);
  if (!o) {
    const d = new Date(dayStart);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    o = [dayStart, zonedToUtc('Europe/London', y, mo, day, 8, 0), zonedToUtc('America/New_York', y, mo, day, 9, 30)];
    if (openCache.size > 4000) openCache.clear();
    openCache.set(dayStart, o);
  }
  return o;
}

export function utcDayStart(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

/** Poniedziałek 00:00 UTC tygodnia zawierającego `t`. */
export function utcWeekStart(t: number): number {
  const day = utcDayStart(t);
  const dow = (new Date(day).getUTCDay() + 6) % 7; // 0 = poniedziałek
  return day - dow * DAY;
}

/** Sesja zawierająca chwilę `t`. */
export function sessionAt(t: number): Session {
  const day = utcDayStart(t);
  const [asia, london, ny] = sessionOpens(day);
  if (t < london) return { id: 'asia', start: asia, end: london };
  if (t < ny) return { id: 'london', start: london, end: ny };
  return { id: 'ny', start: ny, end: day + DAY };
}

/** Kolejne sesje przecinające [from, to). */
export function sessionsBetween(from: number, to: number): Session[] {
  const out: Session[] = [];
  let s = sessionAt(from);
  while (s.start < to) {
    out.push(s);
    s = sessionAt(s.end);
  }
  return out;
}

export type ResetMode = 'none' | 'session' | 'day' | 'week';

/** Początek okresu (sesja, doba UTC, tydzień UTC), do którego należy `t`; −∞ dla trybu bez resetu. */
export function periodStart(t: number, mode: ResetMode): number {
  switch (mode) {
    case 'none':
      return Number.NEGATIVE_INFINITY;
    case 'session':
      return sessionAt(t).start;
    case 'day':
      return utcDayStart(t);
    case 'week':
      return utcWeekStart(t);
  }
}
