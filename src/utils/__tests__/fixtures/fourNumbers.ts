/** Wspólne dane testów Czwórki (utils/fourNumbers i views/before/fourInputs). */
import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { VBar } from '../../auction';
import type { FourInputs } from '../../fourNumbers';
import { DEFAULT_MARKETS } from '../../marketRegistry';
import type { LiqMap } from '../../liqMap';
import { tradeSessionOn } from '../../sessionDay';

export const MIN = 60_000;
export const H = 60 * MIN;
export const DAY = 24 * H;
export const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 7.11.2026 06:30 UTC, sesja azjatycka (czas zimowy w Londynie i NY: Londyn od 08:00 UTC, NY od 14:30 UTC) */
export const NOW = at(2026, 11, 7, 6, 30);
export const NY = tradeSessionOn(at(2026, 11, 6, 0), 'ny');

/**
 * Cena w minucie 6.11: do otwarcia NY płasko 99 600; IB NY 100 005 i 100 295 (IB 100 000–100 300), od 15:30 wybicie
 * w górę (100 500), od 18:30 szczyt 100 995 (high 101 000), w ostatniej godzinie zamknięcie 100 950 — dzień trendowy
 * (zakres 1000 = 3,3× IB, zamknięcie w górnych 20%). Po sesji (Azja 7.11) 100 950.
 */
export const px = (t: number): number => {
  if (t < NY.start) return 99_600;
  if (t < NY.start + 30 * MIN) return 100_005;
  if (t < NY.ibEnd) return 100_295;
  if (t < NY.start + 4 * H) return 100_500;
  if (t < NY.end - H) return 100_995;
  return 100_950;
};
export const bars = (from: number, to: number, f: (t: number) => number = px): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += MIN) out.push({ time: t, open: f(t), high: f(t) + 5, low: f(t) - 5, close: f(t), volume: 1 });
  return out;
};
export const ALL = bars(at(2026, 11, 6, 7), NOW + MIN);

export const PUB = at(2026, 11, 6, 7, 5) + 20_000;
/** Mapa dnia 6.11: dotknięte 99 600 (07:06) i 100 300 (IB NY); 100 800 i 102 000 nie. */
export const DAY_MAP: BlogMap = {
  id: '2026-11-06-mapa-dnia',
  title: 'BTC przed Londynem',
  kind: 'dzien',
  publishedAt: PUB,
  price: 99_600,
  levels: [
    { label: 'Cena wpisu', price: 99_600 },
    { label: 'Szczyt Azji', price: 100_300 },
    { label: 'Luka', price: 100_800 },
    { label: 'VAH tygodnia', price: 102_000 },
  ],
  url: 'blog/2026-11-06-mapa-dnia/',
};
export const NY_MAP: BlogMap = { ...DAY_MAP, id: '2026-11-06-przed-ny', title: 'BTC przed NY', kind: 'ny', publishedAt: at(2026, 11, 6, 13), levels: [{ label: 'X', price: 103_000 }] };
export const READY: BlogMapsState = { status: 'ready', maps: [NY_MAP, DAY_MAP] };

export const LIQ_MAP: LiqMap = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 30_000,
  markPx: 100_000,
  stepUsd: 100,
  // Środki kubełków longów: 98 950 (poza 1%), 99 050 i 99 850 (pod ceną)
  longs: [
    { px: 98_900, ntlUsd: 9e6, n: 5 },
    { px: 99_000, ntlUsd: 1e6, n: 4 },
    { px: 99_800, ntlUsd: 2e6, n: 6 },
  ],
  // Środki kubełków shortów: 99 950 (pod ceną — strona mapy nie ma znaczenia), 100 050 i 100 950 (nad), 101 050 (poza 1%)
  shorts: [
    { px: 99_900, ntlUsd: 5e5, n: 3 },
    { px: 100_000, ntlUsd: 3e6, n: 7 },
    { px: 100_900, ntlUsd: 4e5, n: 3 },
    { px: 101_000, ntlUsd: 8e6, n: 9 },
  ],
  coverage: { positions: 100, addresses: 80, scannedBtc: 1000, longBtc: 500, shortBtc: 500, wrongSide: 0, oiBtc: 2000, share: 0.25 },
  ageMin: { p50: 3, p90: 8, ntlP50: 4 },
  ctxAt: NOW - 30_000,
  method: 'hl-clearinghouse-v1',
};

export const inputs = (patch: Partial<FourInputs> = {}): FourInputs => ({
  coin: 'BTC',
  markets: DEFAULT_MARKETS,
  now: NOW,
  price: 100_000,
  bars1m: ALL,
  maps: READY,
  liq: { status: 'ready', map: LIQ_MAP },
  bars1h: undefined,
  dayVwap: undefined,
  ...patch,
});

/**
 * Zakres high − low świecy 1h według godziny sesji jej doby: godzina otwarcia NY 500, godziny Londynu 100 + 50·k (k — pełne
 * godziny od otwarcia Londynu), reszta 1000. Przez zmianę czasu (Londyn 25.10, NY 1.11) ta sama godzina sesji ma ten sam zakres.
 */
export const sessionRange = (t: number): number => {
  const day = Math.floor(t / DAY) * DAY;
  const l = tradeSessionOn(day, 'london');
  const n = tradeSessionOn(day, 'ny');
  if (t === Math.floor(n.start / H) * H) return 500;
  if (t >= l.start && t < l.end) return 100 + 50 * ((t - l.start) / H);
  return 1000;
};
/** Świece 1h od `from` do `to` z zakresem `range(t)` wokół 100 000. */
export const hours = (from: number, to: number, range: (t: number) => number = sessionRange): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += H) out.push({ time: t, open: 100_000, high: 100_000 + range(t) / 2, low: 100_000 - range(t) / 2, close: 100_000, volume: 1 });
  return out;
};
