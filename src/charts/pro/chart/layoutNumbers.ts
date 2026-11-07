import type { Candle, Side } from '../hl/parse';
import type { Branching } from '../core/hawkes';
import type { LiqLevel } from '../core/indicators';
import { utcDayStart } from '../core/sessions';
import { fmtDayTime, fmtDm, fmtHm, fmtHms } from '../core/time';
import { scannerAge } from './layerSources';
import { WAIT_TEXT } from '../../../utils/sessionText';
import { fmtPx } from './layout';
import type { StationId } from './stations';
import { profile, profileStep, toVBars } from '../../../utils/auction';
import { vaMigration } from '../../../utils/dayType';
import { dayVwapOf, vwapSigma } from '../../../utils/dayVwap';
import type { MapKind } from '../../../utils/mapSettlement';
import { rvolOf } from '../../../utils/rvolOf';
import { type TradeSession, rangeBudget } from '../../../utils/sessionDay';
import { type SessionFacts, type SessionNow, dayTypeOf, sessionNowOf, vaMissing } from '../../../utils/sessionFacts';
import { TRADE_SESSION_NAME } from '../../../utils/sessionNames';
import {
  type Absent,
  DAY_TYPE_LABEL,
  type Expected,
  type Got,
  METHOD,
  METHOD_NOTE,
  VA_MIGRATION_LABEL,
  VOL_WAIT_TEXT,
  amt,
  blogMapName,
  isAbsent,
  mapHitsText,
  pctOf,
} from '../../../utils/sessionText';
import { DASH, fmtFixed, fmtPct, fmtSigned } from '../../../ui/format';
import { tr } from '../../../i18n';

/**
 * Nagłówek układu (spec §7.3): trzy liczby właściwe dla pytania układu, każda z plakietką LIVE albo MODEL (MODEL z nazwą
 * metody w podpowiedzi). Liczby pochodzą z danych, które przeglądarka już ma (świece magazynu wykresu, taśma, arkusz,
 * migawki skanera, model zmienności HAR). Brak danych to „—” z powodem w podpowiedzi, nigdy 0 ani liczba zastępcza.
 * Opis, nie sygnał: bez kierunku transakcji i zaleceń.
 */

export interface LayoutNumber {
  label: string;
  /** Liczba albo „—”. */
  value: string;
  badge: 'LIVE' | 'MODEL';
  /** Skąd liczba (MODEL: „MODEL · metoda: …”) albo powód braku. */
  hint: string;
  /** Zamiast plakietki: wiek migawki skanera starszej niż 2 min (np. „4 min”) albo „tylko BTC”. */
  note?: string;
  /** Krótszy podpis na telefon (trzy liczby mieszczą się w jednej linii 390 px); bez niego — `label`. */
  short?: string;
}

// Wspólne z Rozliczeniem sesji (utils/sessionText, utils/auction) — dawne miejsce eksportu
export { type Absent, type Expected, type Got, isAbsent, profileStep, toVBars };
// Liczby ze świec bez modułów wykresu (utils/dayVwap, utils/sessionFacts, utils/rvolOf; też serwer MCP) — dawne miejsce eksportu
export { type SessionNow, dayVwapOf, rvolOf, sessionNowOf };

/** Sesja do rozliczenia w nagłówku (w toku albo ostatnia zamknięta): fakty ze świec 1m, te same co na karcie Rozliczenia. */
export type ReviewFacts = SessionFacts & { inProgress: boolean };

/**
 * Rozliczenie mapy z bloga sesji `s` (ta sama sesja co typ dnia i migracja VA; ta sama reguła co ✓ warstwy): dotknięte
 * poziomy od wpisu do końca sesji, [from, to).
 */
export interface MapHits {
  s: TradeSession;
  kind: MapKind;
  publishedAt: number;
  touched: number;
  total: number;
  /** Świece 1m każdej pełnej minuty okresu; bez nich niedotknięte poziomy są nierozliczone. */
  complete: boolean;
  from: number;
  to: number;
}

/** Wejścia nagłówka; pole bez wartości (`undefined`) — jeszcze się wczytuje. */
export interface LayoutInputs {
  coin: string;
  now: number;
  /** Ostatnia cena rynku. */
  price?: Got<number>;
  /** VWAP doby UTC ze świec 1m (jak linia VWAP na wykresie). */
  dayVwap?: Got<{ vwap: number; sd: number }>;
  session?: Got<SessionNow>;
  /** Oczekiwany zakres sesji w toku (MODEL). */
  expected?: Got<Expected>;
  /** Model HAR (BTC) w drodze: `expected` czeka na niego (powód „czekam na model zmienności”), bez Parkinsona w zastępstwie. */
  volLoading?: boolean;
  rvol?: Got<{ value: number; n: number; hour: number }>;
  prevDay?: Got<{ day: number; vah: number; val: number }>;
  nakedPoc?: Got<{ day: number; px: number }>;
  liq?: Got<{ px: number; ntlUsd: number; side: 'long' | 'short'; asOf: number }>;
  cost?: Got<{ ask: number; bid: number; at: number }>;
  twap?: Got<{ share: number; buy: number; sell: number }>;
  hawkes?: Got<Branching>;
  whales?: Got<{ long: number; short: number; n: number; asOf: number }>;
  review?: Got<ReviewFacts>;
  /** Poziomy mapy z bloga dotknięte w jej oknie (BTC). */
  mapHits?: Got<MapHits>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno udziału TWAP i dopasowania Hawkesa (jak domyślne okno wskaźnika Hawkesa). */
export const FLOW_WINDOW_MS = 15 * MIN;
/** Kwota zlecenia do kosztu wejścia. */
export const COST_USD = 100_000;

const WAIT = WAIT_TEXT;
const val = <T>(v: Got<T> | undefined): T | null => (v === undefined || isAbsent(v) ? null : v);
/** Powód pierwszego brakującego wejścia. */
const whyOf = (...vs: (Got<unknown> | undefined)[]): string => {
  for (const v of vs) {
    if (v === undefined) return WAIT;
    if (isAbsent(v)) return v.why;
  }
  return WAIT;
};
const dash = (label: string, badge: LayoutNumber['badge'], hint: string, note?: string): LayoutNumber => ({ label, value: DASH, badge, hint, ...(note ? { note } : {}) });

/** Kwota w USD w kilku znakach: 4,2M, 42M, 1,2B. */
function usdShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${fmtFixed(a / 1e9, a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}${fmtFixed(a / 1e6, a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}${fmtFixed(a / 1e3, a >= 1e4 ? 0 : 1)}K`;
  return `${sign}${fmtFixed(a, 0)}`;
}
/** Data doby UTC (DD.MM). */
const utcDm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const sessionName = (s: TradeSession) => TRADE_SESSION_NAME[s.id];

// ───────────────────────── liczby ─────────────────────────

/** Odległość ceny od VWAP doby UTC w σ (Kokpit; ta sama liczba w Czwórce Przed sesją). */
export function vwapNum(x: LayoutInputs): LayoutNumber {
  const label = 'VWAP';
  const v = val(x.dayVwap);
  const p = val(x.price);
  if (!v || p === null) return dash(label, 'LIVE', whyOf(x.dayVwap, x.price));
  const z = vwapSigma(p, v.vwap, v.sd);
  if (z === null) return dash(label, 'LIVE', tr('Odchylenie od VWAP jeszcze bez znaczenia: za mało świec od 00:00 UTC', 'The VWAP deviation is not meaningful yet: too few candles since 00:00 UTC'));
  const sz = fmtSigned(z, 1, 'σ');
  return {
    label,
    value: sz,
    badge: 'LIVE',
    hint: tr(
      `Cena ${fmtPx(p)} wobec VWAP doby UTC ${fmtPx(v.vwap)} (σ ${amt(v.sd)}): ${sz}. VWAP ze świec 1m od 00:00 UTC, jak linia VWAP na wykresie.`,
      `Price ${fmtPx(p)} against the UTC-day VWAP ${fmtPx(v.vwap)} (σ ${amt(v.sd)}): ${sz}. VWAP from 1m candles since 00:00 UTC, like the VWAP line on the chart.`
    ),
  };
}

/**
 * Budżet zakresu sesji. HAR to metoda domyślna (BTC z modelem); liczba z Parkinsona (model nie wczytał się, inny rynek)
 * ma nazwę metody na etykiecie („Budżet · NY · Parkinson”, na telefonie „Budżet (P)”) — także w tytule Klatki. Model w drodze:
 * „—” z powodem, nigdy Parkinson na chwilę przed HAR.
 */
function budgetNum(x: LayoutInputs): LayoutNumber {
  const sn = val(x.session);
  const e = val(x.expected);
  const park = e?.method === 'parkinson';
  const label = !sn
    ? tr('Budżet zakresu', 'Range budget')
    : park
      ? tr(`Budżet · ${sessionName(sn.s)} · Parkinson`, `Budget · ${sessionName(sn.s)} · Parkinson`)
      : tr(`Budżet · ${sessionName(sn.s)}`, `Budget · ${sessionName(sn.s)}`);
  const short = park ? tr('Budżet (P)', 'Budget (P)') : tr('Budżet', 'Budget');
  if (sn && x.expected === undefined && x.volLoading) return { ...dash(label, 'MODEL', `MODEL · HAR: ${VOL_WAIT_TEXT}`), short };
  if (!sn || !e) return { ...dash(label, 'MODEL', tr(`MODEL · HAR albo Parkinson: ${whyOf(x.session, x.expected)}`, `MODEL · HAR or Parkinson: ${whyOf(x.session, x.expected)}`)), short };
  const m = METHOD[e.method];
  const b = rangeBudget(sn.hi, sn.lo, e.usd);
  if (!Number.isFinite(b)) return { ...dash(label, 'MODEL', tr(`MODEL · ${m}: brak zakresu sesji`, `MODEL · ${m}: no session range`)), short };
  return {
    label,
    short,
    value: pctOf(b),
    badge: 'MODEL',
    hint: tr(
      `MODEL · ${m}: sesja ${sessionName(sn.s)} od ${fmtHm(sn.s.start)} zużyła ${pctOf(b)} oczekiwanego zakresu: ${amt(sn.hi - sn.lo)} USD (${fmtPx(sn.lo)}–${fmtPx(sn.hi)}) z oczekiwanych ${amt(e.usd)} USD. ${METHOD_NOTE[e.method]}`,
      `MODEL · ${m}: the ${sessionName(sn.s)} session since ${fmtHm(sn.s.start)} has used ${pctOf(b)} of its expected range: ${amt(sn.hi - sn.lo)} USD (${fmtPx(sn.lo)}–${fmtPx(sn.hi)}) of an expected ${amt(e.usd)} USD. ${METHOD_NOTE[e.method]}`
    ),
  };
}

function rvolNum(x: LayoutInputs): LayoutNumber {
  const method = tr('mediana 20 dni', '20-day median');
  const r = val(x.rvol);
  if (!r) return dash('RVOL', 'MODEL', `MODEL · ${method}: ${whyOf(x.rvol)}`);
  const v = `${fmtFixed(r.value, 1)}×`;
  const hh = String(new Date(r.hour).getUTCHours()).padStart(2, '0');
  return {
    label: 'RVOL',
    value: v,
    badge: 'MODEL',
    hint: tr(
      `MODEL · ${method}: wolumen bieżącej godziny (${hh}:00 UTC) wobec mediany tej godziny z ${r.n} dni, przeskalowanej do upływu godziny: ${v}. 1× — typowy wolumen o tej porze.`,
      `MODEL · ${method}: the current hour's volume (${hh}:00 UTC) against the median of this hour over ${r.n} days, scaled to the elapsed part of the hour: ${v}. 1× is the typical volume at this time.`
    ),
  };
}

/** Odległość poziomu od ceny w % (dodatnia — poziom nad ceną). */
const distPct = (level: number, price: number) => (level / price - 1) * 100;
const side = (d: number) => (d >= 0 ? tr('nad ceną', 'above the price') : tr('pod ceną', 'below the price'));

function vaEdgeNum(x: LayoutInputs, edge: 'vah' | 'val'): LayoutNumber {
  const name = edge === 'vah' ? 'VAH' : 'VAL';
  const label = tr(`${name} wczoraj`, `${name} yesterday`);
  const d = val(x.prevDay);
  const p = val(x.price);
  if (!d || p === null) return dash(label, 'LIVE', whyOf(x.prevDay, x.price));
  const lv = d[edge];
  const dist = distPct(lv, p);
  return {
    label,
    value: fmtPct(dist, 2),
    badge: 'LIVE',
    hint: tr(
      `${name} doby UTC ${utcDm(d.day)}: ${fmtPx(lv)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)} ${fmtPx(p)}. Value area 70% ze świec 1h (wolumen świecy rozłożony na jej zakres).`,
      `${name} of the UTC day ${utcDm(d.day)}: ${fmtPx(lv)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)} ${fmtPx(p)}. 70% value area from 1h candles (candle volume spread across its range).`
    ),
  };
}

function nakedPocNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Nagi POC', 'Naked POC');
  const n = val(x.nakedPoc);
  const p = val(x.price);
  if (!n || p === null) return dash(label, 'LIVE', whyOf(x.nakedPoc, x.price));
  const dist = distPct(n.px, p);
  return {
    label,
    value: fmtPct(dist, 2),
    badge: 'LIVE',
    hint: tr(
      `Najbliższy cenie POC zamkniętej doby UTC, którego cena potem nie dotknęła: ${fmtPx(n.px)} z doby ${utcDm(n.day)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)}. Profile dób ze świec 1h.`,
      `The POC of a closed UTC day nearest to the price that price has not touched since: ${fmtPx(n.px)} from ${utcDm(n.day)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)}. Day profiles from 1h candles.`
    ),
  };
}

function liqNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Klaster likw.', 'Liq. cluster');
  const short = tr('Klaster', 'Cluster');
  if (x.coin !== 'BTC') return { ...dash(label, 'LIVE', tr('Tylko BTC: skaner mapuje pozycje na BTC', 'BTC only: the scanner maps BTC positions'), tr('tylko BTC', 'BTC only')), short };
  const l = val(x.liq);
  const p = val(x.price);
  if (!l || p === null) return { ...dash(label, 'LIVE', whyOf(x.liq, x.price)), short };
  const dist = distPct(l.px, p);
  const age = scannerAge(l.asOf, x.now);
  return {
    label,
    short,
    value: `${fmtPct(dist, 2)} · ${usdShort(l.ntlUsd)}`,
    badge: 'LIVE',
    hint: tr(
      `Najbliższy z klastrów na wykresie: ${usdShort(l.ntlUsd)} USD likwidacji ${l.side === 'long' ? 'longów' : 'shortów'} przy ${fmtPx(l.px)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)}. Mapa skanera z pozycji on-chain, stan z ${fmtHm(l.asOf)}.`,
      `The nearest of the clusters on the chart: ${usdShort(l.ntlUsd)} USD of ${l.side === 'long' ? 'long' : 'short'} liquidations at ${fmtPx(l.px)}, ${fmtPct(Math.abs(dist), 2, false)} ${side(dist)}. Scanner map from on-chain positions, as of ${fmtHm(l.asOf)}.`
    ),
    ...(age ? { note: age } : {}),
  };
}

function costNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Koszt 100k', 'Cost 100k');
  const c = val(x.cost);
  if (!c) return dash(label, 'LIVE', whyOf(x.cost));
  const bp = (v: number) => (Number.isFinite(v) ? fmtFixed(v, 1) : DASH);
  return {
    label,
    value: `${bp(c.ask)} / ${bp(c.bid)} ${tr('pb', 'bp')}`,
    badge: 'LIVE',
    hint: tr(
      `Zlecenie rynkowe 100 000 USD po migawce dokładnego arkusza z ${fmtHms(c.at)}: ask (zbieranie asków) ${bp(c.ask)} pb, bid (zbieranie bidów) ${bp(c.bid)} pb od środka arkusza, z połową spreadu, bez opłaty takera. „—” — 20 poziomów strony nie mieści kwoty.`,
      `A 100,000 USD market order on the exact book snapshot from ${fmtHms(c.at)}: ask (taking the asks) ${bp(c.ask)} bp, bid (taking the bids) ${bp(c.bid)} bp from the book mid, including half the spread, without the taker fee. “—” means 20 levels of the side cannot hold the amount.`
    ),
  };
}

function ibNum(x: LayoutInputs): LayoutNumber {
  const sn = val(x.session);
  const label = sn ? `IB · ${sessionName(sn.s)}` : 'IB';
  if (!sn) return dash(label, 'LIVE', whyOf(x.session));
  return { ...ibBody(sn, label), short: 'IB' };
}

function ibBody(sn: SessionNow, label: string): LayoutNumber {
  const ibr = sn.ibHi - sn.ibLo;
  const range = `${fmtPx(sn.ibLo)}–${fmtPx(sn.ibHi)}`;
  if (!sn.ibDone) {
    return {
      label,
      value: tr('w budowie', 'forming'),
      badge: 'LIVE',
      hint: tr(`Initial balance to pierwsza godzina sesji, do ${fmtHm(sn.s.ibEnd)}; dotąd ${range}.`, `The initial balance is the first hour of the session, until ${fmtHm(sn.s.ibEnd)}; so far ${range}.`),
    };
  }
  if (!(ibr > 0)) return dash(label, 'LIVE', tr('Zakres IB zerowy', 'Zero IB range'));
  const up = sn.hi > sn.ibHi;
  const down = sn.lo < sn.ibLo;
  const k = `${fmtFixed((sn.hi - sn.lo) / ibr, 1)}×`;
  const value = up && down ? tr(`obie strony · ${k}`, `both sides · ${k}`) : up ? tr(`w górę · ${k}`, `up · ${k}`) : down ? tr(`w dół · ${k}`, `down · ${k}`) : tr('w IB', 'inside IB');
  return {
    label,
    value,
    badge: 'LIVE',
    hint: tr(
      `IB sesji ${sessionName(sn.s)} (pierwsza godzina, ${fmtHm(sn.s.start)}–${fmtHm(sn.s.ibEnd)}): ${range}. Zakres sesji ${fmtPx(sn.lo)}–${fmtPx(sn.hi)} to ${k} IB; wybicie to wyjście ceny poza IB po pierwszej godzinie. Opis aukcji, nie sygnał.`,
      `The ${sessionName(sn.s)} session IB (first hour, ${fmtHm(sn.s.start)}–${fmtHm(sn.s.ibEnd)}): ${range}. The session range ${fmtPx(sn.lo)}–${fmtPx(sn.hi)} is ${k} the IB; a breakout is price leaving the IB after the first hour. A description of the auction, not a signal.`
    ),
  };
}

function sessionVwapNum(x: LayoutInputs): LayoutNumber {
  const label = tr('VWAP sesji', 'Session VWAP');
  const sn = val(x.session);
  const p = val(x.price);
  if (!sn || p === null) return dash(label, 'LIVE', whyOf(x.session, x.price));
  const z = sn.vwap ? vwapSigma(p, sn.vwap.vwap, sn.vwap.sd) : null;
  if (!sn.vwap || z === null) return dash(label, 'LIVE', tr('Odchylenie od VWAP sesji jeszcze bez znaczenia: za mało świec sesji', 'The session VWAP deviation is not meaningful yet: too few session candles'));
  const sz = fmtSigned(z, 1, 'σ');
  return {
    label,
    value: sz,
    badge: 'LIVE',
    hint: tr(
      `Cena ${fmtPx(p)} wobec VWAP sesji ${sessionName(sn.s)} ${fmtPx(sn.vwap.vwap)} (σ ${amt(sn.vwap.sd)}) od ${fmtHm(sn.s.start)}: ${sz}. Ze świec 1m sesji.`,
      `Price ${fmtPx(p)} against the ${sessionName(sn.s)} session VWAP ${fmtPx(sn.vwap.vwap)} (σ ${amt(sn.vwap.sd)}) since ${fmtHm(sn.s.start)}: ${sz}. From the session's 1m candles.`
    ),
  };
}

function twapNum(x: LayoutInputs): LayoutNumber {
  const label = tr('TWAP 15 min', 'TWAP 15 min');
  const t = val(x.twap);
  if (!t) return { ...dash(label, 'LIVE', whyOf(x.twap)), short: 'TWAP' };
  return {
    label,
    short: 'TWAP',
    value: pctOf(t.share),
    badge: 'LIVE',
    hint: tr(
      `Udział wypełnień z hashem zerowym (m.in. podzlecenia TWAP) w wartości zleceń agresora z ostatnich 15 min: ${pctOf(t.share)} (po stronie kupna ${pctOf(t.buy)}, sprzedaży ${pctOf(t.sell)}). Z taśmy Hyperliquid, jak wskaźnik Udział TWAP.`,
      `The share of zero-hash fills (among others TWAP suborders) in the value of aggressor orders over the last 15 min: ${pctOf(t.share)} (buying side ${pctOf(t.buy)}, selling ${pctOf(t.sell)}). From the Hyperliquid tape, like the TWAP share indicator.`
    ),
  };
}

function hawkesNum(x: LayoutInputs): LayoutNumber {
  const label = 'Hawkes n';
  const h = val(x.hawkes);
  if (!h) return dash(label, 'MODEL', `MODEL · Hawkes: ${whyOf(x.hawkes)}`);
  const f = (v: number) => fmtFixed(v, 2);
  return {
    label,
    value: f(h.n),
    badge: 'MODEL',
    hint: tr(
      `MODEL · Hawkes (jądro wykładnicze, największa wiarygodność): n ${f(h.n)} (95%: ${f(h.lo)}–${f(h.hi)}) z ${h.events} zdarzeń w oknie 15 min do ostatniej pełnej minuty. n to oczekiwana liczba transakcji wywołanych przez jedną; przy 1 taśma podtrzymywałaby się sama.`,
      `MODEL · Hawkes (exponential kernel, maximum likelihood): n ${f(h.n)} (95%: ${f(h.lo)}–${f(h.hi)}) from ${h.events} events in the 15 min window up to the last full minute. n is the expected number of trades triggered by one; at 1 the tape would sustain itself.`
    ),
  };
}

function whalesNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Saldo wielorybów', 'Whale balance');
  const short = tr('Wieloryby', 'Whales');
  const w = val(x.whales);
  if (!w) return { ...dash(label, 'LIVE', whyOf(x.whales)), short };
  if (w.n === 0) return { ...dash(label, 'LIVE', tr(`Skaner nie widzi pozycji od progu publikacji (stan z ${fmtHm(w.asOf)})`, `The scanner sees no positions above the publication threshold (as of ${fmtHm(w.asOf)})`)), short };
  const net = w.long - w.short;
  const age = scannerAge(w.asOf, x.now);
  return {
    label,
    short,
    value: `${net > 0 ? '+' : ''}${usdShort(net)}`,
    badge: 'LIVE',
    hint: tr(
      `Longi minus shorty największych kont z ich publicznego stanu: longi ${usdShort(w.long)} USD, shorty ${usdShort(w.short)} USD (${w.n} pozycji od progu). Warstwa wielorybów skanera, stan z ${fmtHm(w.asOf)}.`,
      `Longs minus shorts of the largest accounts from their public state: longs ${usdShort(w.long)} USD, shorts ${usdShort(w.short)} USD (${w.n} positions above the threshold). The scanner's whale layer, as of ${fmtHm(w.asOf)}.`
    ),
    ...(age ? { note: age } : {}),
  };
}

function reviewLabel(base: string, r: ReviewFacts | null): string {
  if (!r) return base;
  return `${base} · ${sessionName(r.s)}${r.inProgress ? tr(' w toku', ' in progress') : ''}`;
}

function dayTypeNum(x: LayoutInputs): LayoutNumber {
  const r = val(x.review);
  const label = reviewLabel(tr('Typ dnia', 'Day type'), r);
  if (!r) return dash(label, 'MODEL', `MODEL · Dalton: ${whyOf(x.review)}`);
  // IB w budowie albo zakres IB zerowy — powód wspólny z kartą Rozliczenia i serwerem MCP (`dayTypeOf`)
  const t = dayTypeOf(r);
  if (isAbsent(t)) return dash(label, 'MODEL', `MODEL · Dalton: ${t.why}`);
  const k = fmtFixed((r.hi - r.lo) / (r.ibHi - r.ibLo), 1);
  return {
    label,
    value: DAY_TYPE_LABEL[t],
    badge: 'MODEL',
    hint: tr(
      `MODEL · Dalton: IB ${fmtPx(r.ibLo)}–${fmtPx(r.ibHi)}, zakres sesji ${fmtPx(r.lo)}–${fmtPx(r.hi)} (${k}× IB), zamknięcie ${fmtPx(r.close)}${r.inProgress ? ' (sesja w toku, typ może się zmienić)' : ''}. Do 1,15× IB normalny, od 2× z zamknięciem w skrajnych 20% po stronie wybicia trendowy, wybicie w obie strony neutralny, reszta wariant normalny. Opis, nie sygnał.`,
      `MODEL · Dalton: IB ${fmtPx(r.ibLo)}–${fmtPx(r.ibHi)}, session range ${fmtPx(r.lo)}–${fmtPx(r.hi)} (${k}× IB), close ${fmtPx(r.close)}${r.inProgress ? ' (session in progress, the type may change)' : ''}. Up to 1.15× IB normal, from 2× with a close in the outer 20% on the breakout side trend, a breakout on both sides neutral, otherwise normal variation. A description, not a signal.`
    ),
  };
}

function migrationNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Migracja VA', 'VA migration');
  const r = val(x.review);
  if (!r) return dash(label, 'LIVE', whyOf(x.review));
  const missing = vaMissing(r);
  if (missing || !r.va || !r.prevVa) return dash(label, 'LIVE', missing ?? WAIT_TEXT);
  const m = vaMigration(r.va, r.prevVa);
  if (m === 'unknown') return dash(label, 'LIVE', tr('Value area bez liczb', 'Value area without numbers'));
  return {
    label,
    value: VA_MIGRATION_LABEL[m],
    badge: 'LIVE',
    hint: tr(
      `Value area 70% sesji ${sessionName(r.s)} ${fmtPx(r.va.val)}–${fmtPx(r.va.vah)} wobec poprzedniej sesji ${sessionName(r.s)} ${fmtPx(r.prevVa.val)}–${fmtPx(r.prevVa.vah)}; profile ze świec 1m (te same co na karcie Rozliczenia sesji).`,
      `The ${sessionName(r.s)} session 70% value area ${fmtPx(r.va.val)}–${fmtPx(r.va.vah)} against the previous ${sessionName(r.s)} session ${fmtPx(r.prevVa.val)}–${fmtPx(r.prevVa.vah)}; profiles from 1m candles (the same as on the Session review card).`
    ),
  };
}

/** Poziomy mapy z bloga (tej z wykresu) dotknięte w jej oknie: liczba z ✓ warstwy, przy luce w świecach z uwagą. */
function mapHitsNum(x: LayoutInputs): LayoutNumber {
  const label = tr('Mapa: dotknięte', 'Map: touched');
  const short = tr('Mapa', 'Map');
  if (x.coin !== 'BTC') return { ...dash(label, 'LIVE', tr('Tylko BTC: mapy z bloga opisują BTC', 'BTC only: the blog maps describe BTC'), tr('tylko BTC', 'BTC only')), short };
  const h = val(x.mapHits);
  if (!h) return { ...dash(label, 'LIVE', whyOf(x.mapHits)), short };
  // „X/Y” i uwaga przy luce — ten sam pomocnik co Czwórka Przed sesją
  const t = mapHitsText(h.touched, h.total, h.complete);
  const k = t.value;
  const name = `${blogMapName(h.kind)} ${fmtDayTime(h.publishedAt, x.now)}`;
  const sn = `${sessionName(h.s)} ${fmtDm(h.s.start)}`;
  const until = x.now < h.to ? tr('teraz', 'now') : fmtDayTime(h.to, x.now);
  const gap = t.gap ? `; ${t.gap}` : '';
  return {
    label,
    short,
    value: k,
    badge: 'LIVE',
    hint: tr(
      `Poziomy dotknięte ${k}: ${name}, sesja ${sn}, od wpisu do ${until}${gap}. Dotknięcie = świeca 1m Hyperliquid z low ≤ poziom ≤ high, jak ✓ na wykresie. Poziomy z tekstu wpisu autora, nie model HyperQuant.`,
      `Levels touched ${k}: ${name}, the ${sn} session, from the post until ${until}${gap}. A touch is a Hyperliquid 1m candle with low ≤ level ≤ high, like the ✓ on the chart. Levels from the author's post (PL blog), not a HyperQuant model.`
    ),
    ...(t.note ? { note: t.note } : {}),
  };
}

/** Trzy liczby nagłówka układu `id` (zawsze trzy, brak danych — „—” z powodem). */
export function layoutNumbers(id: StationId, x: LayoutInputs): LayoutNumber[] {
  switch (id) {
    case 'day-map':
      return [vaEdgeNum(x, 'vah'), vaEdgeNum(x, 'val'), nakedPocNum(x)];
    case 'fuel':
      return [rvolNum(x), liqNum(x), costNum(x)];
    case 'auction-open':
      return [ibNum(x), budgetNum(x), sessionVwapNum(x)];
    case 'big-hands':
      return [twapNum(x), hawkesNum(x), whalesNum(x)];
    case 'review': {
      // Na telefonie krótsze podpisy: sesja i „w toku” zostają przy typie dnia
      const r = val(x.review);
      const typeShort = !r ? tr('Typ dnia', 'Day type') : r.inProgress ? tr(`${sessionName(r.s)} w toku`, `${sessionName(r.s)} ongoing`) : tr(`Typ · ${sessionName(r.s)}`, `Type · ${sessionName(r.s)}`);
      return [
        { ...dayTypeNum(x), short: typeShort },
        { ...migrationNum(x), short: 'VA' },
        mapHitsNum(x),
      ];
    }
    case 'cockpit':
    default:
      return [vwapNum(x), budgetNum(x), rvolNum(x)];
  }
}

/**
 * Liczby układu po błędzie liczenia (zły ładunek z zewnątrz): trzy „—” z powodem i ponowną próbą, MODEL z nazwą metody
 * w podpowiedzi jak zawsze.
 */
export function failedNumbers(id: StationId, coin: string, now: number): LayoutNumber[] {
  const why = tr('Nie udało się policzyć liczby z bieżących danych — kolejna próba za ≤ 5 s', 'Could not compute the number from the current data — next attempt within 5 s');
  return layoutNumbers(id, { coin, now }).map((n) => ({
    ...n,
    value: DASH,
    hint: n.badge === 'MODEL' ? `${/^MODEL · [^:]+: /.exec(n.hint)?.[0] ?? 'MODEL · '}${why}` : why,
  }));
}

// ───────────────────────── wejścia ze świec i migawek ─────────────────────────

/** Profile zamkniętych dób UTC ze świec 1h (doba tylko z kompletem 24 świec), rosnąco. */
function dayProfiles(c1h: readonly Candle[], now: number, step: number): { day: number; end: number; poc: number; vah: number; val: number }[] {
  const byDay = new Map<number, Candle[]>();
  for (const c of c1h) {
    const d = utcDayStart(c.t);
    if (d + DAY > now) continue;
    const a = byDay.get(d);
    if (a) a.push(c);
    else byDay.set(d, [c]);
  }
  const out: { day: number; end: number; poc: number; vah: number; val: number }[] = [];
  for (const [day, list] of [...byDay].sort((a, b) => a[0] - b[0])) {
    if (list.length < 24) continue;
    const p = profile(toVBars(list), step);
    if (p) out.push({ day, end: day + DAY, ...p });
  }
  return out;
}

/** Value area wczorajszej doby UTC ze świec 1h. */
export function prevDayOf(c1h: readonly Candle[], now: number, step: number): Got<{ day: number; vah: number; val: number }> {
  if (c1h.length === 0) return { why: tr('Czekam na świece 1h', 'Waiting for 1h candles') };
  if (!(step > 0)) return { why: tr('Brak ceny do profilu', 'No price for the profile') };
  const day = utcDayStart(now) - DAY;
  const p = dayProfiles(c1h, now, step).find((x) => x.day === day);
  return p ? { day, vah: p.vah, val: p.val } : { why: tr('Świece 1h nie obejmują całej wczorajszej doby UTC', "The 1h candles do not cover all of yesterday's UTC day") };
}

/** Najbliższy cenie POC zamkniętej doby UTC, którego późniejsze świece nie dotknęły (świece 1h). */
export function nakedPocOf(c1h: readonly Candle[], now: number, price: number, step: number): Got<{ day: number; px: number }> {
  if (c1h.length === 0) return { why: tr('Czekam na świece 1h', 'Waiting for 1h candles') };
  if (!(price > 0) || !(step > 0)) return { why: tr('Brak ceny', 'No price') };
  const days = dayProfiles(c1h, now, step);
  let best: { day: number; px: number } | null = null;
  for (const d of days) {
    const touched = c1h.some((c) => c.t >= d.end && c.l <= d.poc && d.poc <= c.h);
    if (touched) continue;
    if (!best || Math.abs(d.poc - price) < Math.abs(best.px - price)) best = { day: d.day, px: d.poc };
  }
  return best ?? { why: tr(`Brak nagiego POC w ${days.length} dobach ze świec 1h`, `No naked POC in ${days.length} days of 1h candles`) };
}

/** Najbliższy cenie z klastrów likwidacji rysowanych na wykresie (`liqLevels`). */
export function liqNearestOf(levels: readonly LiqLevel[], price: number, asOf: number): Got<{ px: number; ntlUsd: number; side: 'long' | 'short'; asOf: number }> {
  let best: LiqLevel | null = null;
  for (const l of levels) if (!best || Math.abs(l.px - price) < Math.abs(best.px - price)) best = l;
  return best ? { px: best.px, ntlUsd: best.ntlUsd, side: best.side, asOf } : { why: tr('Brak klastra od 1M USD na mapie', 'No cluster of 1M USD or more on the map') };
}

/** Udział wypełnień z hashem zerowym (m.in. TWAP) w wartości zleceń agresora, łącznie i po stronach. */
export function twapShareOf(orders: readonly { notional: number; side: Side; zero?: true }[]): Got<{ share: number; buy: number; sell: number }> {
  let all = 0;
  let up = 0;
  let down = 0;
  for (const o of orders) {
    all += o.notional;
    if (!o.zero) continue;
    if (o.side === 1) up += o.notional;
    else down += o.notional;
  }
  if (!(all > 0)) return { why: tr('Brak zleceń agresora w oknie', 'No aggressor orders in the window') };
  return { share: (up + down) / all, buy: up / all, sell: down / all };
}

/** Wartość longów i shortów pozycji warstwy wielorybów. */
export function whaleBalanceOf(positions: readonly { side: 'long' | 'short'; usd: number }[], asOf: number): { long: number; short: number; n: number; asOf: number } {
  let long = 0;
  let short = 0;
  for (const p of positions) {
    if (p.side === 'long') long += p.usd;
    else short += p.usd;
  }
  return { long, short, n: positions.length, asOf };
}
