/**
 * A/B wersji modelu w weryfikowalnym dzienniku — ocena bez podglądania:
 *  - okresy oceny ustalone z góry: kolejne, rozłączne bloki po 14 dni od AB_EPOCH (stała w kodzie, zapisana przed danymi);
 *  - w okresie w toku tylko liczności i średnie CRPS — przedział i wniosek dopiero po jego zakończeniu (koniec + horyzont
 *    + 1 h na rozstrzygnięcia), więc nie da się „zatrzymać w dogodnej chwili”;
 *  - różnica B − A na wszystkich parach slotów okresu; błąd średniej z estymatora Neweya–Westa (jądro Bartletta,
 *    opóźnienie 96 slotów = 24 h): prognozy co 15 min z horyzontem 1 h nakładają się, a zmienność skupia się w czasie.
 * Wspólne dla skanera (podsumowanie) i weryfikatora (przeliczenie z rekordów).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = 15 * MIN;

/** Początek pierwszego okresu oceny A/B: 2026-10-23 00:00 UTC */
export const AB_EPOCH = Date.UTC(2026, 9, 23);
export const AB_BLOCK_DAYS = 14;
/** Opóźnienie HAC w slotach (24 h) */
export const AB_HAC_LAG = 96;
/** Najmniej par w zakończonym okresie, by podać przedział (2 doby slotów) */
export const AB_MIN_N = 192;

export interface AbRow {
  slot: number;
  crpsA: number;
  crpsB: number;
}

export interface AbBlock {
  start: number;
  end: number;
  n: number;
  crpsA: number | null;
  crpsB: number | null;
  /** B − A z 95% przedziałem HAC — tylko w zakończonym okresie z co najmniej AB_MIN_N parami */
  diff: { d: number; lo: number; hi: number } | null;
}

/**
 * Średnia i jej błąd standardowy HAC (Newey–West, wagi Bartletta 1 − k/(L+1)) dla szeregu na siatce slotów co `step`;
 * autokowariancje tylko z par istniejących slotów (luki pomijane), dzielone przez n. Mniej niż 2 punkty albo
 * nieujemność naruszona przez luki → null.
 */
export function neweyWest(points: readonly { slot: number; d: number }[], lag: number = AB_HAC_LAG, step: number = SLOT): { mean: number; se: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mean = points.reduce((s, p) => s + p.d, 0) / n;
  const dev = new Map(points.map((p) => [p.slot, p.d - mean]));
  let lrv = 0;
  for (const e of dev.values()) lrv += e * e;
  lrv /= n;
  for (let k = 1; k <= lag; k++) {
    let g = 0;
    for (const [t, e] of dev) {
      const f = dev.get(t + k * step);
      if (f !== undefined) g += e * f;
    }
    lrv += 2 * (1 - k / (lag + 1)) * (g / n);
  }
  return lrv > 0 ? { mean, se: Math.sqrt(lrv / n) } : null;
}

const r8 = (x: number) => Math.round(x * 1e8) / 1e8;

/**
 * Okres w toku (`current`, bez przedziału) i ostatni zakończony (`last`, z przedziałem) dla par A/B o horyzoncie `hMin`.
 * Okres jest zakończony, gdy minęło `end + hMin + 1 h`. Pary sprzed AB_EPOCH nie wchodzą do żadnego okresu.
 */
export function abBlocks(rows: readonly AbRow[], now: number, hMin: number = 60): { current: AbBlock | null; last: AbBlock | null } {
  if (now < AB_EPOCH) return { current: null, last: null };
  const len = AB_BLOCK_DAYS * DAY;
  const grace = hMin * MIN + HOUR;
  const block = (i: number, final: boolean): AbBlock => {
    const start = AB_EPOCH + i * len;
    const end = start + len;
    const rs = rows.filter((x) => x.slot >= start && x.slot < end);
    const n = rs.length;
    const crpsA = n ? rs.reduce((s, x) => s + x.crpsA, 0) / n : null;
    const crpsB = n ? rs.reduce((s, x) => s + x.crpsB, 0) / n : null;
    let diff: AbBlock['diff'] = null;
    if (final && n >= AB_MIN_N) {
      const nw = neweyWest(rs.map((x) => ({ slot: x.slot, d: x.crpsB - x.crpsA })));
      if (nw) diff = { d: r8(nw.mean), lo: r8(nw.mean - 1.96 * nw.se), hi: r8(nw.mean + 1.96 * nw.se) };
    }
    return { start, end, n, crpsA: crpsA === null ? null : r8(crpsA), crpsB: crpsB === null ? null : r8(crpsB), diff };
  };
  const cur = Math.floor((now - AB_EPOCH) / len);
  const done = Math.floor((now - grace - AB_EPOCH) / len) - 1;
  return { current: block(cur, false), last: done >= 0 ? block(done, true) : null };
}
