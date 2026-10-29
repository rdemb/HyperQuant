import { ALERT_INTERVALS, MAX_CLOSES, defaultDir } from '../../../utils/alertRules';
import { MARKETS } from '../store/proStore';
import { NOTE_MAX, type PriceAlert, newAlert, windowOf } from './alerts';

/**
 * Link z gotowym zestawem alarmów (np. z planu sesji): `#charts?alarm=1.<base64url JSON>`. Strona pokazuje zestaw
 * i dodaje go dopiero po potwierdzeniu; poziomy są tylko w linku, strona nigdzie ich nie wysyła.
 *
 * Wpis: c rynek, p poziom, k warunek ('t' dotknięcie, 'c' zamknięcie, 'r' powrót), d kierunek (1 nad / −1 pod; przy
 * dotknięciu z ceny w chwili dodania), i interwał świecy, n zamknięcia z rzędu, x 1 = filtr delty, f i u okno HH:MM
 * (czas lokalny), g znacznik pary, a numer wpisu (od 0), po którego uruchomieniu alarm startuje, o opis.
 */
export interface LinkAlarm {
  c: string;
  p: number;
  k: 't' | 'c' | 'r';
  d?: 1 | -1;
  i?: string;
  n?: number;
  x?: 0 | 1;
  f?: string;
  u?: string;
  g?: string;
  a?: number;
  o?: string;
}

const VERSION = '1.';
/** Najwięcej alarmów w jednym linku. */
export const LINK_MAX = 20;
const KIND = { t: 'touch', c: 'close', r: 'reclaim' } as const;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

const toB64 = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64 = (s: string): string => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));

/** Wartość parametru `alarm` dla zestawu. */
export function alarmParam(list: readonly LinkAlarm[]): string {
  return VERSION + toB64(JSON.stringify(list));
}

/** Zestaw z adresu strony; null bez parametru albo przy jakimkolwiek błędnym wpisie (plan albo cały, albo wcale). */
export function parseAlarmLink(hash: string): LinkAlarm[] | null {
  if (!hash.startsWith('#charts')) return null;
  const raw = new URLSearchParams(hash.split('?')[1] ?? '').get('alarm');
  if (!raw?.startsWith(VERSION)) return null;
  let data: unknown;
  try {
    data = JSON.parse(fromB64(raw.slice(VERSION.length)));
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > LINK_MAX) return null;
  const out: LinkAlarm[] = [];
  for (const [idx, v] of data.entries()) {
    const e = v as Partial<LinkAlarm> | null;
    if (!e || !(MARKETS as readonly string[]).includes(e.c ?? '') || !(typeof e.p === 'number' && e.p > 0) || !(e.k === 't' || e.k === 'c' || e.k === 'r')) return null;
    if (e.k !== 't' && e.d !== 1 && e.d !== -1) return null;
    if (e.i !== undefined && !(ALERT_INTERVALS as readonly string[]).includes(e.i)) return null;
    if (e.n !== undefined && !(Number.isInteger(e.n) && e.n >= 1 && e.n <= MAX_CLOSES)) return null;
    if ((e.f !== undefined && !HM.test(e.f)) || (e.u !== undefined && !HM.test(e.u))) return null;
    if (e.a !== undefined && !(Number.isInteger(e.a) && e.a >= 0 && e.a < data.length && e.a !== idx)) return null;
    if ((e.g !== undefined && typeof e.g !== 'string') || (e.o !== undefined && typeof e.o !== 'string')) return null;
    out.push({ ...e, c: e.c as string, p: e.p, k: e.k });
  }
  return out;
}

/**
 * Alarmy z zestawu: kierunek dotknięcia z ceny rynku (`priceOf`, 0 = nieznana → z linku), okno z godzin w czasie
 * lokalnym, pary i łańcuchy z numerów wpisów. `serverNow` — zegar giełdy (start alarmów), `localNow` — zegar przeglądarki.
 */
export function linkAlerts(list: readonly LinkAlarm[], priceOf: (coin: string) => number, serverNow: number, localNow: number): PriceAlert[] {
  const tag = serverNow.toString(36);
  const made = list.map((e) => {
    const kind = KIND[e.k];
    const px = priceOf(e.c);
    const [from, until] = windowOf(e.f ?? '', e.u ?? '', localNow);
    return newAlert(
      {
        coin: e.c,
        price: e.p,
        kind,
        dir: kind === 'touch' && px > 0 ? defaultDir('touch', e.p, px) : (e.d ?? 1),
        iv: e.i ?? '15m',
        closes: e.n ?? 1,
        delta: e.x === 1,
        from,
        until,
        pair: e.g ? `${e.g}.${tag}` : '',
        note: (e.o ?? '').slice(0, NOTE_MAX),
        after: '',
      },
      serverNow
    );
  });
  return made.map((a, i) => (list[i].a !== undefined ? { ...a, after: made[list[i].a as number].id } : a));
}
