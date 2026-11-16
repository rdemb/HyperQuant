import { tr } from '../../../i18n';
import type { Got } from '../../../utils/sessionText';
import { utcDayStart } from './sessions';
import { DAY } from './time';
import { CANDLE_METHOD, VALUE_MS, type ValueBar, type ValueRef, type ValueSource, toFiveMinutes, valueBadge, valueNote, valueReference } from './valueReference';

/**
 * Nagie POC dób UTC warstwami według wieku doby (decyzja Pioniera, 16.11.2026), każdy POC z plakietką swojego źródła:
 * - do NAKED_VALUE_DAYS dób — jedno źródło wartości (`valueReference`: taśma albo świece 5m), jak pasek Rama dnia;
 * - starsze, od początku archiwum świec 1m (19.10.2026) — POC ze świec 5m złożonych ze świec 1m archiwum skanera, tą
 *   samą funkcją profilu, więc ten sam wynik co świece 5m Hyperliquid bez taśmy (MODEL „przybliżenie ze świec 1m”);
 * - jeszcze starsze, do NAKED_HOUR_DAYS dób — ze świec 1h (MODEL „przybliżenie z 1h”).
 * POC jest nagi, gdy żadna późniejsza świeca go nie dotknęła; rynek 24/7 łączy się ceną, więc wystarczy najniższy dołek
 * i najwyższy szczyt po dobie. Doba, której cały zakres cena już potem objęła, nie może mieć nagiego POC — dla niej nie
 * pobieramy archiwum 1m. Najwyżej NAKED_SHOWN najbliższych cenie.
 */

export const NAKED_VALUE_DAYS = 14;
export const NAKED_HOUR_DAYS = 200;
export const NAKED_SHOWN = 6;
/** Pierwsza doba archiwum świec 1m skanera (gałąź `archive` repo danych, BTC/1m). */
export const ARCHIVE_1M_FROM = Date.UTC(2026, 9, 19);

const HOUR = 3_600_000;

/** Warstwa źródła POC: jedno źródło wartości (taśma albo świece 5m), archiwum świec 1m albo świece 1h. */
export type PocLayer = 'value' | '1m' | '1h';

export interface NakedPoc {
  day: number;
  px: number;
  /** Wiek doby w dobach (1 — wczoraj). */
  age: number;
  layer: PocLayer;
  ref: ValueRef;
}

export interface NakedPocs {
  /** Najbliższe cenie, rosnąco po odległości (najwyżej NAKED_SHOWN). */
  list: NakedPoc[];
  /** Doby z policzonym POC. */
  days: number;
  /** Doby, których archiwum 1m jeszcze się wczytuje. */
  pending: number;
}

export interface NakedInput {
  now: number;
  price: number;
  /** Jedno źródło wartości: świece 5m z taśmą od NAKED_VALUE_DAYS dób wstecz. */
  value: ValueSource;
  /** Świece 1h (do NAKED_HOUR_DAYS dób wstecz) — warstwa najstarsza i zakresy dób. */
  hours: readonly ValueBar[];
  /** Świece 1m doby z archiwum: lista, null (brak pliku — warstwa 1h) albo undefined (wczytuje się). Bez — rynek bez archiwum. */
  minuteDay?: (day: number) => readonly ValueBar[] | null | undefined;
}

/** Plakietka POC: z taśmy LIVE, inaczej MODEL. */
export const pocBadge = (p: NakedPoc): 'LIVE' | 'MODEL' => (p.layer === 'value' ? valueBadge(p.ref) : 'MODEL');

/** Krótki opis źródła POC: „taśma 97%”, „przybliżenie, taśma 40%”, „przybliżenie ze świec 1m (archiwum)”, „przybliżenie z 1h”. */
export function pocSource(p: NakedPoc): string {
  if (p.layer === 'value') return valueNote(p.ref);
  return p.layer === '1m' ? tr('przybliżenie ze świec 1m (archiwum)', 'approximation from 1m candles (archive)') : tr('przybliżenie z 1h', 'approximation from 1h');
}

/** Nazwa metody przy MODEL: „przybliżenie ze świec” (5m), „przybliżenie ze świec 1m”, „przybliżenie z 1h”. */
export function pocMethod(p: NakedPoc): string {
  if (p.layer === 'value') return CANDLE_METHOD;
  return p.layer === '1m' ? tr('przybliżenie ze świec 1m', 'approximation from 1m candles') : tr('przybliżenie z 1h', 'approximation from 1h');
}

/** Najniższy dołek i najwyższy szczyt świec od chwili `t` (świece rosnąco, sufiksy). */
function afterRange(bars: readonly ValueBar[]): (t: number) => { lo: number; hi: number } | null {
  const n = bars.length;
  const lo = new Float64Array(n + 1).fill(Infinity);
  const hi = new Float64Array(n + 1).fill(-Infinity);
  for (let i = n - 1; i >= 0; i--) {
    lo[i] = Math.min(lo[i + 1], bars[i].l);
    hi[i] = Math.max(hi[i + 1], bars[i].h);
  }
  return (t) => {
    let a = 0;
    let z = n;
    while (a < z) {
      const m = (a + z) >> 1;
      if (bars[m].t < t) a = m + 1;
      else z = m;
    }
    return a < n ? { lo: lo[a], hi: hi[a] } : null;
  };
}

/** Nagie POC dób sprzed dziś warstwami źródeł; bez świec — powód. */
export function nakedPocs(x: NakedInput): Got<NakedPocs> {
  if (!(x.price > 0)) return { why: tr('Brak ceny', 'No price') };
  if (x.value.bars.length === 0 && x.hours.length === 0) return { why: tr('Czekam na świece 5m', 'Waiting for 5m candles') };
  const today = utcDayStart(x.now);
  // Zakresy po dobie: świece 1h i 5m razem (te same ceny; 5m dokładniej przy bieżącej świecy)
  const all = [...x.hours, ...x.value.bars].sort((a, b) => a.t - b.t);
  const after = afterRange(all);
  const hourSrc: ValueSource = { bars: x.hours, ms: HOUR };
  // Zakres każdej doby ze świec 1h (jeden przebieg)
  const ranges = new Map<number, { lo: number; hi: number }>();
  for (const h of x.hours) {
    const d = utcDayStart(h.t);
    const r = ranges.get(d);
    if (r) {
      r.lo = Math.min(r.lo, h.l);
      r.hi = Math.max(r.hi, h.h);
    } else ranges.set(d, { lo: h.l, hi: h.h });
  }
  const found: NakedPoc[] = [];
  let days = 0;
  let pending = 0;
  for (let age = 1; age <= NAKED_HOUR_DAYS; age++) {
    const d = today - age * DAY;
    const post = after(d + DAY);
    if (!post) continue;
    // Cały zakres doby objęty później: POC na pewno dotknięty (bez liczenia i bez pobierania archiwum)
    const r = ranges.get(d);
    if (r && r.lo >= post.lo && r.hi <= post.hi) continue;
    let layer: PocLayer = age <= NAKED_VALUE_DAYS ? 'value' : '1h';
    let src: ValueSource = layer === 'value' ? x.value : hourSrc;
    if (layer === '1h' && x.minuteDay && d >= ARCHIVE_1M_FROM) {
      const m = x.minuteDay(d);
      if (m === undefined) {
        pending++;
        continue;
      }
      if (m !== null) {
        // Świece 5m złożone z minut archiwum: ten sam profil co świece 5m Hyperliquid (bez taśmy)
        layer = '1m';
        src = { bars: toFiveMinutes(m), ms: VALUE_MS };
      }
    }
    const ref = valueReference('day', d, src, x.now);
    if (!ref) continue;
    days++;
    if (ref.poc >= post.lo && ref.poc <= post.hi) continue;
    found.push({ day: d, px: ref.poc, age, layer, ref });
  }
  if (found.length === 0) {
    return pending > 0
      ? { why: tr(`Czekam na archiwum świec 1m (${pending} dób)`, `Waiting for the 1m candle archive (${pending} days)`) }
      : { why: tr(`Brak nagiego POC w ${days} dobach`, `No naked POC in ${days} days`) };
  }
  found.sort((a, b) => Math.abs(a.px - x.price) - Math.abs(b.px - x.price));
  return { list: found.slice(0, NAKED_SHOWN), days, pending };
}
