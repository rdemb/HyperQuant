import type { Candle } from '../hl/parse';
import { TPO_PERIOD_MS, tpoProfiles } from '../core/tpo';
import { IB_MS } from '../core/indicators';
import { sessionOpens } from '../core/sessions';
import { DAY, intervalById } from '../core/time';
import { indicatorDef, parseParams } from '../indicators/registry';
import { baseTick } from '../core/footprintBar';
import { autoRowStep } from './layout';
import { type Rate, wilson } from '../../../utils/auction';
import { fmtFixed } from '../../../ui/format';
import { tr } from '../../../i18n';

/**
 * Karta uczciwości szablonu: opis historii na świecach z API (ok. 5000 ostatnich), liczony w przeglądarce czytelnika.
 * Każda liczba ma liczebność i 95% przedział Wilsona; poniżej MIN_CASES przypadków karta mówi „za mało przypadków”.
 * To nie jest test strategii: bez kosztów, wykonania i kierunku. Ostatnia świeca tablicy to świeca bieżąca
 * (niezamknięta), więc nie wchodzi do żadnego wyniku.
 */

export const MIN_CASES = 20;
/** Wiersz profilu TPO w statystyce: najmniejszy krok z drabiny ticków wykresu ≥ 0,04% ceny (BTC przy 110 tys.: 50 USD). */
export const STATS_ROW_PCT = 0.0004;
/** Okno zakresu po wyjściu ze ściśnięcia (świece). */
export const SQUEEZE_AFTER = 8;

const rate = (k: number, n: number): Rate => ({ k, n, ci: wilson(k, n) });

const median = (xs: number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const statsRowStep = (px: number): number => (px > 0 ? autoRowStep(1, baseTick(px), px * STATS_ROW_PCT) : 0);

export interface VaStats {
  /** Doby oceniane (pełna doba poprzednia i pełna doba bieżąca, kolejne). */
  days: number;
  /** Otwarcie doby poza wczorajszą VA. */
  outside: number;
  /** n: otwarcia poza VA z powrotem (dwa kolejne okresy 30 min z zamknięciem w VA); k: dojście do drugiej krawędzi VA. */
  filled: Rate;
}

/**
 * Reguła wartości Daltona na TPO dób UTC (świece 30m, jedna świeca = jeden okres TPO): otwarcie doby poza VA 70%
 * poprzedniej doby, potem dwa kolejne okresy z zamknięciem w tej VA. Wynik: czy cena dotknęła przeciwległej krawędzi
 * VA przed końcem doby, licząc dopiero od okresu po potwierdzeniu (bez podglądania). Ta sama definicja co reguła 80%
 * w Planie (`utils/auction.ts`), ale na VA czasowej z TPO, którą rysuje szablon.
 */
export function vaStats(bars: readonly Candle[], step = statsRowStep(bars[bars.length - 1]?.c ?? 0)): VaStats {
  const closed = bars.slice(0, -1);
  const out = { days: 0, outside: 0, k: 0, n: 0 };
  if (closed.length === 0 || !(step > 0)) return { days: 0, outside: 0, filled: rate(0, 0) };
  const profiles = tpoProfiles(
    closed.map((c) => ({ t: c.t, candle: c })),
    step
  );
  for (let i = 1; i < profiles.length; i++) {
    const prev = profiles[i - 1];
    const cur = profiles[i];
    // Obie doby pełne: od 00:00 UTC, 48 kolejnych okresów, bez luk
    const full = (p: typeof prev) => p.to - p.from + 1 === DAY / TPO_PERIOD_MS && closed[p.from].t === p.day;
    if (cur.day - prev.day !== DAY || !full(prev) || !full(cur)) continue;
    out.days++;
    const val = (prev.lo + prev.vaLo) * step;
    const vah = (prev.lo + prev.vaHi + 1) * step;
    const open = closed[cur.from].o;
    const above = open > vah;
    if (!above && !(open < val)) continue;
    out.outside++;
    const inVa = (c: number) => c >= val && c <= vah;
    for (let j = cur.from; j < cur.to; j++) {
      if (!inVa(closed[j].c) || !inVa(closed[j + 1].c)) continue;
      // Potwierdzenie na zamknięciu okresu j + 1; potrzebny co najmniej jeden okres po nim
      if (j + 2 > cur.to) break;
      out.n++;
      for (let r = j + 2; r <= cur.to; r++) {
        if (above ? closed[r].l <= val : closed[r].h >= vah) {
          out.k++;
          break;
        }
      }
      break;
    }
  }
  return { days: out.days, outside: out.outside, filled: rate(out.k, out.n) };
}

export interface IbStats {
  /** Sesje NY (dni robocze) z pełnym IB i pełną resztą sesji do 00:00 UTC. */
  sessions: number;
  up: Rate;
  down: Rate;
  both: Rate;
  none: Rate;
  /** Mediana większego z wyjść poza IB (w górę albo w dół) w zakresach IB; sesje bez wyjścia liczą się jako 0. */
  medianExt: number;
}

/**
 * Initial balance sesji Nowy Jork (pierwsza godzina od 9:30 czasu nowojorskiego, jak warstwa IB wykresu) w dni robocze:
 * czy reszta sesji (do 00:00 UTC) wyszła poza IB tylko w górę, tylko w dół, w obie strony albo wcale. Świece 30m dzielą
 * IB na dwa okresy bez reszty, a szczyt i dołek reszty sesji są dokładne niezależnie od interwału.
 */
export function ibStats(bars: readonly Candle[], intervalMs = TPO_PERIOD_MS): IbStats {
  const closed = bars.slice(0, -1);
  const byT = new Map<number, number>();
  closed.forEach((c, i) => byT.set(c.t, i));
  const c = { up: 0, down: 0, both: 0, none: 0, n: 0 };
  const ext: number[] = [];
  if (closed.length > 0) {
    for (let day = Math.floor(closed[0].t / DAY) * DAY; day <= closed[closed.length - 1].t; day += DAY) {
      const dow = new Date(day).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const ny = sessionOpens(day)[2];
      const end = day + DAY;
      const i0 = byT.get(ny);
      const iLast = byT.get(end - intervalMs);
      // Sesja w całości w świecach zamkniętych i bez luk
      if (i0 === undefined || iLast === undefined || iLast - i0 + 1 !== (end - ny) / intervalMs) continue;
      let ibHi = Number.NEGATIVE_INFINITY;
      let ibLo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let lo = Number.POSITIVE_INFINITY;
      for (let i = i0; i <= iLast; i++) {
        const b = closed[i];
        if (b.t < ny + IB_MS) {
          ibHi = Math.max(ibHi, b.h);
          ibLo = Math.min(ibLo, b.l);
        } else {
          hi = Math.max(hi, b.h);
          lo = Math.min(lo, b.l);
        }
      }
      const range = ibHi - ibLo;
      if (!(range > 0)) continue;
      const up = hi > ibHi;
      const down = lo < ibLo;
      c.n++;
      if (up && down) c.both++;
      else if (up) c.up++;
      else if (down) c.down++;
      else c.none++;
      ext.push(Math.max(0, hi - ibHi, ibLo - lo) / range);
    }
  }
  return {
    sessions: c.n,
    up: rate(c.up, c.n),
    down: rate(c.down, c.n),
    both: rate(c.both, c.n),
    none: rate(c.none, c.n),
    medianExt: median(ext),
  };
}

export interface SqueezeStats {
  /** Świece z wartością obu wstęg (po rozbiegu) i z nich świece w ściśnięciu. */
  bars: number;
  inSqueeze: number;
  /** Wyjścia ze ściśnięcia (okna 8 świec po nich nie nakładają się); k = zakres okna większy niż mediana wszystkich okien. */
  wider: Rate;
  /** Mediana zakresu okna po wyjściu przez medianę zakresu okna w dowolnej chwili. */
  ratio: number;
}

/**
 * Ściśnięcie zmienności (Carter): BB(20, 2) w całości wewnątrz KC(20, 1,5, ATR 10), wzory jak wskaźniki wykresu.
 * Wyjście = pierwsza świeca z BB poza KC po świecy w ściśnięciu. Zakres okna = (najwyższy szczyt − najniższy dołek)
 * 8 kolejnych zamkniętych świec po świecy wyjścia, przez zamknięcie świecy wyjścia (bez kierunku). Odniesienie: to samo
 * okno po każdej świecy historii.
 */
export function squeezeStats(bars: readonly Candle[], after = SQUEEZE_AFTER): SqueezeStats {
  const closed = bars.slice(0, -1);
  const bbDef = indicatorDef('bb');
  const kcDef = indicatorDef('keltner');
  const bb = bbDef.create!(parseParams(bbDef, { length: 20, mult: 2 }));
  const kc = kcDef.create!(parseParams(kcDef, { length: 20, mult: 1.5, atr: 10 }));
  const ob = new Float64Array(3);
  const ok = new Float64Array(3);
  // 1 = ściśnięcie, 0 = brak, −1 = rozbieg (brak wartości)
  const sq = new Int8Array(closed.length);
  let n = 0;
  let inSq = 0;
  closed.forEach((c, i) => {
    bb(c, true, ob);
    kc(c, true, ok);
    if (![ob[1], ob[2], ok[1], ok[2]].every(Number.isFinite)) {
      sq[i] = -1;
      return;
    }
    n++;
    sq[i] = ob[1] < ok[1] && ob[2] > ok[2] ? 1 : 0;
    if (sq[i] === 1) inSq++;
  });
  const windowRange = (i: number): number => {
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j <= i + after; j++) {
      hi = Math.max(hi, closed[j].h);
      lo = Math.min(lo, closed[j].l);
    }
    return (hi - lo) / closed[i].c;
  };
  const all: number[] = [];
  const rel: number[] = [];
  let next = 0;
  for (let i = 0; i + after < closed.length; i++) {
    if (sq[i] < 0) continue;
    const r = windowRange(i);
    all.push(r);
    if (i >= next && i > 0 && sq[i - 1] === 1 && sq[i] === 0) {
      rel.push(r);
      next = i + after;
    }
  }
  const typical = median(all);
  const wider = rel.filter((r) => r > typical).length;
  return {
    bars: n,
    inSqueeze: inSq,
    wider: rate(wider, rel.length),
    ratio: median(rel) / typical,
  };
}

// ───────────────────────── karta ─────────────────────────

export type HonestyKind = 'va' | 'ib' | 'squeeze';

/**
 * Szablon → karta uczciwości i interwał świec, na których liczy: VA i IB zawsze z 30m (definicja okresu TPO i godziny IB),
 * ściśnięcie z interwału szablonu, a w karcie z własnym interwałem (zestawy kart MTF) z interwału karty.
 */
export const TEMPLATE_HONESTY: Readonly<Record<string, { kind: HonestyKind; interval: string }>> = {
  tpo: { kind: 'va', interval: '30m' },
  'open-range': { kind: 'ib', interval: '30m' },
  squeeze: { kind: 'squeeze', interval: '15m' },
};

export type HonestyStats = { kind: 'va'; s: VaStats } | { kind: 'ib'; s: IbStats } | { kind: 'squeeze'; s: SqueezeStats; days: number; interval: string };

/** Statystyka karty na świecach interwału `interval` (ostatnia świeca — bieżąca). */
export function honestyStats(kind: HonestyKind, bars: readonly Candle[], interval = '15m'): HonestyStats {
  if (kind === 'va') return { kind, s: vaStats(bars) };
  if (kind === 'ib') return { kind, s: ibStats(bars) };
  const days = bars.length > 1 ? Math.round((bars[bars.length - 1].t - bars[0].t) / DAY) : 0;
  return { kind, s: squeezeStats(bars), days, interval };
}

export interface HonestyCard {
  intro: string;
  rows: [label: string, value: string][];
}

const pc = (p: number) => `${Math.round(p * 100)}%`;
/** „9 z 20 = 45% (27–64%)” albo „9 z 12: za mało przypadków” poniżej MIN_CASES. */
export function rateText(r: Rate): string {
  const base = tr(`${r.k} z ${r.n}`, `${r.k} of ${r.n}`);
  if (!r.ci || r.n < MIN_CASES) return `${base}: ${tr('za mało przypadków', 'too few cases')}`;
  return `${base} = ${pc(r.ci.p)} (${Math.round(r.ci.lo * 100)}–${pc(r.ci.hi)})`;
}

const few = (n: number): [string, string] => [tr('Przypadki', 'Cases'), tr(`${n}: za mało (potrzeba ${MIN_CASES})`, `${n}: too few (${MIN_CASES} needed)`)];

/** Treść karty: zdanie o danych i wiersze „etykieta: wartość”; liczby zawsze z liczebnością i 95% przedziałem Wilsona. */
export function honestyCard(h: HonestyStats): HonestyCard {
  if (h.kind === 'va') {
    const { days, outside, filled } = h.s;
    return {
      intro: tr(
        `TPO dób UTC ze świec 30m, ostatnie ${days} pełnych dób; VA 70% liczona z czasu (liter), jak na wykresie.`,
        `UTC-day TPO from 30m candles, the last ${days} full days; the 70% VA counted from time (letters), as on the chart.`
      ),
      rows: [
        [tr('Otwarcie doby poza wczorajszą VA', 'Day opened outside yesterday’s VA'), tr(`${outside} z ${days}`, `${outside} of ${days}`)],
        [tr('Potem powrót: 2 okresy 30 min z zamknięciem w VA', 'Then back in: 2 periods of 30 min closing in VA'), String(filled.n)],
        [tr('Z nich doszło do drugiej krawędzi VA przed końcem doby', 'Of those, reached the other VA edge before the day ended'), rateText(filled)],
      ],
    };
  }
  if (h.kind === 'ib') {
    const s = h.s;
    const intro = tr(
      `Sesje Nowego Jorku w dni robocze, ostatnie ${s.sessions}; IB = pierwsza godzina od 9:30 czasu NY, reszta sesji do 00:00 UTC.`,
      `New York sessions on weekdays, the last ${s.sessions}; IB = the first hour from 9:30 NY time, the rest of the session until 00:00 UTC.`
    );
    if (s.sessions < MIN_CASES) return { intro, rows: [few(s.sessions)] };
    return {
      intro,
      rows: [
        [tr('Wyjście poza IB tylko w górę', 'Left the IB only upward'), rateText(s.up)],
        [tr('Tylko w dół', 'Only downward'), rateText(s.down)],
        [tr('W obie strony', 'Both ways'), rateText(s.both)],
        [tr('Wcale', 'Not at all'), rateText(s.none)],
        [
          tr('Mediana większego wyjścia', 'Median of the larger move out'),
          tr(`${fmtFixed(s.medianExt, 2)} × zakresu IB`, `${fmtFixed(s.medianExt, 2)} × the IB range`),
        ],
      ],
    };
  }
  const s = h.s;
  const iv = intervalById(h.interval).label;
  const intro = tr(
    `Świece ${iv} z ostatnich ${h.days} dni; ściśnięcie = BB(20, 2) w całości w KC(20, 1,5, ATR 10).`,
    `${iv} candles from the last ${h.days} days; squeeze = BB(20, 2) fully inside KC(20, 1.5, ATR 10).`
  );
  const share: [string, string] = [
    tr('Świece w ściśnięciu', 'Candles in a squeeze'),
    s.bars > 0 ? tr(`${pc(s.inSqueeze / s.bars)} z ${s.bars}`, `${pc(s.inSqueeze / s.bars)} of ${s.bars}`) : '0',
  ];
  if (s.wider.n < MIN_CASES) return { intro, rows: [share, few(s.wider.n)] };
  return {
    intro,
    rows: [
      share,
      [
        tr(`Zakres ${SQUEEZE_AFTER} świec po wyjściu wobec typowego`, `Range of ${SQUEEZE_AFTER} candles after the release vs typical`),
        tr(`${fmtFixed(s.ratio, 2)} × (mediany)`, `${fmtFixed(s.ratio, 2)} × (medians)`),
      ],
      [tr('Większy niż typowy (bez związku ok. 50%)', 'Wider than typical (no link: about 50%)'), rateText(s.wider)],
    ],
  };
}
