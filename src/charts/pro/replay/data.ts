import { HIST_HOUR_MS, HIST_PART_MS, type HistSpan, type HistoryIndex, clipSpans, decodeBook, decodeTrades, historyPath, isHistoryIndex } from '../../../utils/tapeHistory';
import type { BookFrame } from '../core/book';
import { barStart } from '../core/time';
import type { Candle, Fill } from '../hl/parse';
import { type Fetcher, gzJson, toBookFrame, toFills } from '../store/serverHistory';

/**
 * Nagranie do powtórki: pliki godzin (a w godzinie bez pliku godzinowego — jej części 5-minutowe) z gałęzi historii
 * serwera albo z kopii przy lekcjach, w formacie historii ostatniej doby (src/utils/tapeHistory.ts), złożone w jedną taśmę,
 * migawki arkusza i otwarte pozycje rosnąco po czasie.
 */

export interface ReplayData {
  coin: string;
  /** Odcinki ciągłego nagrania. */
  spans: HistSpan[];
  fills: Fill[];
  frames: BookFrame[];
  /** [czas, otwarte pozycje] co minutę. */
  oi: [number, number][];
}

/** Plik godziny albo części. */
export interface ReplayUnit {
  start: number;
  part: boolean;
}

const hourOf = (t: number) => Math.floor(t / HIST_HOUR_MS) * HIST_HOUR_MS;

/** Zakres nagrania rynku w spisie: od pierwszej godziny albo części do końca ostatniej; null bez nagrania. */
export function recordedRange(index: HistoryIndex, coin: string): { from: number; to: number } | null {
  const m = index.markets[coin];
  if (!m) return null;
  const starts = [...m.hours, ...m.parts];
  if (starts.length === 0) return null;
  const lastPart = m.parts.length > 0 ? Math.max(...m.parts) + HIST_PART_MS : Number.NEGATIVE_INFINITY;
  const lastHour = m.hours.length > 0 ? Math.max(...m.hours) + HIST_HOUR_MS : Number.NEGATIVE_INFINITY;
  return { from: Math.min(...starts), to: Math.max(lastPart, lastHour) };
}

/** Pliki z zakresu [from, to), rosnąco: godzina z pliku godzinowego, a bez niego jej części ze spisu. */
export function replayUnits(index: HistoryIndex, coin: string, from: number, to: number): ReplayUnit[] {
  const m = index.markets[coin];
  if (!m || !(to > from)) return [];
  const hours = new Set(m.hours);
  const out: ReplayUnit[] = [];
  for (let h = hourOf(from); h < to; h += HIST_HOUR_MS) {
    if (hours.has(h)) out.push({ start: h, part: false });
    else for (const p of [...m.parts].sort((a, b) => a - b)) if (p >= h && p < h + HIST_HOUR_MS && p + HIST_PART_MS > from && p < to) out.push({ start: p, part: true });
  }
  return out;
}

/** Spis nagrań; null bez spisu albo w złym formacie. */
export async function fetchIndex(base: string, fetcher: Fetcher): Promise<HistoryIndex | null> {
  try {
    const res = await fetcher(`${base}/index.json`);
    const j: unknown = res.ok ? await res.json() : null;
    return isHistoryIndex(j) ? j : null;
  } catch {
    return null;
  }
}

async function fetchGz(fetcher: Fetcher, url: string): Promise<unknown> {
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    return await gzJson(res);
  } catch {
    return null;
  }
}

/** Sklejone pliki: taśma, migawki i otwarte pozycje rosnąco po czasie (pliki są rozłączne i ułożone po kolei). */
export function joinUnits(coin: string, parts: readonly { unit: ReplayUnit; trades: unknown; book: unknown }[]): ReplayData {
  const out: ReplayData = { coin, spans: [], fills: [], frames: [], oi: [] };
  for (const { unit, trades, book } of parts) {
    const t = decodeTrades(trades);
    if (t && t.coin === coin) {
      out.spans.push(...t.spans);
      for (const f of toFills(t.trades, hourOf(unit.start))) out.fills.push(f);
      for (const c of t.ctx) out.oi.push([c.t, c.oi]);
    }
    const b = decodeBook(book);
    if (b && b.coin === coin) for (const f of b.frames) out.frames.push(toBookFrame(f));
  }
  out.fills.sort((a, b) => a.time - b.time);
  out.frames.sort((a, b) => a.t - b.t);
  out.oi.sort((a, b) => a[0] - b[0]);
  return out;
}

/** Nagranie przycięte do [from, to) — pliki zaczynają się od pełnej godziny albo części. */
export function clipReplay(d: ReplayData, from: number, to: number): ReplayData {
  const inside = (t: number) => t >= from && t < to;
  return {
    coin: d.coin,
    spans: clipSpans(d.spans, from, to),
    fills: d.fills.filter((f) => inside(f.time)),
    frames: d.frames.filter((f) => inside(f.t)),
    oi: d.oi.filter(([t]) => inside(t)),
  };
}

/** Wczytuje pliki zakresu (po kilka naraz) i przycina je do zakresu; `onProgress(gotowe, wszystkie)` po każdym pliku. */
export async function loadReplay(
  base: string,
  index: HistoryIndex,
  coin: string,
  from: number,
  to: number,
  fetcher: Fetcher,
  onProgress: (done: number, total: number) => void
): Promise<ReplayData> {
  const units = replayUnits(index, coin, from, to);
  const got: { unit: ReplayUnit; trades: unknown; book: unknown }[] = new Array(units.length);
  let next = 0;
  let done = 0;
  onProgress(0, units.length);
  const worker = async () => {
    while (next < units.length) {
      const i = next++;
      const u = units[i];
      const [trades, book] = await Promise.all([
        fetchGz(fetcher, `${base}/${historyPath(coin, u.start, 'trades', u.part)}`),
        fetchGz(fetcher, `${base}/${historyPath(coin, u.start, 'book', u.part)}`),
      ]);
      got[i] = { unit: u, trades, book };
      onProgress(++done, units.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, units.length) }, worker));
  return clipReplay(joinUnits(coin, got), from, to);
}

/**
 * Świece z API uzupełnione świecami z taśmy nagrania tam, gdzie API ich nie ma: Hyperliquid trzyma ok. 5000 świec na
 * interwał (1m — ok. 3,5 dnia), więc starsze nagranie zostałoby bez świec. Świeca z taśmy: OHLC, wolumen i liczba
 * transakcji z wypełnień w [from, to).
 */
export function withTapeCandles(api: readonly Candle[], fills: readonly Fill[], ms: number, from: number, to: number): Candle[] {
  const have = new Set(api.map((c) => c.t));
  const made: Candle[] = [];
  let cur: Candle | null = null;
  for (const f of fills) {
    if (f.time < from || f.time >= to) continue;
    const t = barStart(f.time, ms);
    if (have.has(t)) continue;
    if (!cur || cur.t !== t) {
      cur = { t, o: f.px, h: f.px, l: f.px, c: f.px, v: 0, n: 0 };
      made.push(cur);
    }
    cur.h = Math.max(cur.h, f.px);
    cur.l = Math.min(cur.l, f.px);
    cur.c = f.px;
    cur.v += f.sz;
    cur.n++;
  }
  return made.length === 0 ? [...api] : [...api, ...made].sort((a, b) => a.t - b.t);
}
