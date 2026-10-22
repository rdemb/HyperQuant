import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InfoClient } from './liqDetect.ts';

/**
 * Archiwum świec i finansowania BTC (gałąź `archive` repo danych — historia przyrostowa, tylko dopisywanie).
 * Hyperliquid oddaje najwyżej ~5000 ostatnich świec na interwał (1m ≈ 3,5 doby, 1h ≈ 208 dni) — bez archiwum historia
 * przepada, a z nią możliwość odtworzenia laboratorium folkloru i rozstrzygnięć dziennika. Pliki CSV:
 * `<coin>/1m/RRRR/MM-DD.csv`, `<coin>/1h/RRRR-MM.csv`, `<coin>/1d/RRRR.csv` (`t,o,h,l,c,v,n`, t = początek świecy UTC)
 * i `<coin>/funding/RRRR-MM.csv` (`t,rate,premium`). Wyłącznie świece zamknięte co najmniej minutę (API może jeszcze
 * uzupełnić świeżo zamkniętą), rosnąco, bez duplikatów; luki w API zostają lukami. Ucięty zapis (awaria, pełny dysk)
 * jest obcinany do ostatniego pełnego wiersza przed kolejnym dopisaniem, a odczyt przyjmuje tylko poprawne wiersze.
 */

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export type ArchInterval = '1m' | '1h' | '1d';
export const INTERVALS: ArchInterval[] = ['1m', '1h', '1d'];
const IV_MS: Record<ArchInterval, number> = { '1m': MIN, '1h': H, '1d': D };
export const CANDLE_HEADER = 't,o,h,l,c,v,n';
export const FUNDING_HEADER = 't,rate,premium';
/** Najstarsze finansowanie, o które pytamy przy zasiewie (API zwraca od pierwszego dostępnego) */
const FUNDING_START = Date.UTC(2023, 0, 1);
const FUNDING_PAGE = 500;
/** Świeca trafia do archiwum minutę po zamknięciu */
const SETTLE_MS = 60_000;

export interface ArchBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
}

export interface FundingRow {
  t: number;
  rate: number;
  premium: number;
}

const pad = (x: number) => String(x).padStart(2, '0');

export function candleFile(coin: string, iv: ArchInterval, t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (iv === '1m') return `${coin}/1m/${y}/${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.csv`;
  if (iv === '1h') return `${coin}/1h/${y}-${pad(d.getUTCMonth() + 1)}.csv`;
  return `${coin}/1d/${y}.csv`;
}

export function fundingFile(coin: string, t: number): string {
  const d = new Date(t);
  return `${coin}/funding/${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}.csv`;
}

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));

/** Spójna świeca: liczby skończone, low ≤ min(open, close) ≤ max(open, close) ≤ high, wolumen i liczba ≥ 0. */
const validBar = (b: ArchBar) =>
  [b.t, b.o, b.h, b.l, b.c, b.v, b.n].every(Number.isFinite) && b.l > 0 && b.l <= Math.min(b.o, b.c) && Math.max(b.o, b.c) <= b.h && b.v >= 0 && b.n >= 0;

/** Świece z `candleSnapshot`: zamknięte co najmniej minutę (t + interwał + 60 s ≤ now), spójne, rosnąco, bez duplikatów. */
export function parseArchCandles(raw: unknown, ivMs: number, now: number): ArchBar[] {
  if (!Array.isArray(raw)) return [];
  const byT = new Map<number, ArchBar>();
  for (const c of raw as Record<string, unknown>[]) {
    const b = { t: num(c?.t), o: num(c?.o), h: num(c?.h), l: num(c?.l), c: num(c?.c), v: num(c?.v), n: num(c?.n) };
    if (!validBar(b) || b.t + ivMs + SETTLE_MS > now) continue;
    byT.set(b.t, b);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Wiersz CSV świecy: dokładnie 7 pól, spójna świeca; inaczej null. */
function parseCandleRow(line: string): ArchBar | null {
  const f = line.split(',');
  if (f.length !== 7) return null;
  const [t, o, h, l, c, v, n] = f.map(Number);
  const b = { t, o, h, l, c, v, n };
  return validBar(b) ? b : null;
}

/** Wiersz CSV finansowania: dokładnie 3 pola skończone; inaczej null. */
function parseFundingRow(line: string): FundingRow | null {
  const f = line.split(',');
  if (f.length !== 3) return null;
  const [t, rate, premium] = f.map(Number);
  return [t, rate, premium].every(Number.isFinite) ? { t, rate, premium } : null;
}

/** Plik bez końcowego znaku nowej linii (ucięty zapis) → obcięcie do ostatniego pełnego wiersza; true = naprawiono. */
function repairTail(p: string): boolean {
  if (!existsSync(p)) return false;
  const b = readFileSync(p);
  if (b.length === 0 || b[b.length - 1] === 0x0a) return false;
  const i = b.lastIndexOf(0x0a);
  if (i < 0) rmSync(p);
  else truncateSync(p, i + 1);
  return true;
}

/** Wpisy `fundingHistory` → wiersze archiwum (czas jak w API, ms). */
export function parseFunding(raw: unknown): FundingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FundingRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const row = { t: num(r?.time), rate: num(r?.fundingRate), premium: num(r?.premium) };
    if (Object.values(row).every(Number.isFinite)) out.push(row);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Wagi zapytań (szacunek z zapasem): świece 20 + 1 na 60, finansowanie 20 + 1 na 20 wpisów */
const candleWeight = (n: number) => 20 + Math.ceil(n / 60);
const FUNDING_WEIGHT = 20 + Math.ceil(FUNDING_PAGE / 20);

/** Wszystkie pliki .csv pod katalogiem (rekurencyjnie), posortowane — nazwy z zerami wiodącymi sortują się w czasie. */
function csvFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.csv')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Czas ostatniego poprawnego wiersza (od końca, pomijając uszkodzone). */
function lastTime(files: string[], parse: (line: string) => { t: number } | null): number | null {
  for (let i = files.length - 1; i >= 0; i--) {
    const lines = readFileSync(files[i], 'utf8').split('\n');
    for (let j = lines.length - 1; j >= 1; j--) {
      const r = lines[j] ? parse(lines[j]) : null;
      if (r) return r.t;
    }
  }
  return null;
}

export class CandleArchive {
  private readonly o: { dir: string; coin: string; rest: InfoClient; fundingPages: number; fundingStart: number };
  private lastT = new Map<string, number | null>();

  constructor(o: { dir: string; coin: string; rest: InfoClient; fundingPages?: number; fundingStart?: number }) {
    this.o = { fundingPages: 10, fundingStart: FUNDING_START, ...o };
  }

  private root(sub: string): string {
    return join(this.o.dir, this.o.coin, sub);
  }

  /** Początek ostatniej zarchiwizowanej świecy; null = brak. */
  last(iv: ArchInterval): number | null {
    if (!this.lastT.has(iv)) this.lastT.set(iv, lastTime(csvFiles(this.root(iv)), parseCandleRow));
    return this.lastT.get(iv) ?? null;
  }

  /** Czas ostatniego zarchiwizowanego finansowania; null = brak. */
  lastFunding(): number | null {
    if (!this.lastT.has('funding')) this.lastT.set('funding', lastTime(csvFiles(this.root('funding')), parseFundingRow));
    return this.lastT.get('funding') ?? null;
  }

  /** Dopisanie wierszy pogrupowanych po pliku (jeden zapis na plik; nagłówek przy nowym pliku; ucięty ogon obcięty). */
  private flush(header: string, byFile: Map<string, string[]>): void {
    for (const [rel, lines] of byFile) {
      const p = join(this.o.dir, rel);
      repairTail(p);
      const fresh = !existsSync(p);
      if (fresh) mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, `${fresh ? `${header}\n` : ''}${lines.join('\n')}\n`);
    }
  }

  /** Wiersze nowsze niż ostatni zapisany, rosnąco, pogrupowane po pliku; zwraca liczbę i nowy ostatni czas. */
  private addRows<T extends { t: number }>(key: string, header: string, rows: readonly T[], file: (t: number) => string, line: (r: T) => string, last0: number | null): number {
    let last = last0 ?? Number.NEGATIVE_INFINITY;
    const byFile = new Map<string, string[]>();
    let n = 0;
    for (const r of rows) {
      if (r.t <= last) continue;
      const f = file(r.t);
      const acc = byFile.get(f);
      if (acc) acc.push(line(r));
      else byFile.set(f, [line(r)]);
      last = r.t;
      n++;
    }
    if (n) {
      try {
        this.flush(header, byFile);
      } catch (e) {
        // Częściowy zapis (np. pełny dysk): ostatni czas odczytany ponownie z plików przy następnym przebiegu
        this.lastT.delete(key);
        throw e;
      }
      this.lastT.set(key, last);
    }
    return n;
  }

  /** Dopisuje świece nowsze niż ostatnia w archiwum; zwraca liczbę wierszy. */
  append(iv: ArchInterval, bars: readonly ArchBar[]): number {
    return this.addRows(iv, CANDLE_HEADER, bars, (t) => candleFile(this.o.coin, iv, t), (b) => `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v},${b.n}`, this.last(iv));
  }

  appendFunding(rows: readonly FundingRow[]): number {
    return this.addRows('funding', FUNDING_HEADER, rows, (t) => fundingFile(this.o.coin, t), (r) => `${r.t},${r.rate},${r.premium}`, this.lastFunding());
  }

  /** Jeden przebieg: nowe zamknięte świece 1m/1h/1d i finansowanie (zasiew stronami, najwyżej `fundingPages`). */
  async tick(now: number): Promise<number> {
    let added = 0;
    // Ucięty zapis po awarii: obcięcie ogona ostatniego pliku każdej serii i ponowny odczyt ostatniego czasu
    for (const sub of [...INTERVALS, 'funding']) {
      const last = csvFiles(this.root(sub)).at(-1);
      if (last && repairTail(last)) this.lastT.delete(sub);
    }
    for (const iv of INTERVALS) {
      const ms = IV_MS[iv];
      const last = this.last(iv);
      const start = last === null ? now - 5000 * ms : last + ms;
      if (now - start < ms + SETTLE_MS) continue; // następna świeca jeszcze niezamknięta (albo zamknięta przed chwilą)
      const n = Math.min(5000, Math.ceil((now - start) / ms) + 1);
      const raw = await this.o.rest.info({ type: 'candleSnapshot', req: { coin: this.o.coin, interval: iv, startTime: start, endTime: now } }, candleWeight(n));
      added += this.append(iv, parseArchCandles(raw, ms, now));
    }
    for (let page = 0; page < this.o.fundingPages; page++) {
      const last = this.lastFunding();
      const start = last === null ? this.o.fundingStart : last + 1;
      if (now - start < H && last !== null) break;
      const rows = parseFunding(await this.o.rest.info({ type: 'fundingHistory', coin: this.o.coin, startTime: start, endTime: now }, FUNDING_WEIGHT));
      added += this.appendFunding(rows);
      if (rows.length < FUNDING_PAGE) break;
    }
    return added;
  }

  /** Poprawne wiersze serii od `from` (włącznie), ściśle rosnąco (wiersze uszkodzone i nierosnące pomijane). */
  private readRows<T extends { t: number }>(sub: string, header: string, parse: (line: string) => T | null, from: number): T[] {
    const out: T[] = [];
    let last = Number.NEGATIVE_INFINITY;
    for (const f of csvFiles(this.root(sub))) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line || line === header) continue;
        const r = parse(line);
        if (!r || r.t <= last) continue;
        last = r.t;
        if (r.t >= from) out.push(r);
      }
    }
    return out;
  }

  /** Świece interwału od `from` (włącznie), rosnąco. */
  read(iv: ArchInterval, from = Number.NEGATIVE_INFINITY): ArchBar[] {
    return this.readRows(iv, CANDLE_HEADER, parseCandleRow, from);
  }

  readFunding(from = Number.NEGATIVE_INFINITY): FundingRow[] {
    return this.readRows('funding', FUNDING_HEADER, parseFundingRow, from);
  }
}
