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
import { DayProfileBuilder, PROFILE_DAY_MS, type DayProfile, dayProfilePath, decodeDayProfile, encodeDayProfile, profileTick } from '../../src/utils/dayProfile.ts';
import type { HlCtx, HlTrade } from './hl.ts';
import type { BookAgg } from './liquidity.ts';

/**
 * Rejestrator historii jednego rynku: taśma (bez adresów — numery zleceń agresora, biorców i makerów w obrębie doby UTC),
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
const DAY_MS = 24 * HIST_HOUR_MS;
const partOf = (t: number) => Math.floor(t / HIST_PART_MS) * HIST_PART_MS;
const hourOf = (t: number) => Math.floor(t / HIST_HOUR_MS) * HIST_HOUR_MS;
const dayOf = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
/** Pliki taśmy w katalogu doby: godzinowe (`13.trades.json.gz`) i części (`13-05.trades.json.gz`) */
const TRADES_FILE = /^\d{2}(?:-\d{2})?\.trades\.json\.gz$/;

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

/**
 * Rynki z nagraniem arkusza także bez agregacji ceny (koszt zlecenia rynkowego na wykresie potrzebuje poziomów co tick;
 * bliska agregacja BTC to 10 USD). Pliki arkusza rosną o około połowę, więc tylko tam, gdzie wskaźnik jest używany.
 */
const EXACT_BOOK = new Set(['BTC']);

/** Krok migawki arkusza dokładnego: najmniejszy odstęp sąsiednich cen po jednej stronie, zaokrąglony do potęgi 10. */
function gapStep(lv: [number[], number[]]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const side of lv) {
    for (let i = 3; i < side.length; i += 3) {
      const d = Math.abs(side[i] - side[i - 3]);
      if (d > 0 && d < min) min = d;
    }
  }
  return Number.isFinite(min) ? 10 ** Math.round(Math.log10(min)) : Number.NaN;
}

/** Bez duplikatów: transakcja (czas, tid), migawka (czas, krok, dokładna), kontekst (minuta — późniejszy wygrywa). */
function uniqTrades(xs: readonly HistTrade[]): HistTrade[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(`${x.t}:${x.tid}`) && (seen.add(`${x.t}:${x.tid}`), true));
}
function uniqFrames(xs: readonly HistFrame[]): HistFrame[] {
  const seen = new Set<string>();
  const key = (x: HistFrame) => `${x.t}:${x.step}:${x.exact ? 1 : 0}`;
  return xs.filter((x) => !seen.has(key(x)) && (seen.add(key(x)), true));
}
function uniqCtx(xs: readonly HistCtx[]): HistCtx[] {
  return [...new Map(xs.map((c) => [c.t, c])).values()];
}

/** Numeracja jednej doby UTC: numer ważny dobę, nowa doba od 0. */
interface Ids {
  /** Biorcy i makerzy w jednej numeracji (ten sam adres po obu stronach = ten sam numer) przez całą dobę */
  users: Map<string, number>;
  /**
   * Zlecenia agresora według godziny, tylko bieżąca i poprzednia: wypełnienia jednego zlecenia mają czas jednego bloku,
   * więc zlecenie nie wraca po godzinie, a mapa nie rośnie przez dobę. Numer (`nextO`) dalej dobowy.
   */
  orders: Map<number, Map<string, number>>;
  nextO: number;
  nextU: number;
}

/** Mapa zleceń godziny; nowa godzina zwalnia starsze od poprzedniej. */
function ordersOf(ids: Ids, hour: number): Map<string, number> {
  let m = ids.orders.get(hour);
  if (m) return m;
  m = new Map();
  ids.orders.set(hour, m);
  for (const h of ids.orders.keys()) if (h < hour - HIST_HOUR_MS) ids.orders.delete(h);
  return m;
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
  /** Numeracje dób (bieżąca, a do zapisu ostatniej części — także poprzednia) według początku doby */
  private readonly ids = new Map<number, Ids>();
  /** Kroki agregacji bliskiej i dalekiej dobrane do ceny (zmiana tylko przy przejściu przez 10^k) */
  private steps: [number, number] | null = null;
  private sigFigs: { near: number; far: number } | null = null;
  /** Ostatnio zapisana część (kolejne zapisy tylko nowszych) */
  private lastPart = Number.NEGATIVE_INFINITY;
  /** Doby z ważnym profilem (sprawdzone albo zapisane w tym uruchomieniu) */
  private readonly profiled = new Set<number>();

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
      const p = partOf(t);
      // Część już zapisana — spóźniona transakcja pominięta, bez numeru (i bez wczytywania numeracji zamkniętej doby)
      if (p <= this.lastPart) continue;
      let o = -1;
      let k = -1;
      let m = -1;
      if (Array.isArray(x.users) && x.users.length === 2) {
        const ids = this.idsFor(dayOf(t));
        const orders = ordersOf(ids, hourOf(t));
        const taker = x.side === 'B' ? x.users[0] : x.users[1];
        const maker = x.side === 'B' ? x.users[1] : x.users[0];
        const key = typeof x.hash === 'string' && x.hash.length > 2 && !ZERO_HASH.test(x.hash) ? `${taker}|${x.hash}` : `${taker}|t${t}|${x.side}`;
        const user = (a: string) => ids.users.get(a) ?? (ids.users.set(a, ids.nextU), ids.nextU++);
        o = orders.get(key) ?? (orders.set(key, ids.nextO), ids.nextO++);
        k = user(taker);
        m = user(maker);
      }
      const acc = this.trades.get(p);
      const row: HistTrade = { t, px, sz, side: x.side, tid, o, k, m };
      if (typeof x.hash === 'string' && ZERO_HASH.test(x.hash)) row.z = true;
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

  /** Dodatkowa subskrypcja arkusza bez agregacji ceny (tylko rynki z EXACT_BOOK). */
  exactBook(): boolean {
    return EXACT_BOOK.has(this.coin);
  }

  /** Agregacje arkusza do subskrypcji (bliska i daleka); null przed pierwszą ceną. */
  aggs(): BookAgg[] | null {
    if (!this.sigFigs) return null;
    return [{ nSigFigs: this.sigFigs.near as BookAgg['nSigFigs'] }, { nSigFigs: this.sigFigs.far as BookAgg['nSigFigs'] }];
  }

  /**
   * Migawka arkusza: agregacja rozpoznana po siatce cen (daleka — wszystkie ceny na siatce dalekiej); cena poza siatką
   * bliskiej to arkusz dokładny (zapisywany tylko na rynkach z EXACT_BOOK), inaczej migawka pominięta.
   */
  onBook(t: number, levels: unknown): void {
    if (!this.steps || !(t > 0)) return;
    const lv = levelsOf(levels);
    if (!lv || (lv[0].length === 0 && lv[1].length === 0)) return;
    const prices = [...lv[0].filter((_, i) => i % 3 === 0), ...lv[1].filter((_, i) => i % 3 === 0)];
    const [near, far] = this.steps;
    const agg = prices.every((px) => isMultiple(px, far)) ? far : prices.every((px) => isMultiple(px, near)) ? near : Number.NaN;
    const exact = !Number.isFinite(agg) && this.exactBook();
    const step = exact ? gapStep(lv) : agg;
    if (!Number.isFinite(step)) return;
    const p = partOf(t);
    if (p <= this.lastPart) return;
    const acc = this.frames.get(p);
    const f: HistFrame = { t, step, bids: lv[0], asks: lv[1], ...(exact ? { exact: true as const } : {}) };
    if (acc) acc.push(f);
    else this.frames.set(p, [f]);
  }

  /**
   * Numeracja doby UTC; po restarcie ciągnie się od największych numerów we wszystkich zapisanych plikach tej doby
   * (godzinowych i częściach, także sprzed numeracji dobowej), więc nowy numer nie powtarza żadnego z wcześniejszych
   * godzin doby. Nowa doba — od 0 (pliki doby poprzedniej się nie liczą).
   */
  private idsFor(day: number): Ids {
    let ids = this.ids.get(day);
    if (ids) return ids;
    ids = { users: new Map(), orders: new Map(), nextO: 0, nextU: 0 };
    const dayDir = join(this.dir, dirname(historyPath(this.coin, day, 'trades', false)));
    for (const name of existsSync(dayDir) ? readdirSync(dayDir) : []) {
      if (!TRADES_FILE.test(name)) continue;
      const f = decodeTrades(readGz(join(dayDir, name)));
      for (const x of f?.trades ?? []) {
        ids.nextO = Math.max(ids.nextO, x.o + 1);
        ids.nextU = Math.max(ids.nextU, x.k + 1, x.m + 1);
      }
    }
    this.ids.set(day, ids);
    return ids;
  }

  /** Numery w pamięci (kontrola zwalniania): doby, konta i zlecenia z map. */
  heldIds(): { days: number; users: number; orders: number } {
    let users = 0;
    let orders = 0;
    for (const ids of this.ids.values()) {
      users += ids.users.size;
      for (const hour of ids.orders.values()) orders += hour.size;
    }
    return { days: this.ids.size, users, orders };
  }

  /** Części godziny zapisane na dysku (początki, rosnąco). */
  private partsOnDisk(hour: number): number[] {
    const out: number[] = [];
    for (let p = hour; p < hour + HIST_HOUR_MS; p += HIST_PART_MS) if (existsSync(join(this.dir, historyPath(this.coin, p, 'trades', true)))) out.push(p);
    return out;
  }

  /**
   * Zapis części zamkniętych co najmniej SETTLE_MS (także pustych, jeśli nagranie trwało) i łączenie godzin zamkniętych;
   * zwraca liczbę zapisanych plików. `final` (zatrzymanie procesu): także bieżąca część, z pokryciem do `now` —
   * restart dopisze do niej dalsze nagranie zamiast zostawiać lukę od początku części.
   */
  flush(now: number, final = false): number {
    let written = 0;
    const due = final ? partOf(now) : partOf(now - SETTLE_MS) - HIST_PART_MS;
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
      // Scalenie z częścią numerowaną w godzinie (rejestrator sprzed numeracji dobowej) — zakres godzinowy dla całej części
      const tFile = encodeTrades(
        this.coin,
        p,
        p + HIST_PART_MS,
        [...spans, ...(oldT?.spans ?? [])],
        uniqTrades([...(oldT?.trades ?? []), ...trades]),
        uniqCtx([...(oldT?.ctx ?? []), ...ctx]),
        oldT?.zeroKnown ?? true,
        oldT?.idScope ?? 'day'
      );
      writeGz(tPath, tFile);
      writeGz(bPath, encodeBook(this.coin, p, p + HIST_PART_MS, [...spans, ...(oldB?.spans ?? [])], uniqFrames([...(oldB?.frames ?? []), ...frames])));
      this.lastPart = p;
      written += 2;
    }
    for (const k of this.ctx.keys()) if (k < due) this.ctx.delete(k);
    this.spans = this.spans.filter(([, b]) => b > due);
    // Doba, której ostatnia część jest już zapisana: numeracja i mapy kont zapomniane (numer ważny najwyżej dobę)
    const open = dayOf(now - SETTLE_MS);
    for (const d of this.ids.keys()) if (d < open) this.ids.delete(d);
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
      // Zakres dobowy tylko wtedy, gdy każdy łączony plik go ma (jak kolumna `z`)
      const idScope = tFiles.every((f) => f.idScope === 'day') ? 'day' : 'hour';
      writeGz(join(this.dir, historyPath(this.coin, h, 'trades', false)), encodeTrades(this.coin, h, h + HIST_HOUR_MS, tFiles.flatMap((f) => f.spans), trades, ctx, tFiles.every((f) => f.zeroKnown), idScope));
      writeGz(join(this.dir, historyPath(this.coin, h, 'book', false)), encodeBook(this.coin, h, h + HIST_HOUR_MS, bFiles.flatMap((f) => f.spans), frames));
      written += 2;
      for (const p of parts) for (const kind of ['trades', 'book'] as const) rmSync(join(this.dir, historyPath(this.coin, p, kind, true)), { force: true });
    }
    return written;
  }

  /**
   * Profil każdej zamkniętej doby na dysku bez ważnego pliku profilu (najwyżej jeden na wywołanie — doba to do 24 plików
   * godzinowych); doba z niepołączonymi częściami czeka. Zwraca liczbę zapisanych plików.
   */
  profiles(now: number): number {
    const root = join(this.dir, this.coin);
    if (!existsSync(root)) return 0;
    const today = Math.floor(now / PROFILE_DAY_MS) * PROFILE_DAY_MS;
    for (const name of readdirSync(root).sort()) {
      const day = Date.parse(`${name}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name) || !Number.isFinite(day) || day >= today || this.profiled.has(day)) continue;
      if (readdirSync(join(root, name)).some((f) => /^\d{2}-\d{2}\.trades\.json\.gz$/.test(f))) continue;
      this.profiled.add(day);
      const path = join(this.dir, dayProfilePath(this.coin, day));
      if (existsSync(path) && decodeDayProfile(readGz(path)) !== null) continue;
      const p = buildDayProfile(this.dir, this.coin, day);
      if (!p) continue;
      writeGz(path, encodeDayProfile(p));
      return 1;
    }
    return 0;
  }

  /** Zamknięcie (koniec procesu): otwarty odcinek domknięty, bez zapisu bieżących części (luka zamiast niepełnej części). */
  stop(at: number): void {
    this.onState(false, at);
  }
}

/**
 * Profil doby UTC z jej plików godzinowych (src/utils/dayProfile.ts): godziny po kolei, w pamięci jedna naraz; zmiana OI
 * minuty z kontekstu minutowego, dla pierwszej minuty doby z ostatniej godziny doby poprzedniej. null bez transakcji.
 */
export function buildDayProfile(dir: string, coin: string, day: number): DayProfile | null {
  const oi = new Map<number, number>();
  const prev = decodeTrades(readGz(join(dir, historyPath(coin, day - HIST_HOUR_MS, 'trades', false))));
  for (const c of prev?.ctx ?? []) oi.set(c.t, c.oi);
  let b: DayProfileBuilder | null = null;
  for (let h = day; h < day + PROFILE_DAY_MS; h += HIST_HOUR_MS) {
    const path = join(dir, historyPath(coin, h, 'trades', false));
    const f = existsSync(path) ? decodeTrades(readGz(path)) : null;
    if (!f || f.coin !== coin) continue;
    for (const c of f.ctx) oi.set(c.t, c.oi);
    const ts = f.trades;
    let i = 0;
    while (i < ts.length) {
      const m = Math.floor(ts[i].t / MIN) * MIN;
      const px: number[] = [];
      const sz: number[] = [];
      const side: number[] = [];
      for (; i < ts.length && ts[i].t < m + MIN; i++) {
        px.push(ts[i].px);
        sz.push(ts[i].sz);
        side.push(ts[i].side === 'B' ? 1 : -1);
      }
      b ??= new DayProfileBuilder(coin, day, profileTick(px[0]));
      // Kontekst minuty = ostatni odczyt w niej (stan na jej koniec)
      const a = oi.get(m - MIN);
      const e = oi.get(m);
      b.addMinute(m, px, sz, side, a !== undefined && e !== undefined ? e - a : null);
    }
  }
  return b?.build() ?? null;
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
    const days: number[] = [];
    const root = join(dir, coin);
    for (const day of existsSync(root) ? readdirSync(root).sort() : []) {
      const d = Date.parse(`${day}T00:00:00Z`);
      if (Number.isFinite(d) && existsSync(join(dir, dayProfilePath(coin, d)))) days.push(d);
      for (const f of readdirSync(join(root, day)).sort()) {
        const m = /^(\d{2})(?:-(\d{2}))?\.trades\.json\.gz$/.exec(f);
        if (!m || !existsSync(join(root, day, f.replace('.trades.', '.book.')))) continue;
        const t = Date.parse(`${day}T${m[1]}:${m[2] ?? '00'}:00Z`);
        if (!Number.isFinite(t)) continue;
        (m[2] === undefined ? hours : parts).push(t);
      }
    }
    markets[coin] = { hours, parts, days };
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
  '  agresora (B/A), numery zlecenia agresora, biorcy i makera w obrębie doby UTC (`idScope: "day"`; nowa doba od 0; brak pola',
  '  albo `"hour"` — w obrębie godziny: plik sprzed numeracji dobowej albo scalony z takim), indeksy transakcji z hashem',
  '  zerowym (`z`, m.in. podzlecenia TWAP; brak kolumny — plik sprzed jej wprowadzenia); kontekst minutowy (OI, finansowanie,',
  '  mark); pokrycie.',
  '- `<RYNEK>/<RRRR-MM-DD>/<GG>.book.json.gz` — migawki arkusza (co ok. 5 s, 20 poziomów na stronę: cena, wielkość, liczba',
  '  zleceń) w agregacji bliskiej (~2 pb ceny) i dalekiej (10 × większy krok), dla BTC także bez agregacji (migawka z piątym',
  '  elementem 1); pokrycie.',
  '- `<GG>-<MM>.*.json.gz` — części 5-minutowe godziny w toku (po jej zamknięciu łączone w plik godzinowy).',
  '- `<RYNEK>/<RRRR-MM-DD>/profile.json.gz` — profil zamkniętej doby (spis: `days`): na każdej cenie agresywne kupno',
  '  i sprzedaż oraz zmiana OI minut przypisana cenom w proporcji do wolumenu, w czterech częściach (OI rośnie albo spada',
  '  przy przewadze kupna albo sprzedaży w minucie), wolumen taśmy w każdej minucie; format: src/utils/dayProfile.ts.',
  '',
  'Pokrycie (`spans`) to odcinki ciągłego nagrania: luka po zerwaniu połączenia albo restarcie zostaje jawną luką.',
  'Bez adresów portfeli i hashy transakcji. Gałąź zawiera jeden commit z oknem ostatnich dni (starsze dni są usuwane).',
  'Format i odczyt: src/utils/tapeHistory.ts w repo HyperQuant.',
  '',
].join('\n');
