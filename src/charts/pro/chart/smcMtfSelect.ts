import type { Dir, Scale, SmcBreak, SmcFvg, StructureState } from '../core/smcStructure';
import { fvgFill, stateAt } from '../core/smcStructure';
import type { SmcMtf } from '../core/smcMtf';
import { smcWindowMs } from './smcSelect';

/**
 * Co rysuje warstwa SMC z wyższego interwału w chwili `asOf` (zamknięcie ostatniej zamkniętej świecy wykresu). Wynik
 * modelu wyższego interwału (`smcMtf`) jest liczony na jego zamkniętych świecach, więc element jest brany tylko wtedy,
 * gdy jego `known` (zamknięcie świecy wyższego interwału) ≤ `asOf`, a jego stan (wypełnienie) — tylko ze świec
 * wyższego interwału zamkniętych do `asOf`.
 *
 * - **Limity**: 3 FVG otwarte najbliższe ostatniemu zamknięciu wykresu, 2 OB na typ (wejście gotowe,
 *   osobne dane modelu OB), 1 linia ostatniego przełamania (BOS albo CHoCH) z okna max(24 h, 24 świece wyższego
 *   interwału); stan struktury tylko w legendzie.
 * - **Łączny limit:** obiekty wyższego interwału mieszczą się w tym, co zostaje z 25 (telefon: 10) po rysunku interwału
 *   wykresu (`room`); przy braku miejsca odpadają kolejno: dalsze FVG, OB, linia, najbliższa FVG.
 * - **Telefon:** najwyżej najbliższa FVG wyższego interwału i tylko wtedy, gdy rysunek wykresu zostawia miejsce w limicie
 *   10 obiektów (strefa z wyższego interwału to kontekst, którego nie widać na krótkim wykresie, ale nie wypiera
 *   struktury wykresu; stan struktury wyższego interwału zawsze w legendzie).
 */

export const SMC_MTF_LIMITS = { fvg: 3, obPerDir: 2, breaks: 1 } as const;
export const SMC_MTF_PHONE_LIMITS = { fvg: 1, obPerDir: 0, breaks: 0 } as const;

/**
 * Strefa OB wyższego interwału — wejście dla wyboru, gdy model OB dostarczy dane: strona, granice, chwila `known`
 * (zamknięcie świecy przełamania na wyższym interwale) i koniec (mitygacja); null — aktywna.
 */
export interface SmcMtfZone {
  id: number;
  dir: Dir;
  lo: number;
  hi: number;
  known: number;
  endAt: number | null;
}

export interface SmcMtfFvgView {
  f: SmcFvg;
  /** Wypełnienie 0–1 na świecach wyższego interwału zamkniętych do `asOf`. */
  fill: number;
  ce: boolean;
}

export interface SmcMtfSelection {
  ms: number;
  label: string;
  /** Stan struktury obu skal wyższego interwału; przy za małej liczbie świec (`enough` false) bez znaczenia. */
  state: Record<Scale, StructureState>;
  /** Zamknięte świece wyższego interwału do `asOf` i minimum do stanu struktury. */
  closed: number;
  need: number;
  enough: boolean;
  fvgs: SmcMtfFvgView[];
  obs: SmcMtfZone[];
  breaks: SmcBreak[];
  /** Otwarte FVG i aktywne OB w chwili `asOf` przed limitami (legenda). */
  active: { fvg: number; ob: number };
  asOf: number;
}

export interface SmcMtfOptions {
  phone: boolean;
  /** Ile obiektów zostało z łącznego limitu po rysunku interwału wykresu. */
  room: number;
}

/** Liczba obiektów rysunku wyższego interwału. */
export const smcMtfObjects = (s: SmcMtfSelection): number => s.fvgs.length + s.obs.length + s.breaks.length;

const distance = (lo: number, hi: number, close: number) => (close >= lo && close <= hi ? 0 : Math.min(Math.abs(close - lo), Math.abs(close - hi)));

/** Liczba świec (rosnąco po `t`) zamkniętych do `asOf`. */
function closedBy(bars: readonly { t: number }[], ms: number, asOf: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t + ms <= asOf) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Wybór elementów wyższego interwału w chwili `asOf` przy ostatnim zamknięciu wykresu `close`; `obs` — strefy OB
 * wyższego interwału (do etapu S1 pusta lista).
 */
export function selectSmcMtf(m: SmcMtf, asOf: number, close: number, o: SmcMtfOptions, obs: readonly SmcMtfZone[] = []): SmcMtfSelection {
  const r = m.result;
  const lim = o.phone ? SMC_MTF_PHONE_LIMITS : SMC_MTF_LIMITS;
  const closed = closedBy(m.bars, m.ms, asOf);
  const out: SmcMtfSelection = {
    ms: m.ms,
    label: m.label,
    state: { internal: stateAt(r, 'internal', asOf), swing: stateAt(r, 'swing', asOf) },
    closed,
    need: m.need,
    enough: closed >= m.need,
    fvgs: [],
    obs: [],
    breaks: [],
    active: { fvg: 0, ob: 0 },
    asOf,
  };
  if (!Number.isFinite(close)) return out;

  // FVG otwarte w chwili asOf (wypełnienie i wygaśnięcie tylko ze zdarzeń do asOf) według bliskości, remis — nowsza
  const open = r.fvgs
    .filter((f) => f.known <= asOf && !(f.filledAt !== null && f.filledAt <= asOf) && f.expiresAt > asOf)
    .sort((a, b) => distance(a.lo, a.hi, close) - distance(b.lo, b.hi, close) || b.known - a.known);
  out.active.fvg = open.length;
  const fvgs = open.slice(0, lim.fvg).map((f) => ({
    f: { ...f, filledAt: null, ceAt: f.ceAt !== null && f.ceAt <= asOf ? f.ceAt : null },
    fill: fvgFill(f, m.bars, m.ms, asOf),
    ce: f.ceAt !== null && f.ceAt <= asOf,
  }));

  // OB: aktywne w chwili asOf, po 2 najbliższe na typ
  const live = obs.filter((z) => z.known <= asOf && (z.endAt === null || z.endAt > asOf));
  out.active.ob = live.length;
  const near = (dir: Dir) =>
    live
      .filter((z) => z.dir === dir)
      .sort((a, b) => distance(a.lo, a.hi, close) - distance(b.lo, b.hi, close) || b.known - a.known)
      .slice(0, lim.obPerDir)
      .map((z) => ({ ...z, endAt: null }));
  const zones = [near(1), near(-1)];
  // Naprzemiennie najbliższe obu typów, żeby przy braku miejsca nie odpadał cały typ
  const obList: SmcMtfZone[] = [];
  for (let k = 0; k < lim.obPerDir; k++) for (const z of zones) if (z[k]) obList.push(z[k]);

  // Ostatnie przełamanie (BOS albo CHoCH) obu skal z okna wyższego interwału
  const win = smcWindowMs(m.ms);
  const brk = r.breaks
    .filter((b) => b.known <= asOf && asOf - b.known < win)
    .sort((a, b) => b.known - a.known || b.id - a.id)
    .slice(0, lim.breaks);

  // Łączny limit: kolejność ważności — najbliższa FVG, linia, OB, dalsze FVG
  let room = Math.max(0, o.room);
  const take = <T>(list: readonly T[], into: T[]) => {
    for (const x of list) {
      if (room <= 0) return;
      into.push(x);
      room--;
    }
  };
  take(fvgs.slice(0, 1), out.fvgs);
  take(brk, out.breaks);
  take(obList, out.obs);
  take(fvgs.slice(1), out.fvgs);
  return out;
}
