/**
 * Historia taśmy i arkusza rynków Hyperliquid nagrywana przez serwer — format plików współdzielony przez rejestrator
 * i stronę (bez importów zewnętrznych; uruchamiany także natywnie przez Node 24).
 *
 * Publiczne API nie daje historii transakcji ani arkusza, więc rejestrator nagrywa je na serwerze i publikuje w gałęzi
 * `history` repo danych: części 5-minutowe bieżącej godziny, łączone po jej zamknięciu w plik godzinowy (JSON w gzip).
 * Pliki nie zawierają adresów ani hashy: zlecenie agresora, biorca i maker to numery ważne tylko w obrębie jednej godziny
 * (`o`, `k`, `m`) — wystarczą do złożenia zleceń, serii i ścian, a nie da się z nich odczytać portfela.
 */

export const HISTORY_VERSION = 1;
export const HIST_PART_MS = 5 * 60_000;
export const HIST_HOUR_MS = 60 * 60_000;

/** Odcinek ciągłego nagrania [początek, koniec) w zegarze giełdy (ms). */
export type HistSpan = [number, number];

export interface HistTrade {
  t: number;
  px: number;
  sz: number;
  /** B = agresywne kupno, A = agresywna sprzedaż (jak w API) */
  side: 'B' | 'A';
  tid: number;
  /** Numer zlecenia agresora w godzinie (ten sam biorca i hash albo milisekunda bez hasha); −1 = nieznany */
  o: number;
  /** Numer biorcy i makera w godzinie; −1 = nieznany */
  k: number;
  m: number;
  /** Hash zerowy (m.in. podzlecenia TWAP) */
  z?: true;
}

/** Kontekst rynku na koniec minuty: open interest (jednostki rynku), finansowanie za godzinę, cena mark. */
export interface HistCtx {
  t: number;
  oi: number;
  funding: number;
  mark: number;
}

/** Migawka arkusza w jednej agregacji: poziomy jako trójki [cena, wielkość, liczba zleceń], bidy malejąco, aski rosnąco. */
export interface HistFrame {
  t: number;
  step: number;
  bids: number[];
  asks: number[];
  /** Arkusz bez agregacji ceny (krok = najmniejszy odstęp cen w migawce). */
  exact?: true;
}

/** Plik taśmy: kolumny transakcji (czas i tid różnicowo — pierwszy bezwzględnie), kontekst minutowy, pokrycie. */
export interface TradesFile {
  v: number;
  coin: string;
  from: number;
  to: number;
  spans: HistSpan[];
  t: number[];
  px: number[];
  sz: number[];
  side: string;
  tid: number[];
  o: number[];
  k: number[];
  m: number[];
  /** Indeksy transakcji z hashem zerowym (różnicowo); brak kolumny — plik sprzed jej wprowadzenia albo scalony z takim. */
  z?: number[];
  ctx: { t: number[]; oi: number[]; funding: number[]; mark: number[] };
}

/**
 * Plik arkusza: migawki [czas, krok, bidy, aski] i pokrycie; migawka arkusza dokładnego ma piąty element 1 (starszy odczyt
 * wymaga dokładnie czterech, więc ją pomija).
 */
export interface BookFile {
  v: number;
  coin: string;
  from: number;
  to: number;
  spans: HistSpan[];
  frames: ([number, number, number[], number[]] | [number, number, number[], number[], 1])[];
}

/** Spis gałęzi: godziny z plikiem godzinowym i części godzin jeszcze niepołączonych, dla każdego rynku. */
export interface HistoryIndex {
  v: number;
  asOf: number;
  keepDays: number;
  partMs: number;
  markets: Record<string, { hours: number[]; parts: number[] }>;
}

export type HistKind = 'trades' | 'book';

const pad = (x: number) => String(x).padStart(2, '0');

/** Ścieżka pliku w gałęzi: `BTC/2026-10-24/13.trades.json.gz` (godzina) albo `BTC/2026-10-24/13-05.trades.json.gz` (część). */
export function historyPath(coin: string, start: number, kind: HistKind, part: boolean): string {
  const d = new Date(start);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${coin}/${day}/${pad(d.getUTCHours())}${part ? `-${pad(d.getUTCMinutes())}` : ''}.${kind}.json.gz`;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const finArr = (x: unknown, n?: number): x is number[] => Array.isArray(x) && (n === undefined || x.length === n) && x.every(fin);

const deltas = (xs: readonly number[]) => xs.map((x, i) => (i === 0 ? x : x - xs[i - 1]));
const undelta = (xs: readonly number[]) => {
  const out = new Array<number>(xs.length);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) out[i] = acc = i === 0 ? xs[0] : acc + xs[i];
  return out;
};

/** Odcinki scalone (nakładające się i stykające), przycięte do [from, to), rosnąco. */
export function clipSpans(spans: readonly HistSpan[], from: number, to: number): HistSpan[] {
  const xs = spans
    .map(([a, b]): HistSpan => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: HistSpan[] = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `zeroKnown` — wszystkie transakcje mają oznaczony hash zerowy (inaczej plik bez kolumny `z`). */
export function encodeTrades(coin: string, from: number, to: number, spans: readonly HistSpan[], trades: readonly HistTrade[], ctx: readonly HistCtx[], zeroKnown = true): TradesFile {
  const ts = [...trades].sort((a, b) => a.t - b.t);
  const cs = [...ctx].sort((a, b) => a.t - b.t);
  const file: TradesFile = {
    v: HISTORY_VERSION,
    coin,
    from,
    to,
    spans: clipSpans(spans, from, to),
    t: deltas(ts.map((x) => x.t)),
    px: ts.map((x) => x.px),
    sz: ts.map((x) => x.sz),
    side: ts.map((x) => x.side).join(''),
    tid: deltas(ts.map((x) => x.tid)),
    o: ts.map((x) => x.o),
    k: ts.map((x) => x.k),
    m: ts.map((x) => x.m),
    ctx: { t: cs.map((c) => c.t), oi: cs.map((c) => c.oi), funding: cs.map((c) => c.funding), mark: cs.map((c) => c.mark) },
  };
  if (zeroKnown) file.z = deltas(ts.flatMap((x, i) => (x.z ? [i] : [])));
  return file;
}

/**
 * Odczyt pliku taśmy; zły kształt albo wersja → null (cały plik — kolumny muszą się zgadzać co do długości).
 * `zeroKnown` — plik ma kolumnę hashy zerowych (transakcje bez `z` na pewno mają inny hash).
 */
export function decodeTrades(raw: unknown): { coin: string; from: number; to: number; spans: HistSpan[]; trades: HistTrade[]; ctx: HistCtx[]; zeroKnown: boolean } | null {
  const f = raw as Partial<TradesFile> | null;
  if (!f || f.v !== HISTORY_VERSION || typeof f.coin !== 'string' || !fin(f.from) || !fin(f.to) || !Array.isArray(f.spans)) return null;
  const n = Array.isArray(f.t) ? f.t.length : -1;
  if (!finArr(f.t) || !finArr(f.px, n) || !finArr(f.sz, n) || !finArr(f.tid, n) || !finArr(f.o, n) || !finArr(f.k, n) || !finArr(f.m, n)) return null;
  if (typeof f.side !== 'string' || f.side.length !== n || !/^[AB]*$/.test(f.side)) return null;
  const c = f.ctx;
  const k = Array.isArray(c?.t) ? c.t.length : -1;
  if (!c || !finArr(c.t) || !finArr(c.oi, k) || !finArr(c.funding, k) || !finArr(c.mark, k)) return null;
  // Kolumna hashy zerowych: indeksy transakcji rosnąco
  const zero = f.z === undefined ? null : finArr(f.z) ? undelta(f.z) : [Number.NaN];
  if (zero && !zero.every((x, i) => Number.isInteger(x) && x >= 0 && x < n && (i === 0 || x > zero[i - 1]))) return null;
  const spans = f.spans.filter((s): s is HistSpan => finArr(s, 2) && s[1] > s[0]);
  const t = undelta(f.t);
  const tid = undelta(f.tid);
  const trades: HistTrade[] = [];
  for (let i = 0, j = 0; i < n; i++) {
    const z = zero !== null && zero[j] === i;
    if (z) j++;
    if (!(f.px[i] > 0) || !(f.sz[i] > 0)) continue;
    const x: HistTrade = { t: t[i], px: f.px[i], sz: f.sz[i], side: f.side[i] as 'B' | 'A', tid: tid[i], o: f.o[i], k: f.k[i], m: f.m[i] };
    if (z) x.z = true;
    trades.push(x);
  }
  const ctx: HistCtx[] = c.t.map((tt, i) => ({ t: tt, oi: c.oi[i], funding: c.funding[i], mark: c.mark[i] }));
  return { coin: f.coin, from: f.from, to: f.to, spans: clipSpans(spans, f.from, f.to), trades, ctx, zeroKnown: zero !== null };
}

export function encodeBook(coin: string, from: number, to: number, spans: readonly HistSpan[], frames: readonly HistFrame[]): BookFile {
  const fs = [...frames].sort((a, b) => a.t - b.t);
  return { v: HISTORY_VERSION, coin, from, to, spans: clipSpans(spans, from, to), frames: fs.map((x) => (x.exact ? [x.t, x.step, x.bids, x.asks, 1] : [x.t, x.step, x.bids, x.asks])) };
}

/** Odczyt pliku arkusza; zły kształt albo wersja → null, pojedyncza zła migawka pomijana. */
export function decodeBook(raw: unknown): { coin: string; from: number; to: number; spans: HistSpan[]; frames: HistFrame[] } | null {
  const f = raw as Partial<BookFile> | null;
  if (!f || f.v !== HISTORY_VERSION || typeof f.coin !== 'string' || !fin(f.from) || !fin(f.to) || !Array.isArray(f.spans) || !Array.isArray(f.frames)) return null;
  const spans = f.spans.filter((s): s is HistSpan => finArr(s, 2) && s[1] > s[0]);
  const levels = (x: unknown): x is number[] => finArr(x) && x.length % 3 === 0;
  const frames: HistFrame[] = [];
  for (const fr of f.frames as unknown[]) {
    if (!Array.isArray(fr) || !(fr.length === 4 || (fr.length === 5 && fr[4] === 1)) || !fin(fr[0]) || !(fr[1] > 0) || !levels(fr[2]) || !levels(fr[3])) continue;
    frames.push({ t: fr[0], step: fr[1], bids: fr[2], asks: fr[3], ...(fr.length === 5 ? { exact: true as const } : {}) });
  }
  return { coin: f.coin, from: f.from, to: f.to, spans: clipSpans(spans, f.from, f.to), frames };
}

export function isHistoryIndex(x: unknown): x is HistoryIndex {
  const o = x as Partial<HistoryIndex> | null;
  if (!o || o.v !== HISTORY_VERSION || !fin(o.asOf) || !fin(o.partMs) || !o.markets || typeof o.markets !== 'object') return false;
  return Object.values(o.markets).every((m) => !!m && finArr(m.hours) && finArr(m.parts));
}

/**
 * Cyfry znaczące l2Book: krok arkusza bliskiego najbliższy 2 pb ceny (BTC 75 000 → 10 USD, ETH 2 800 → 1,
 * SOL 195 → 0,1, HYPE 37 → 0,01), dalekiego — dziesięć razy większy. Rejestrator nagrywa te same agregacje co strona.
 */
export function bookSigFigs(price: number): { near: number; far: number } {
  const digits = Math.floor(Math.log10(price)) + 1;
  const near = Math.min(5, Math.max(2, digits - Math.round(Math.log10(price * 2e-4))));
  return { near, far: Math.max(2, near - 1) };
}

/** Krok migawki: najmniejsza różnica sąsiednich cen po jednej stronie, zaokrąglona do potęgi 10; NaN bez dwóch poziomów. */
export function levelsStep(bids: readonly number[], asks: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const side of [bids, asks]) {
    for (let i = 3; i < side.length; i += 3) {
      const d = Math.abs(side[i] - side[i - 3]);
      if (d > 0 && d < min) min = d;
    }
  }
  return Number.isFinite(min) ? 10 ** Math.round(Math.log10(min)) : Number.NaN;
}
