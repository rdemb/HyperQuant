/**
 * Tematy publiczne 24/7 (usługa hyperquant-tematy): jawny katalog warunków BTC liczony na serwerze i publikowany do
 * tematów ntfy. Te same zasady co strażnicy w przeglądarce (src/shell/wyspa/straznicy.ts): zdarzenie przy przecięciu
 * poziomu albo wejściu ponad próg, przerwa 10 min na temat. Katalog skalibrowany na 60 dniach (0,5–5 zdarzeń na dobę):
 * PDH ok. 3,4, PDL ok. 2,7, otwarcia Londynu i Nowego Jorku 2, ruch ≥ 1% w 15 min ok. 1,1. Do tego twardy limit na
 * dobę UTC na temat (ochrona subskrybentów przed zalewem). Treść: opis stanu rynku po polsku i angielsku, bez kierunku,
 * bez porady. Czyste funkcje: czas i dane w argumentach.
 */

export type TopicId = 'pdh' | 'pdl' | 'sesje' | 'ruch';

export const TOPICS: readonly TopicId[] = ['pdh', 'pdl', 'sesje', 'ruch'];
/** Próg ruchu w 15 min, % (kalibracja: ok. 1,1 zdarzenia na dobę). */
export const MOVE_PCT = 1;
export const COOLDOWN_MS = 10 * 60_000;
/** Najwięcej zdarzeń jednego tematu w dobie UTC. */
export const DAY_CAP = 8;
const DAY = 86_400_000;

export interface Snap {
  at: number;
  price: number;
  /** Szczyt i dołek poprzedniej doby UTC */
  pdh: number | null;
  pdl: number | null;
  /** Ruch ceny w ostatnich 15 min, % bez znaku */
  move15: number | null;
}

export interface TopicState {
  prev: Snap | null;
  last: Partial<Record<TopicId, number>>;
  /** Licznik zdarzeń w bieżącej dobie UTC: [doba, liczba] */
  count: Partial<Record<TopicId, [number, number]>>;
}

export interface TopicEvent {
  topic: TopicId;
  title: string;
  message: string;
  tags: string;
}

export const emptyState = (): TopicState => ({ prev: null, last: {}, count: {} });

const crossed = (a: number, b: number, lv: number) => (a < lv && b >= lv) || (a > lv && b <= lv);
const fmt = (v: number) => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');

/** Chwila UTC dla czasu ściennego w strefie (Intl, z czasem letnim). */
function zoned(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
  };
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - off(guess - off(guess));
}

/** Otwarcia Londynu (08:00 Londyn) i Nowego Jorku (09:30 NY) w dobie UTC zawierającej `t`. */
export function opensOf(t: number): { london: number; ny: number } {
  const d = new Date(Math.floor(t / DAY) * DAY);
  const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return { london: zoned('Europe/London', y, mo, day, 8, 0), ny: zoned('America/New_York', y, mo, day, 9, 30) };
}

/** Zdarzenia między poprzednią a bieżącą migawką; zwraca też nowy stan (przerwy i liczniki). */
export function evaluate(state: TopicState, cur: Snap): { events: TopicEvent[]; state: TopicState } {
  const prev = state.prev;
  const next: TopicState = { prev: cur, last: { ...state.last }, count: { ...state.count } };
  const events: TopicEvent[] = [];
  if (!prev || cur.at - prev.at > 10 * 60_000) return { events, state: next }; // po przerwie w danych bez zaległych zdarzeń
  const today = Math.floor(cur.at / DAY);
  const push = (topic: TopicId, title: string, message: string, tags: string) => {
    const last = next.last[topic];
    if (last !== undefined && cur.at - last < COOLDOWN_MS) return;
    const c = next.count[topic];
    const n = c && c[0] === today ? c[1] : 0;
    if (n >= DAY_CAP) return;
    next.last[topic] = cur.at;
    next.count[topic] = [today, n + 1];
    events.push({ topic, title, message, tags });
  };
  const now = `${fmt(cur.price)} USD`;
  if (cur.pdh !== null && crossed(prev.price, cur.price, cur.pdh))
    push('pdh', `BTC: PDH ${fmt(cur.pdh)}`, `Cena przecięła wczorajszy szczyt (PDH ${fmt(cur.pdh)}), teraz ${now}. · Price crossed yesterday's high (PDH), now ${now}.`, 'straight_ruler');
  if (cur.pdl !== null && crossed(prev.price, cur.price, cur.pdl))
    push('pdl', `BTC: PDL ${fmt(cur.pdl)}`, `Cena przecięła wczorajszy dołek (PDL ${fmt(cur.pdl)}), teraz ${now}. · Price crossed yesterday's low (PDL), now ${now}.`, 'straight_ruler');
  const o = opensOf(cur.at);
  for (const [at, pl, en] of [
    [o.london, 'Londynu', 'London'],
    [o.ny, 'Nowego Jorku', 'New York'],
  ] as const) {
    if (prev.at < at && cur.at >= at) push('sesje', `BTC: ${en} open`, `Otwarcie sesji ${pl}, BTC ${now}. · ${en} session open, BTC ${now}.`, 'bell');
  }
  if (cur.move15 !== null && cur.move15 >= MOVE_PCT && !(prev.move15 !== null && prev.move15 >= MOVE_PCT)) {
    const m = cur.move15.toFixed(2);
    push('ruch', `BTC: ${m}% / 15 min`, `Ruch ceny ${m}% w 15 minut, teraz ${now}. · A ${m}% price move in 15 minutes, now ${now}.`, 'zap');
  }
  return { events, state: next };
}

/** Migawka ze świec 1m (rosnąco) i dobowych: cena, PDH/PDL poprzedniej doby UTC, ruch od zamknięcia sprzed 15 min. */
export function snapFrom(at: number, m1: { t: number; c: number }[], d1: { t: number; h: number; l: number }[]): Snap | null {
  if (m1.length === 0) return null;
  const price = m1[m1.length - 1].c;
  const ref = [...m1].reverse().find((b) => b.t <= at - 15 * 60_000);
  const yday = Math.floor(at / DAY) * DAY - DAY;
  const pd = d1.find((b) => b.t === yday);
  return { at, price, pdh: pd ? pd.h : null, pdl: pd ? pd.l : null, move15: ref && ref.c > 0 ? (Math.abs(price - ref.c) / ref.c) * 100 : null };
}
