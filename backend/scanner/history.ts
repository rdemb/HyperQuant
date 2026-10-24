import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  HIST_HOUR_MS,
  HIST_PART_MS,
  HISTORY_VERSION,
  bookSigFigs,
  clipSpans,
  decodeBook,
  decodeTrades,
  encodeBook,
  encodeTrades,
  historyPath,
  type HistCtx,
  type HistFrame,
  type HistKind,
  type HistSpan,
  type HistTrade,
  type HistoryIndex,
} from '../../src/utils/tapeHistory.ts';
import type { HlCtx, HlTrade } from './hl.ts';
import type { BookAgg } from './liquidity.ts';

/**
 * Rejestrator historii jednego rynku: taśma (bez adresów — numery zleceń agresora i makerów w obrębie godziny),
 * arkusz w agregacji bliskiej i dalekiej (te same co na stronie) i kontekst minutowy. Bufor w pamięci tylko dla części
 * jeszcze niezamkniętych; część 5-minutowa trafia na dysk 10 s po końcu, a po zamknięciu godziny części łączą się w plik
 * godzinowy. Pokrycie: od najnowszej transakcji pierwszej wiadomości po (ponownym) połączeniu do zamknięcia połączenia —
 * luka po zerwaniu albo restarcie zostaje luką.
 */

const MIN = 60_000;
/** Część zapisujemy tyle po jej końcu (transakcje bloku mogą dojść z opóźnieniem); spóźnione bardziej — pomijane */
export const SETTLE_MS = 10_000;

const ZERO_HASH = /^0x0+$/;
const isMultiple = (px: number, step: number) => Math.abs(px / step - Math.round(px / step)) < 1e-6;
const partOf = (t: number) => Math.floor(t / HIST_PART_MS) * HIST_PART_MS;
const hourOf = (t: number) => Math.floor(t / HIST_HOUR_MS) * HIST_HOUR_MS;

function writeGz(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, gzipSync(JSON.stringify(value), { level: 9 }));
  renameSync(tmp, path);
}

function readGz(path: string): unknown {
  try {
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
  } catch {
    return null;
  }
}

/** Poziomy `l2Book` [bids, asks] → trójki [cena, wielkość, liczba zleceń]; null przy złym kształcie. */
function levelsOf(levels: unknown): [number[], number[]] | null {
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const side = (rows: unknown) => {
    const out: number[] = [];
    if (!Array.isArray(rows)) return out;
    for (const r of rows as { px?: unknown; sz?: unknown; n?: unknown }[]) {
      const px = Number(r?.px);
      const sz = Number(r?.sz);
      const n = Number(r?.n);
      if (px > 0 && sz > 0 && Number.isFinite(n)) out.push(px, sz, n);
    }
    return out;
  };
  return [side(levels[0]), side(levels[1])];
}

/** Bez duplikatów: transakcja (czas, tid), migawka (czas, krok), kontekst (minuta — późniejszy wygrywa). */
function uniqTrades(xs: readonly HistTrade[]): HistTrade[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(`${x.t}:${x.tid}`) && (seen.add(`${x.t}:${x.tid}`), true));
}
function uniqFrames(xs: readonly HistFrame[]): HistFrame[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(`${x.t}:${x.step}`) && (seen.add(`${x.t}:${x.step}`), true));
}
function uniqCtx(xs: readonly HistCtx[]): HistCtx[] {
  return [...new Map(xs.map((c) => [c.t, c])).values()];
}

interface Ids {
  orders: Map<string, number>;
  makers: Map<string, number>;
  nextO: number;
  nextM: number;
}

export class MarketRecorder {
  readonly coin: string;
  private readonly dir: string;
  private readonly trades = new Map<number, HistTrade[]>();
  private readonly frames = new Map<number, HistFrame[]>();
  private readonly ctx = new Map<number, HistCtx>();
  /** Zamknięte odcinki nagrania jeszcze potrzebne niezapisanym częściom; otwarty — od `openAt` */
  private spans: HistSpan[] = [];
  private openAt: number | null = null;
  private waitingSnapshot = false;
  private readonly ids = new Map<number, Ids>();
  /** Kroki agregacji bliskiej i dalekiej dobrane do ceny (zmiana tylko przy przejściu przez 10^k) */
  private steps: [number, number] | null = null;
  private sigFigs: { near: number; far: number } | null = null;
  /** Ostatnio zapisana część (kolejne zapisy tylko nowszych) */
  private lastPart = Number.NEGATIVE_INFINITY;

  constructor(coin: string, dir: string) {
    this.coin = coin;
    this.dir = dir;
  }

  /** Połączenie WebSocket: otwarte → pokrycie od najnowszej transakcji pierwszej wiadomości; zamknięte → koniec odcinka. */
  onState(up: boolean, at: number): void {
    if (up) {
      this.waitingSnapshot = true;
      return;
    }
    this.waitingSnapshot = false;
    if (this.openAt !== null && at > this.openAt) this.spans.push([this.openAt, at]);
    this.openAt = null;
  }

  onTrades(list: readonly HlTrade[]): void {
    let newest = Number.NEGATIVE_INFINITY;
    for (const x of list) {
      const t = Number(x.time);
      const px = Number(x.px);
      const sz = Number(x.sz);
      const tid = Number(x.tid);
      if (!(t > 0) || !(px > 0) || !(sz > 0) || !Number.isFinite(tid) || (x.side !== 'B' && x.side !== 'A')) continue;
      newest = Math.max(newest, t);
      let o = -1;
      let m = -1;
      if (Array.isArray(x.users) && x.users.length === 2) {
        const ids = this.idsFor(hourOf(t));
        const taker = x.side === 'B' ? x.users[0] : x.users[1];
        const maker = x.side === 'B' ? x.users[1] : x.users[0];
        const key = typeof x.hash === 'string' && x.hash.length > 2 && !ZERO_HASH.test(x.hash) ? `${taker}|${x.hash}` : `${taker}|t${t}|${x.side}`;
        o = ids.orders.get(key) ?? (ids.orders.set(key, ids.nextO), ids.nextO++);
        m = ids.makers.get(maker) ?? (ids.makers.set(maker, ids.nextM), ids.nextM++);
      }
      const p = partOf(t);
      if (p <= this.lastPart) continue; // część już zapisana — spóźniona transakcja pominięta
      const acc = this.trades.get(p);
      const row: HistTrade = { t, px, sz, side: x.side, tid, o, m };
      if (acc) acc.push(row);
      else this.trades.set(p, [row]);
    }
    // Pierwsza wiadomość po subskrypcji to migawka ostatnich transakcji: od najnowszej z nich taśma jest kompletna
    if (this.waitingSnapshot && newest > 0) {
      this.waitingSnapshot = false;
      this.openAt = newest;
    }
  }

  onCtx(c: HlCtx, at: number): void {
    if (!(c.markPx > 0) || !(c.oiBtc >= 0)) return;
    const minute = Math.floor(at / MIN) * MIN;
    if (Number.isFinite(c.funding)) this.ctx.set(minute, { t: minute, oi: c.oiBtc, funding: c.funding as number, mark: c.markPx });
    const sf = bookSigFigs(c.markPx);
    if (this.sigFigs && sf.near === this.sigFigs.near && sf.far === this.sigFigs.far) return;
    const digits = Math.floor(Math.log10(c.markPx)) + 1;
    this.sigFigs = sf;
    this.steps = [10 ** (digits - sf.near), 10 ** (digits - sf.far)];
  }

  /** Agregacje arkusza do subskrypcji (bliska i daleka); null przed pierwszą ceną. */
  aggs(): BookAgg[] | null {
    if (!this.sigFigs) return null;
    return [{ nSigFigs: this.sigFigs.near as BookAgg['nSigFigs'] }, { nSigFigs: this.sigFigs.far as BookAgg['nSigFigs'] }];
  }

  /** Migawka arkusza: agregacja rozpoznana po siatce cen (daleka — wszystkie ceny na siatce dalekiej); inna — pominięta. */
  onBook(t: number, levels: unknown): void {
    if (!this.steps || !(t > 0)) return;
    const lv = levelsOf(levels);
    if (!lv || (lv[0].length === 0 && lv[1].length === 0)) return;
    const prices = [...lv[0].filter((_, i) => i % 3 === 0), ...lv[1].filter((_, i) => i % 3 === 0)];
    const [near, far] = this.steps;
    const step = prices.every((px) => isMultiple(px, far)) ? far : prices.every((px) => isMultiple(px, near)) ? near : Number.NaN;
    if (!Number.isFinite(step)) return;
    const p = partOf(t);
    if (p <= this.lastPart) return;
    const acc = this.frames.get(p);
    const f: HistFrame = { t, step, bids: lv[0], asks: lv[1] };
    if (acc) acc.push(f);
    else this.frames.set(p, [f]);
  }

  /** Numery zleceń i makerów godziny; po restarcie numeracja ciągnie się od największych w zapisanych plikach godziny. */
  private idsFor(hour: number): Ids {
    let ids = this.ids.get(hour);
    if (ids) return ids;
    ids = { orders: new Map(), makers: new Map(), nextO: 0, nextM: 0 };
    const files = [historyPath(this.coin, hour, 'trades', false), ...this.partsOnDisk(hour).map((p) => historyPath(this.coin, p, 'trades', true))];
    for (const rel of files) {
      const f = decodeTrades(readGz(join(this.dir, rel)));
      for (const x of f?.trades ?? []) {
        ids.nextO = Math.max(ids.nextO, x.o + 1);
        ids.nextM = Math.max(ids.nextM, x.m + 1);
      }
    }
    this.ids.set(hour, ids);
    for (const h of this.ids.keys()) if (h < hour - HIST_HOUR_MS) this.ids.delete(h);
    return ids;
  }

  /** Części godziny zapisane na dysku (początki, rosnąco). */
  private partsOnDisk(hour: number): number[] {
    const out: number[] = [];
    for (let p = hour; p < hour + HIST_HOUR_MS; p += HIST_PART_MS) if (existsSync(join(this.dir, historyPath(this.coin, p, 'trades', true)))) out.push(p);
    return out;
  }

  /**
   * Zapis części zamkniętych co najmniej SETTLE_MS (także pustych, jeśli nagranie trwało) i łączenie godzin zamkniętych;
   * zwraca liczbę zapisanych plików.
   */
  flush(now: number): number {
    let written = 0;
    const due = partOf(now - SETTLE_MS) - HIST_PART_MS;
    const keys = new Set<number>([...this.trades.keys(), ...this.frames.keys()]);
    // Część bez transakcji i migawek, ale w trakcie nagrania (cisza na rynku) też jest zapisywana — pokrycie bez luki
    const all = this.openAt !== null ? [...this.spans, [this.openAt, now] as HistSpan] : this.spans;
    for (const [a, b] of all) for (let p = Math.max(partOf(a), this.lastPart + HIST_PART_MS); p <= due && p < b; p += HIST_PART_MS) keys.add(p);
    for (const p of [...keys].sort((a, b) => a - b)) {
      if (p > due) continue;
      const spans = clipSpans(all, p, p + HIST_PART_MS);
      const trades = this.trades.get(p) ?? [];
      const frames = this.frames.get(p) ?? [];
      this.trades.delete(p);
      this.frames.delete(p);
      if (p <= this.lastPart || (spans.length === 0 && trades.length === 0 && frames.length === 0)) continue;
      const ctx = [...this.ctx.values()].filter((c) => c.t >= p && c.t < p + HIST_PART_MS);
      // Część z poprzedniego uruchomienia (restart, migawka transakcji z zapisanej części) — scalenie zamiast nadpisania
      const tPath = join(this.dir, historyPath(this.coin, p, 'trades', true));
      const bPath = join(this.dir, historyPath(this.coin, p, 'book', true));
      const oldT = existsSync(tPath) ? decodeTrades(readGz(tPath)) : null;
      const oldB = existsSync(bPath) ? decodeBook(readGz(bPath)) : null;
      writeGz(tPath, encodeTrades(this.coin, p, p + HIST_PART_MS, [...spans, ...(oldT?.spans ?? [])], uniqTrades([...(oldT?.trades ?? []), ...trades]), uniqCtx([...(oldT?.ctx ?? []), ...ctx])));
      writeGz(bPath, encodeBook(this.coin, p, p + HIST_PART_MS, [...spans, ...(oldB?.spans ?? [])], uniqFrames([...(oldB?.frames ?? []), ...frames])));
      this.lastPart = p;
      written += 2;
    }
    for (const k of this.ctx.keys()) if (k < due) this.ctx.delete(k);
    this.spans = this.spans.filter(([, b]) => b > due);
    written += this.consolidate(now);
    return written;
  }

  /** Godziny zamknięte z częściami na dysku → plik godzinowy (scalony z istniejącym), części usunięte. */
  consolidate(now: number): number {
    let written = 0;
    const lastClosed = hourOf(now - SETTLE_MS) - HIST_HOUR_MS;
    const root = join(this.dir, this.coin);
    if (!existsSync(root)) return 0;
    const hours = new Set<number>();
    for (const day of readdirSync(root)) {
      for (const f of readdirSync(join(root, day))) {
        const m = /^(\d{2})-(\d{2})\.trades\.json\.gz$/.exec(f);
        if (!m) continue;
        const h = Date.parse(`${day}T${m[1]}:00:00Z`);
        if (Number.isFinite(h) && h <= lastClosed) hours.add(h);
      }
    }
    for (const h of [...hours].sort((a, b) => a - b)) {
      const parts = this.partsOnDisk(h);
      const read = (kind: HistKind, part: boolean, p: number) => readGz(join(this.dir, historyPath(this.coin, p, kind, part)));
      const tFiles = [read('trades', false, h), ...parts.map((p) => read('trades', true, p))].map(decodeTrades).filter((x) => x !== null);
      const bFiles = [read('book', false, h), ...parts.map((p) => read('book', true, p))].map(decodeBook).filter((x) => x !== null);
      const trades = uniqTrades(tFiles.flatMap((f) => f.trades));
      const ctx = uniqCtx(tFiles.flatMap((f) => f.ctx));
      const frames = uniqFrames(bFiles.flatMap((f) => f.frames));
      writeGz(join(this.dir, historyPath(this.coin, h, 'trades', false)), encodeTrades(this.coin, h, h + HIST_HOUR_MS, tFiles.flatMap((f) => f.spans), trades, ctx));
      writeGz(join(this.dir, historyPath(this.coin, h, 'book', false)), encodeBook(this.coin, h, h + HIST_HOUR_MS, bFiles.flatMap((f) => f.spans), frames));
      written += 2;
      for (const p of parts) for (const kind of ['trades', 'book'] as const) rmSync(join(this.dir, historyPath(this.coin, p, kind, true)), { force: true });
    }
    return written;
  }

  /** Zamknięcie (koniec procesu): otwarty odcinek domknięty, bez zapisu bieżących części (luka zamiast niepełnej części). */
  stop(at: number): void {
    this.onState(false, at);
  }
}

/** Usuwa dni starsze niż `keepDays` (pełne dni UTC przed dzisiejszym) i pliki tymczasowe po przerwanym zapisie. */
export function pruneHistory(dir: string, coins: readonly string[], keepDays: number, now: number): number {
  const cut = new Date(Math.floor(now / 86_400_000) * 86_400_000 - keepDays * 86_400_000).toISOString().slice(0, 10);
  let removed = 0;
  for (const coin of coins) {
    const root = join(dir, coin);
    if (!existsSync(root)) continue;
    for (const day of readdirSync(root)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cut) {
        rmSync(join(root, day), { recursive: true, force: true });
        removed++;
        continue;
      }
      for (const f of readdirSync(join(root, day))) if (f.endsWith('.tmp')) rmSync(join(root, day, f), { force: true });
    }
  }
  return removed;
}

/** Spis gałęzi z plików na dysku: godziny i części każdego rynku (rosnąco). */
export function historyIndex(dir: string, coins: readonly string[], keepDays: number, now: number): HistoryIndex {
  const markets: HistoryIndex['markets'] = {};
  for (const coin of coins) {
    const hours: number[] = [];
    const parts: number[] = [];
    const root = join(dir, coin);
    for (const day of existsSync(root) ? readdirSync(root).sort() : []) {
      for (const f of readdirSync(join(root, day)).sort()) {
        const m = /^(\d{2})(?:-(\d{2}))?\.trades\.json\.gz$/.exec(f);
        if (!m || !existsSync(join(root, day, f.replace('.trades.', '.book.')))) continue;
        const t = Date.parse(`${day}T${m[1]}:${m[2] ?? '00'}:00Z`);
        if (!Number.isFinite(t)) continue;
        (m[2] === undefined ? hours : parts).push(t);
      }
    }
    markets[coin] = { hours, parts };
  }
  return { v: HISTORY_VERSION, asOf: now, keepDays, partMs: HIST_PART_MS, markets };
}

export const HISTORY_README = [
  '# HyperQuant — historia taśmy i arkusza',
  '',
  'Gałąź `history` repo danych: nagranie publicznych kanałów Hyperliquid (trades, l2Book, activeAssetCtx) przez rejestrator',
  'skanera [HyperQuant](https://github.com/rdemb/HyperQuant) (katalog backend/). API Hyperliquid nie udostępnia historii taśmy',
  'ani arkusza — bez nagrania wykres miałby footprint, Deltę, CVD i mapę ciepła dopiero od otwarcia strony.',
  '',
  '- `index.json` — spis: godziny z plikiem godzinowym i części 5-minutowe bieżącej godziny dla każdego rynku.',
  '- `<RYNEK>/<RRRR-MM-DD>/<GG>.trades.json.gz` — taśma godziny (JSON w gzip): czas i tid różnicowo, cena, wielkość, strona',
  '  agresora (B/A), numer zlecenia agresora i makera w obrębie godziny; kontekst minutowy (OI, finansowanie, mark); pokrycie.',
  '- `<RYNEK>/<RRRR-MM-DD>/<GG>.book.json.gz` — migawki arkusza (co ok. 5 s, 20 poziomów na stronę: cena, wielkość, liczba',
  '  zleceń) w agregacji bliskiej (~2 pb ceny) i dalekiej (10 × większy krok); pokrycie.',
  '- `<GG>-<MM>.*.json.gz` — części 5-minutowe godziny w toku (po jej zamknięciu łączone w plik godzinowy).',
  '',
  'Pokrycie (`spans`) to odcinki ciągłego nagrania: luka po zerwaniu połączenia albo restarcie zostaje jawną luką.',
  'Bez adresów portfeli i hashy transakcji. Gałąź zawiera jeden commit z oknem ostatnich dni (starsze dni są usuwane).',
  'Format i odczyt: src/utils/tapeHistory.ts w repo HyperQuant.',
  '',
].join('\n');
