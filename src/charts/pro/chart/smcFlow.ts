import type { Dir, SmcBreak, SmcFvg, SmcOb } from '../core/smcStructure';
import type { Candle } from '../hl/parse';

/**
 * Potwierdzenia elementów SMC z taśmy Hyperliquid (projekt `smc-hl.md` §2, etap S3, część z taśmy i footprintu):
 * to, czego skrypt liczony ze świec nie widzi. Każda miara bierze tylko świece w całości nagrane (`complete`) i znane do
 * chwili wyboru; bez nich wynik to null z powodem, a nie zgadywanie. Potwierdzenia są eksperymentalne: częstości bazowe
 * (S2) dotyczą elementów bez nich, a rejestr do przodu (S4) jeszcze nie istnieje — legenda mówi to wprost.
 */

/** Footprint świecy: delta i (gdy jest) wiersze ceny z wolumenem agresorów. Cena wiersza i = (lo + i) × tick. */
export interface SmcFootprint {
  delta: number;
  tick?: number;
  lo?: number;
  buy?: ArrayLike<number>;
  sell?: ArrayLike<number>;
}

export interface SmcFlowBar {
  t: number;
  candle: Candle;
  fp?: SmcFootprint | null;
  complete?: boolean;
}

/** Absorpcja: wynik wobec wysiłku (F-C1) co najmniej tyle σ przeciw delcie (≈ p10 rozkładu normalnego). */
export const SMC_ABSORPTION_Z = 1.2816;
/** FVG „pusta”: gęstość wolumenu w luce ≤ tyle średniej gęstości środkowej świecy (4 razy rzadziej). */
export const SMC_THIN_DENSITY = 0.25;
/** Przyjęcie przełamania: w tylu świecach po przełamaniu… */
export const SMC_ACCEPT_BARS = 3;
/** …co najmniej tyle zamknięć za poziomem… */
export const SMC_ACCEPT_CLOSES = 2;
/** …i co najmniej taki udział wolumenu taśmy za poziomem. */
export const SMC_ACCEPT_SHARE = 0.5;

type Rows = { price: number; vol: number }[];

/** Wiersze footprintu z ceną środka wiersza; null bez pełnej taśmy albo bez wierszy. */
function rowsOf(b: SmcFlowBar | undefined): Rows | null {
  const fp = b?.complete ? b.fp : null;
  if (!fp || !fp.buy || !fp.sell || !(fp.tick && fp.tick > 0) || fp.lo === undefined) return null;
  const out: Rows = [];
  for (let i = 0; i < fp.buy.length; i++) {
    const vol = (fp.buy[i] ?? 0) + (fp.sell[i] ?? 0);
    if (vol > 0) out.push({ price: (fp.lo + i + 0.5) * fp.tick, vol });
  }
  return out.length > 0 ? out : null;
}

const sum = (rows: Rows, keep: (p: number) => boolean) => rows.reduce((s, r) => (keep(r.price) ? s + r.vol : s), 0);

export interface ObFlow {
  /** POC świecy OB z taśmy (cena wiersza z największym wolumenem); null bez taśmy. */
  poc: number | null;
  /** Delta przeciwna do impulsu i F-C1 ≥ `SMC_ABSORPTION_Z` σ przeciw delcie; null, gdy brak delty albo F-C1. */
  absorption: boolean | null;
}

/** OB z taśmą: POC świecy OB i absorpcja (delta przeciw późniejszemu impulsowi, cena ruszyła mniej, niż „kupiła” agresja). */
export function obFlow(bars: readonly SmcFlowBar[], o: Pick<SmcOb, 'idx' | 'dir'>, tape: { delta: number | null; fc1: number | null }): ObFlow {
  const rows = rowsOf(bars[o.idx]);
  let poc: number | null = null;
  if (rows) {
    const c = bars[o.idx].candle;
    const mid = (c.h + c.l) / 2;
    let best = -1;
    for (const r of rows) if (r.vol > best || (r.vol === best && poc !== null && Math.abs(r.price - mid) < Math.abs(poc - mid))) [best, poc] = [r.vol, r.price];
  }
  const { delta, fc1 } = tape;
  const absorption = delta === null || delta === 0 || fc1 === null ? null : Math.sign(delta) === -o.dir && fc1 * Math.sign(delta) <= -SMC_ABSORPTION_Z;
  return { poc, absorption };
}

export interface FvgFlow {
  /** Udział wolumenu środkowej świecy wykonany w luce (0–1). */
  share: number;
  /** Udział wolumenu w luce wobec udziału luki w zakresie świecy (1 — jak średnio, 0,25 — 4 razy rzadziej). */
  density: number;
  thin: boolean;
}

/** FVG z taśmą: ile handlu odbyło się w luce w świecy, która ją przeszła (środkowa z trzech, `idx − 1`); null bez taśmy. */
export function fvgFlow(bars: readonly SmcFlowBar[], f: Pick<SmcFvg, 'idx' | 'lo' | 'hi'>): FvgFlow | null {
  const b = bars[f.idx - 1];
  const rows = rowsOf(b);
  if (!rows || !b) return null;
  const total = sum(rows, () => true);
  const range = b.candle.h - b.candle.l;
  if (!(total > 0) || !(range > 0) || !(f.hi > f.lo)) return null;
  const share = sum(rows, (p) => p >= f.lo && p <= f.hi) / total;
  const density = share / Math.min(1, (f.hi - f.lo) / range);
  return { share, density, thin: density <= SMC_THIN_DENSITY };
}

export interface BreakFlow {
  /** Zamknięcia za poziomem w `SMC_ACCEPT_BARS` świecach po przełamaniu. */
  closes: number;
  /** Udział wolumenu taśmy za poziomem w tych świecach; null, gdy któraś nie ma pełnej taśmy. */
  share: number | null;
  /** Przyjęcie: oba progi spełnione; null — wolumen nieznany. */
  accepted: boolean | null;
}

/**
 * Przełamanie z przyjęciem: po świecy przełamania `SMC_ACCEPT_BARS` świec zamkniętych do `asOf`; null, dopóki się nie
 * zamkną (rysunek nie wie wcześniej). Zamknięcia ze świec, udział wolumenu za poziomem z wierszy footprintu.
 */
export function breakFlow(bars: readonly SmcFlowBar[], b: Pick<SmcBreak, 'idx' | 'dir' | 'level'>, ms: number, asOf: number): BreakFlow | null {
  const next = bars.slice(b.idx + 1, b.idx + 1 + SMC_ACCEPT_BARS);
  if (next.length < SMC_ACCEPT_BARS || next.some((x) => x.t + ms > asOf)) return null;
  const beyond = (p: number) => (b.dir === 1 ? p > b.level : p < b.level);
  const closes = next.filter((x) => beyond(x.candle.c)).length;
  let all = 0;
  let out = 0;
  for (const x of next) {
    const rows = rowsOf(x);
    if (!rows) return { closes, share: null, accepted: closes < SMC_ACCEPT_CLOSES ? false : null };
    all += sum(rows, () => true);
    out += sum(rows, beyond);
  }
  const share = all > 0 ? out / all : null;
  return { closes, share, accepted: share === null ? null : closes >= SMC_ACCEPT_CLOSES && share >= SMC_ACCEPT_SHARE };
}

/** Kierunek jako strzałka opisu: ruch, po którym element powstał (przeszłość, nie zapowiedź). */
export const dirArrow = (d: Dir): string => (d === 1 ? '↑' : '↓');
