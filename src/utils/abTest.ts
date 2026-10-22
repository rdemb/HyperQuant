/**
 * A/B wersji modelu w weryfikowalnym dzienniku — ocena bez podglądania:
 *  - plan oceny (AB_DESIGN) prerejestrowany w łańcuchu dziennika przed pierwszym okresem; weryfikator sprawdza, że
 *    zapisany plan jest identyczny ze stałymi w kodzie;
 *  - okresy oceny ustalone z góry: kolejne, rozłączne bloki po 14 dni od AB_EPOCH;
 *  - w okresie w toku i w rozliczaniu tylko liczności i średnie CRPS — przedział i wniosek dopiero po zakończeniu okresu
 *    (koniec + horyzont + unieważnienie po 6 h + 15 min), więc nie da się „zatrzymać w dogodnej chwili”;
 *  - różnica B − A na wszystkich parach slotów okresu; błąd średniej z estymatora Neweya–Westa (jądro Bartletta,
 *    opóźnienie 96 slotów = 24 h) — prognozy co 15 min z horyzontem 1 h nakładają się, a zmienność skupia się w czasie;
 *    wartość krytyczna fixed-b Kiefera–Vogelsanga (2005), bo opóźnienie jest znaczącą częścią próby.
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
/** Najmniej par w zakończonym okresie, by podać przedział (7 dób slotów) */
export const AB_MIN_N = 7 * 96;
/** Zapas po końcu okresu na rozstrzygnięcia: horyzont 60 min + unieważnienie po 6 h + 15 min */
export const AB_GRACE_MIN = 60 + 6 * 60 + 15;

/** Plan oceny A/B — prerejestrowany w dzienniku (rekord `k: 'p'`), zmiana planu = nowy identyfikator */
export const AB_DESIGN = {
  id: 'ab-v1',
  question: 'Czy wersja B (σ z mieszaniny z reżimem zmienności BOCPD) ma niższy CRPS zwrotu 1 h niż wersja A (HAR + FHS)?',
  modelA: 'ledger-har-fhs-v1',
  modelB: 'ledger-har-fhs-bocpd-v1',
  h: 60,
  scale: 'sqrt(1/2 + 1/2 * sigma5^2 * (h/5) * seas / sigmaA^2)',
  metric: 'CRPS z 13 kwantyli, pary A i B z tego samego slotu, bez unieważnionych',
  epoch: AB_EPOCH,
  blockDays: AB_BLOCK_DAYS,
  hacLag: AB_HAC_LAG,
  kernel: 'bartlett',
  ci: 'fixed-b Kiefer-Vogelsang 2005, 95%: 1.96 + 2.9694b + 0.416b^2 - 0.5324b^3, b = (hacLag + 1) / n',
  minN: AB_MIN_N,
  graceMin: AB_GRACE_MIN,
  verdict: 'B trafniejsza, gdy górna granica < 0; A trafniejsza, gdy dolna > 0; inaczej różnica nieudowodniona',
} as const;

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
 * autokowariancje tylko z par istniejących slotów (luki jak zera — estymator nieujemny), dzielone przez n. Mniej niż
 * 2 punkty albo zerowa wariancja → null.
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

/** Wartość krytyczna fixed-b dla jądra Bartletta, test dwustronny 5% (Kiefer & Vogelsang 2005, wielomian). */
export function fixedBCrit(b: number): number {
  return 1.96 + 2.9694 * b + 0.416 * b * b - 0.5324 * b * b * b;
}

const r8 = (x: number) => Math.round(x * 1e8) / 1e8;

/**
 * Okres w toku (`current`), poprzedni czekający na rozstrzygnięcia (`closing`) — oba bez przedziału — i ostatni
 * zakończony (`last`, z przedziałem) dla par A/B o horyzoncie `hMin`. Okres jest zakończony, gdy minęło
 * `end + AB_GRACE_MIN`. Pary sprzed AB_EPOCH nie wchodzą do żadnego okresu.
 */
export function abBlocks(rows: readonly AbRow[], now: number): { current: AbBlock | null; closing: AbBlock | null; last: AbBlock | null } {
  if (now < AB_EPOCH) return { current: null, closing: null, last: null };
  const len = AB_BLOCK_DAYS * DAY;
  const grace = AB_GRACE_MIN * MIN;
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
      if (nw) {
        const cv = fixedBCrit((AB_HAC_LAG + 1) / n);
        diff = { d: r8(nw.mean), lo: r8(nw.mean - cv * nw.se), hi: r8(nw.mean + cv * nw.se) };
      }
    }
    return { start, end, n, crpsA: crpsA === null ? null : r8(crpsA), crpsB: crpsB === null ? null : r8(crpsB), diff };
  };
  const cur = Math.floor((now - AB_EPOCH) / len);
  const done = Math.floor((now - grace - AB_EPOCH) / len) - 1;
  return {
    current: block(cur, false),
    closing: cur - 1 >= 0 && cur - 1 > done ? block(cur - 1, false) : null,
    last: done >= 0 ? block(done, true) : null,
  };
}
