import { tr } from '../../../i18n';
import { fmtFixed } from '../../../ui/format';
import type { TapeRows } from './effortZones';
import { type SessionId, SESSION_LABEL, sessionAt, utcDayStart } from './sessions';
import { DAY } from './time';

/**
 * Jedno źródło wartości doby UTC i sesji (decyzja Pioniera, 16.11.2026): VAH, VAL i POC dla paska „Rama dnia”, panelu
 * „Najbliższe poziomy”, nagłówka Mapy dnia, poziomów doby P/b i warstwy „Profile okresów” liczone tu jedną funkcją,
 * z tymi samymi parametrami: value area 70%, koszyki 5 pb (log-cena), POC i rozszerzanie od POC jak w profilu P/b
 * (`profileLevels`: większy sąsiad, przy remisie w górę).
 *
 * Dane:
 * - **taśma**, gdy nagranie obejmuje co najmniej 90% wolumenu okresu (wolumen świec z API): wolumen transakcji dokładnie
 *   na swoich cenach (plik profilu doby z serwera albo footprint świec w całości nagranych), a resztę wolumenu świecy
 *   spoza nagrania (najwyżej 10%) rozkładamy równo na jej zakres;
 * - inaczej **świece 5m** z wolumenem rozłożonym równo na zakres świecy — przybliżenie, z udziałem taśmy w opisie.
 * Okres musi mieć co najmniej 90% świec 5m (doba albo sesja w toku: 90% świec zamkniętych dotąd). Świeca w trakcie się
 * nie liczy. Wartość z taśmy według stałej reguły to LIVE, ze świec — MODEL „przybliżenie ze świec”.
 */

export type ValueKind = 'day' | 'session';
export type ValueSourceKind = 'tape' | 'candles';

/** Udział wolumenu w value area. */
export const VALUE_SHARE = 0.7;
/** Szerokość koszyka profilu w punktach bazowych log-ceny. */
export const VALUE_BIN_BP = 5;
/** Najmniejszy udział wolumenu okresu na taśmie, przy którym profil jest z taśmy. */
export const TAPE_MIN_SHARE = 0.9;
/** Najmniejsza część świec okresu (doba, sesja albo ich część do teraz). */
export const VALUE_COMPLETE = 0.9;
/** Interwał świec źródła. */
export const VALUE_MS = 5 * 60_000;

const MIN = 60_000;

/** Świeca źródła: wolumen w jednostkach rynku (jak taśma); `tape` — wiersze świecy w całości nagranej, inaczej brak. */
export interface ValueBar {
  t: number;
  l: number;
  h: number;
  v: number;
  tape?: TapeRows | null;
}

/** Profil zamkniętej doby z taśmy serwera: wiersze cen i wolumen taśmy w każdej minucie doby (od 00:00 UTC). */
export interface DayTape extends TapeRows {
  day: number;
  minuteVol: ArrayLike<number>;
}

/** Źródło wartości: świece (rosnąco, interwał `ms`, mogą zawierać świecę w trakcie) i pliki taśmy zamkniętych dób. */
export interface ValueSource {
  bars: readonly ValueBar[];
  ms: number;
  dayTape?: (day: number) => DayTape | null;
}

export interface ValuePeriod {
  kind: ValueKind;
  from: number;
  to: number;
  /** Sesja (Azja, Londyn, NY) przy `kind` „session”. */
  session?: SessionId;
}

export interface ValueRef extends ValuePeriod {
  poc: number;
  vah: number;
  val: number;
  source: ValueSourceKind;
  /** Udział wolumenu okresu na taśmie (0–1). */
  tapeShare: number;
  /** Świece okresu w profilu i koniec ostatniej z nich. */
  bars: number;
  through: number;
  /** Okres zamknięty (koniec ≤ teraz). */
  complete: boolean;
}

/**
 * Świece 5m złożone ze świec krótszych (rosnąco; dołek, szczyt, suma wolumenu) — te same co świece 5m Hyperliquid przy
 * kompletnych minutach, więc profil ze świec 1m (archiwum, serwer MCP) zgadza się z profilem ze świec 5m.
 */
export function toFiveMinutes(bars: readonly ValueBar[]): ValueBar[] {
  const out: ValueBar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / VALUE_MS) * VALUE_MS;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.v += b.v;
    } else out.push({ t, l: b.l, h: b.h, v: b.v });
  }
  return out;
}

/** Okres doby UTC albo sesji (`sessionAt`: Azja od 00:00 UTC, Londyn od 08:00 czasu Londynu, NY od 09:30 czasu NY) z chwilą `at`. */
export function valuePeriod(kind: ValueKind, at: number): ValuePeriod {
  if (kind === 'day') {
    const from = utcDayStart(at);
    return { kind, from, to: from + DAY };
  }
  const s = sessionAt(at);
  return { kind, from: s.start, to: s.end, session: s.id };
}

const tapeVolume = (rows: TapeRows): number => {
  let s = 0;
  for (let r = 0; r < rows.buy.length; r++) s += rows.buy[r] + rows.sell[r];
  return s;
};

/**
 * Wartość okresu `kind` z chwilą `at` (doba UTC albo sesja) ze źródła `src` w chwili `now`; za mało świec — null.
 */
export function valueReference(kind: ValueKind, at: number, src: ValueSource, now: number): ValueRef | null {
  const p = valuePeriod(kind, at);
  const ms = src.ms;
  const end = Math.min(p.to, now);
  const expected = Math.floor((end - p.from) / ms);
  if (expected < 1) return null;
  const list = src.bars.filter((b) => b.t >= p.from && b.t + ms <= end && b.h >= b.l && b.l > 0);
  if (list.length < VALUE_COMPLETE * expected) return null;
  const complete = p.to <= now;
  const file = kind === 'day' && complete ? (src.dayTape?.(p.from) ?? null) : null;

  // Wolumen taśmy każdej świecy: z minut pliku doby albo z footprintu świecy w całości nagranej
  const taped = new Float64Array(list.length);
  let total = 0;
  let covered = 0;
  list.forEach((b, i) => {
    let tv = 0;
    if (file) {
      const m0 = Math.max(0, Math.floor((b.t - p.from) / MIN));
      const m1 = Math.min(file.minuteVol.length, Math.floor((b.t + ms - p.from) / MIN));
      for (let m = m0; m < m1; m++) tv += file.minuteVol[m];
    } else if (b.tape) tv = tapeVolume(b.tape);
    const v = Math.max(0, b.v);
    taped[i] = Math.min(tv, v);
    total += v;
    covered += taped[i];
  });
  const tapeShare = total > 0 ? covered / total : 0;
  const source: ValueSourceKind = total > 0 && tapeShare >= TAPE_MIN_SHARE ? 'tape' : 'candles';

  // Wiersze taśmy w profilu: plik doby albo wiersze świec nagranych
  const rows: TapeRows[] = source === 'candles' ? [] : file ? [file] : list.flatMap((b) => (b.tape ? [b.tape] : []));
  let min = Infinity;
  let max = -Infinity;
  for (const b of list) {
    min = Math.min(min, b.l);
    max = Math.max(max, b.h);
  }
  for (const r of rows) {
    for (let k = 0; k < r.buy.length; k++) {
      if (!(r.buy[k] + r.sell[k] > 0)) continue;
      const px = (r.lo + k) * r.tick;
      if (!(px > 0)) continue;
      min = Math.min(min, px);
      max = Math.max(max, px);
    }
  }
  const base = Math.log(min);
  const step = VALUE_BIN_BP / 1e4;
  const bin = (px: number) => Math.floor((Math.log(px) - base) / step);
  const nb = bin(max) + 2;
  const prof = new Float64Array(nb);
  const spread = (b: ValueBar, v: number) => {
    if (!(v > 0)) return;
    const i0 = bin(b.l);
    const i1 = bin(b.h);
    const w = v / (i1 - i0 + 1);
    for (let k = i0; k <= i1; k++) prof[k] += w;
  };
  list.forEach((b, i) => spread(b, source === 'tape' ? Math.max(0, b.v) - taped[i] : Math.max(0, b.v)));
  for (const r of rows) {
    for (let k = 0; k < r.buy.length; k++) {
      const v = r.buy[k] + r.sell[k];
      const px = (r.lo + k) * r.tick;
      if (v > 0 && px > 0) prof[bin(px)] += v;
    }
  }

  // POC i value area jak `profileLevels` (pierwsze maksimum; większy sąsiad, przy remisie w górę)
  let tot = 0;
  let poc = 0;
  for (let k = 0; k < nb; k++) {
    tot += prof[k];
    if (prof[k] > prof[poc]) poc = k;
  }
  if (!(tot > 0)) return null;
  let a = poc;
  let z = poc;
  let s = prof[poc];
  while (s < VALUE_SHARE * tot && (a > 0 || z < nb - 1)) {
    const up = z + 1 < nb ? prof[z + 1] : -1;
    const dn = a - 1 >= 0 ? prof[a - 1] : -1;
    if (up >= dn) s += prof[++z];
    else s += prof[--a];
  }
  const edge = (k: number) => Math.exp(base + step * k);
  const last = list[list.length - 1];
  return {
    ...p,
    poc: Math.sqrt(edge(poc) * edge(poc + 1)),
    vah: edge(z + 1),
    val: edge(a),
    source,
    tapeShare,
    bars: list.length,
    through: last.t + ms,
    complete,
  };
}

// ───────────────────────── plakietka i opis źródła ─────────────────────────

/** Plakietka wartości: LIVE tylko wtedy, gdy wszystkie liczby (np. dziś i wczoraj) są z taśmy; inaczej MODEL. */
export function valueBadge(...refs: readonly Pick<ValueRef, 'source'>[]): 'LIVE' | 'MODEL' {
  return refs.length > 0 && refs.every((r) => r.source === 'tape') ? 'LIVE' : 'MODEL';
}

const share = (x: number) => `${fmtFixed(Math.floor(x * 100), 0)}%`;

/** Nazwa metody przy MODEL („przybliżenie ze świec”). */
export const CANDLE_METHOD = tr('przybliżenie ze świec', 'approximation from candles');

/** Dopisek źródła: „taśma 97%” albo „przybliżenie, taśma 42%”. */
export function valueNote(r: Pick<ValueRef, 'source' | 'tapeShare'>): string {
  return r.source === 'tape' ? tr(`taśma ${share(r.tapeShare)}`, `tape ${share(r.tapeShare)}`) : tr(`przybliżenie, taśma ${share(r.tapeShare)}`, `approximation, tape ${share(r.tapeShare)}`);
}

/** Opis metody profilu do podpowiedzi (jedno źródło: value area 70%, koszyki 5 pb). */
export function valueMethodText(r: Pick<ValueRef, 'source' | 'tapeShare'>): string {
  return r.source === 'tape'
    ? tr(
        `Profil wolumenu z taśmy Hyperliquid (${share(r.tapeShare)} wolumenu okresu nagrane, reszta ze świec 5m), VA (wolumen) 70%, koszyki 5 pb.`,
        `Volume profile from the Hyperliquid tape (${share(r.tapeShare)} of the period volume recorded, the rest from 5m candles), 70% VA (volume), 5 bp bins.`
      )
    : tr(
        `Przybliżenie ze świec 5m (wolumen świecy rozłożony równo na jej zakres; taśma ${share(r.tapeShare)} wolumenu okresu, mniej niż ${share(TAPE_MIN_SHARE)}), VA (wolumen) 70%, koszyki 5 pb.`,
        `An approximation from 5m candles (candle volume spread evenly over its range; tape ${share(r.tapeShare)} of the period volume, under ${share(TAPE_MIN_SHARE)}), 70% VA (volume), 5 bp bins.`
      );
}

/** Nazwa okresu do opisu: „doba UTC 15.11” albo „sesja Nowy Jork 15.11”. */
export function valuePeriodName(p: ValuePeriod): string {
  const d = new Date(p.kind === 'day' ? p.from : utcDayStart(p.from));
  const dm = `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (p.kind === 'day') return tr(`doba UTC ${dm}`, `UTC day ${dm}`);
  const name = SESSION_LABEL[p.session ?? 'asia'];
  return tr(`sesja ${name} ${dm}`, `${name} session ${dm}`);
}
