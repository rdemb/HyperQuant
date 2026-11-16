import {
  ACCEPT_CLOSES,
  ACCEPT_SHARE,
  ATR_DAYS,
  ATR_MIN_DAYS,
  type AuctionState,
  type DayFrame,
  IVB_SESSIONS,
  type IvbFrame,
  STATE_DAYS,
  STATE_KEYS,
  type StateHistory,
  type StateKey,
  stateKey,
} from '../core/dayFrame';
import { fmtHm } from '../core/time';
import { CANDLE_METHOD, type ValueRef, valueBadge, valueNote, valuePeriodName } from '../core/valueReference';
import { TRADE_SESSION_NAME } from '../../../utils/sessionNames';
import { fmtPx } from './layout';
import { DASH, fmtFixed, plForm } from '../../../ui/format';
import type { Sourced } from '../../../ui/sourceTag';
import { type Got, VA_MIGRATION_LABEL, WAIT_TEXT, isAbsent, pctOf } from '../../../utils/sessionText';
import { tr } from '../../../i18n';

/**
 * Teksty paska „Rama dnia” (core/dayFrame.ts): cztery liczby z plakietkami. Wartość dziś wobec wczoraj z taśmy (obie VA
 * z jednego źródła z taśmy) i status IVB to fakty (LIVE); wartość ze świec to MODEL „przybliżenie ze świec”, a stan
 * aukcji z częstością i szerokość IVB wobec sesji to wynik reguły (MODEL z nazwą reguły w podpowiedzi). Brak danych to „—”
 * z powodem; przy zbyt krótkiej historii liczba bez częstości albo percentyla z dopiskiem „krótka historia”. Opis, bez
 * słowa o dalszym kierunku.
 */

export type FrameChipId = 'value' | 'auction' | 'ivb' | 'ivbWidth';

export interface FrameChip extends Sourced {
  id: FrameChipId;
  label: string;
  /** Krótszy podpis na telefon. */
  short: string;
  /** Skąd liczba (MODEL: „MODEL · reguła: …”) albo powód braku. */
  hint: string;
}

/** Wejście paska: rama dnia albo powód braku (undefined — świece się wczytują) i powód braku historii 30m. */
export interface FrameInput {
  coin: string;
  now: number;
  frame: Got<DayFrame> | undefined;
  /** Świece 30m historii niedostępne (błąd pobrania): stan i IVB bez częstości i percentyla. */
  historyWhy?: string | null;
  szDecimals?: number;
}

export const ACCEPT_RULE = tr('przyjęcie poza wartością (Dalton)', 'acceptance outside value (Dalton)');
export const WIDTH_RULE = tr('szerokość IVB w ATR doby, percentyl 20 sesji', 'IVB width in daily ATR, 20-session percentile');

export const STATE_LABEL: Record<StateKey, string> = {
  inside: tr('w wartości', 'inside value'),
  'attempt-up': tr('próba wyjścia nad', 'probing above'),
  'attempt-down': tr('próba wyjścia pod', 'probing below'),
  'accepted-up': tr('przyjęcie nad', 'accepted above'),
  'accepted-down': tr('przyjęcie pod', 'accepted below'),
  return: tr('powrót do wartości', 'back in value'),
  unclassified: tr('niesklasyfikowane', 'unclassified'),
};

const UNCLASSIFIED_WHY: Record<Extract<AuctionState, { kind: 'unclassified' }>['why'], string> = {
  'both-sides': tr('przyjęcie po obu stronach wczorajszej VA od początku liczników', "acceptance on both sides of yesterday's VA since the counters started"),
  whipsaw: tr('ostatnie zamknięcie 5m po drugiej stronie VA niż ostatnie zamknięcie 30m', 'the last 5m close is on the other side of the VA than the last 30m close'),
};

const days = (n: number) => tr(`${n} ${plForm(n, 'doba', 'doby', 'dób')}`, `${n} ${n === 1 ? 'day' : 'days'}`);
const sessions = (n: number) => tr(`${n} ${plForm(n, 'sesja', 'sesje', 'sesji')}`, `${n} ${n === 1 ? 'session' : 'sessions'}`);
export const shortHistory = (what: string) => tr(`krótka historia (${what})`, `short history (${what})`);

/** Zamrożone reguły paska (karta i rozwinięcie). */
export const FRAME_RULES = tr(
  `Reguły zamrożone 16.11.2026, przed oceną na danych; początek liczników i źródło wartości zmienione 16.11.2026 (decyzja Pioniera). Wczorajsza wartość: value area 70% poprzedniej doby UTC z jednego źródła wartości, tego samego co panel „Najbliższe poziomy”, nagłówek Mapy dnia, poziomy doby P/b i Profile okresów: profil z taśmy, gdy nagranie obejmuje co najmniej 90% wolumenu doby (LIVE), inaczej ze świec 5m z wolumenem rozłożonym równo na zakres świecy (MODEL „przybliżenie ze świec”); koszyki 5 pb. Liczniki (minuty poza VA, udział wolumenu, kolejne zamknięcia 30m) od otwarcia bieżącej sesji z kalendarza sesji (Londyn 8:00 czasu Londynu, Nowy Jork 9:30 czasu Nowego Jorku, z czasem letnim) i od nowa na każdym otwarciu; poza sesjami od 00:00 UTC („poza sesją”); tylko zamknięte świece. Przyjęcie nad (pod): co najmniej ${ACCEPT_CLOSES} kolejne zamknięcia 30m nad VAH (pod VAL) i co najmniej ${pctOf(ACCEPT_SHARE)} wolumenu od otwarcia nad VAH (pod VAL). Próba wyjścia: ostatnie zamknięcie 5m poza VA bez spełnionego progu. Powrót do wartości: ostatnie zamknięcie w VA po co najmniej jednym zamknięciu 30m poza VA od otwarcia. W wartości: żadnego zamknięcia 30m poza VA od otwarcia. Niesklasyfikowane: przyjęcie po obu stronach VA od otwarcia albo ostatnie zamknięcie 5m po drugiej stronie VA niż ostatnie zamknięcie 30m. Częstość stanu: ten sam stan w tej samej minucie od otwarcia tej samej sesji (poza sesją: o tej samej porze od 00:00 UTC) w ${STATE_DAYS} poprzednich dobach, ze świec 30m (VA doby poprzedniej też ze świec 30m, więc to przybliżenie); przy mniej niż ${STATE_DAYS} dobach bez częstości. IVB: okno od otwarcia giełdy w Nowym Jorku według kalendarza, jak wskaźnik IVB; status to fakt z zamknięć 5m po oknie (w środku, wybicie nad albo pod od zamknięcia pierwszej świecy poza zakresem, powrót do środka). Szerokość IVB w ATR doby (średni prawdziwy zakres ${ATR_DAYS} dób UTC przed dobą ze świec 30m) i jej percentyl wobec ${IVB_SESSIONS} poprzednich sesji NY tego samego typu (dni robocze albo weekend; rynek z sesją NYSE: dni sesji NYSE); przy mniej niż ${IVB_SESSIONS} sesjach bez percentyla. Akceptacja poza wartością to pojęcie Daltona (Mind Over Markets); progi są propozycją HyperQuant, nie Fabio Valentiniego. Pasek opisuje to, co już się stało, i nie mówi, co będzie dalej.`,
  `Rules frozen on 16.11.2026, before any evaluation on data; the counter start and the value source changed on 16.11.2026 (Pionier's decision). Yesterday's value: the 70% value area of the previous UTC day from the single value source shared with the “Nearest levels” panel, the Day map header, the P/b day levels and Period profiles: a profile from the tape when the recording covers at least 90% of the day's volume (LIVE), otherwise from 5m candles with candle volume spread evenly over its range (MODEL “approximation from candles”); 5 bp bins. The counters (minutes outside the VA, volume share, consecutive 30m closes) run from the open of the current session by the session calendar (London 8:00 London time, New York 9:30 New York time, with daylight saving) and restart at every open; outside the sessions from 00:00 UTC (“outside session”); closed candles only. Accepted above (below): at least ${ACCEPT_CLOSES} consecutive 30m closes above the VAH (below the VAL) and at least ${pctOf(ACCEPT_SHARE)} of the volume since the open above the VAH (below the VAL). Probing: the last 5m close outside the VA without the threshold met. Back in value: the last close inside the VA after at least one 30m close outside it since the open. Inside value: no 30m close outside the VA since the open. Unclassified: acceptance on both sides of the VA since the open, or the last 5m close on the other side of the VA than the last 30m close. State frequency: the same state at the same minute after the open of the same session (outside the sessions: at the same time after 00:00 UTC) over the previous ${STATE_DAYS} days, from 30m candles (the previous day's VA from 30m candles too, so an approximation); with fewer than ${STATE_DAYS} days no frequency. IVB: the window from the New York stock exchange open by the calendar, like the IVB indicator; the status is a fact from 5m closes after the window (inside, broke above or below since the close of the first candle outside the range, back inside). IVB width in daily ATR (the mean true range of the ${ATR_DAYS} UTC days before the day, from 30m candles) and its percentile against the previous ${IVB_SESSIONS} NY sessions of the same type (weekdays or weekend; a market with an NYSE session: NYSE session days); with fewer than ${IVB_SESSIONS} sessions no percentile. Acceptance outside value is Dalton's concept (Mind Over Markets); the thresholds are HyperQuant's proposal, not Fabio Valentini's. The bar describes what has already happened and says nothing about what comes next.`
);

/** Początek liczników do opisu: „od otwarcia sesji Londyn o 09:00” albo „poza sesją: od 00:00 UTC”. */
export function anchorText(f: Pick<DayFrame, 'anchor'>): string {
  const a = f.anchor;
  if (!a.session) return tr('poza sesją: liczniki od 00:00 UTC', 'outside session: counters from 00:00 UTC');
  const name = TRADE_SESSION_NAME[a.session];
  return tr(`liczniki od otwarcia sesji ${name} o ${fmtHm(a.from)}`, `counters from the ${name} session open at ${fmtHm(a.from)}`);
}

/** Dopisek przy liczbie poza sesją. */
export const OUTSIDE_SESSION = tr('poza sesją', 'outside session');

/** Nazwa odniesienia: „wczorajsza VA (doba UTC 15.11)” albo „VA sesji Nowy Jork 15.11”. */
const refName = (p: ValueRef) => (p.kind === 'day' ? tr(`wczorajsza VA (${valuePeriodName(p)})`, `yesterday's VA (${valuePeriodName(p)})`) : tr(`VA (${valuePeriodName(p)})`, `VA (${valuePeriodName(p)})`));

const val = <T>(v: Got<T> | undefined): T | null => (v === undefined || isAbsent(v) ? null : v);
const why = (v: Got<unknown> | undefined): string => (v !== undefined && isAbsent(v) ? v.why : WAIT_TEXT);

/** Rozkład stanów o tej porze (rozwinięcie paska): tylko stany obecne w historii, od najczęstszego. */
export function stateDistribution(h: StateHistory): { key: StateKey; label: string; n: number; share: number }[] {
  if (h.n === 0) return [];
  return STATE_KEYS.filter((k) => h.counts[k] > 0)
    .map((k) => ({ key: k, label: STATE_LABEL[k], n: h.counts[k], share: h.counts[k] / h.n }))
    .sort((a, b) => b.n - a.n);
}

function valueChip(x: FrameInput): FrameChip {
  const base = { id: 'value' as const, label: tr('Wartość', 'Value'), short: tr('Wartość', 'Value'), badge: 'LIVE' as const };
  const f = val(x.frame);
  if (!f) return { ...base, value: DASH, hint: why(x.frame) };
  if (!f.prev) return { ...base, value: DASH, hint: tr('Świece 5m nie obejmują 90% wczorajszej doby UTC', "The 5m candles do not cover 90% of yesterday's UTC day") };
  if (!f.value) return { ...base, value: DASH, hint: tr('Za mało świec dzisiejszej doby UTC (mniej niż 30 min)', "Too few candles of today's UTC day (under 30 min)") };
  const px = (p: number) => fmtPx(p, x.szDecimals);
  const v = f.value;
  const p = f.prev;
  const m = v.migration;
  const lab = VA_MIGRATION_LABEL[m];
  const share = m === 'higher' || m === 'lower' || m === 'inside' ? '' : ` · ${pctOf(v.overlap)}`;
  // Dziś wobec wczoraj: LIVE tylko, gdy obie value area są z taśmy; inaczej przybliżenie ze świec
  const badge = valueBadge(v.today, p);
  const method = badge === 'MODEL' ? `MODEL · ${CANDLE_METHOD}: ` : '';
  const today = p.kind === 'day' ? tr('doby UTC dotąd', 'of the UTC day so far') : tr('bieżącej sesji dotąd', 'of the current session so far');
  return {
    ...base,
    badge,
    value: `${lab}${share}`,
    hint: tr(
      `${method}VA (wolumen) 70% ${today} ${px(v.today.val)}–${px(v.today.vah)} wobec ${refName(p)} ${px(p.val)}–${px(p.vah)} (POC ${px(p.poc)}): ${lab}; ${pctOf(v.overlap)} dzisiejszej VA leży we wczorajszej. Jedno źródło wartości (koszyki 5 pb, jak panel „Najbliższe poziomy” i nagłówek Mapy dnia): dziś ${valueNote(v.today)}, wczoraj ${valueNote(p)}.`,
      `${method}The 70% VA (volume) ${today} ${px(v.today.val)}–${px(v.today.vah)} against ${refName(p)} ${px(p.val)}–${px(p.vah)} (POC ${px(p.poc)}): ${lab}; ${pctOf(v.overlap)} of today's VA lies within yesterday's. The single value source (5 bp bins, like the “Nearest levels” panel and the Day map header): today ${valueNote(v.today)}, yesterday ${valueNote(p)}.`
    ),
  };
}

function auctionChip(x: FrameInput): FrameChip {
  const base = { id: 'auction' as const, label: tr('Aukcja', 'Auction'), short: tr('Aukcja', 'Auction'), badge: 'MODEL' as const };
  const m = `MODEL · ${ACCEPT_RULE}`;
  const f = val(x.frame);
  if (!f) return { ...base, value: DASH, hint: `${m}: ${why(x.frame)}` };
  if (!f.prev) return { ...base, value: DASH, hint: `${m}: ${tr('brak wczorajszej VA (świece 5m nie obejmują 90% doby)', "no value area for yesterday (the 5m candles do not cover 90% of the day)")}` };
  const a = f.acceptance;
  const start = anchorText(f);
  if (!a) return { ...base, value: DASH, hint: `${m}: ${tr(`${start}; żadna świeca 5m jeszcze się nie zamknęła`, `${start}; no 5m candle has closed yet`)}` };
  const k = stateKey(a.state);
  const label = STATE_LABEL[k];
  const since = Math.max(0, Math.floor((x.now - f.anchor.from) / 60_000));
  const at = f.anchor.session
    ? tr(`${since} min od otwarcia sesji ${TRADE_SESSION_NAME[f.anchor.session]}`, `${since} min after the ${TRADE_SESSION_NAME[f.anchor.session]} session open`)
    : tr(`${fmtHm(x.now)}, ${since} min od 00:00 UTC`, `${fmtHm(x.now)}, ${since} min after 00:00 UTC`);
  const h = f.history;
  let ctx: string;
  let ctxHint: string;
  if (x.historyWhy) {
    ctx = '';
    ctxHint = tr(`Częstości o tej porze brak: ${x.historyWhy}.`, `No frequency at this time: ${x.historyWhy}.`);
  } else if (h.early) {
    ctx = '';
    ctxHint = tr('Częstości brak w pierwszym pół godziny od otwarcia (żadne zamknięcie 30m do porównania).', 'No frequency in the first half hour after the open (no 30m close to compare).');
  } else if (h.n < STATE_DAYS) {
    ctx = ` · ${shortHistory(days(h.n))}`;
    ctxHint = tr(`Częstości brak: historia świec 30m ma ${days(h.n)} z ${STATE_DAYS} potrzebnych.`, `No frequency: the 30m candle history has ${days(h.n)} of the ${STATE_DAYS} needed.`);
  } else {
    const s = h.counts[k] / h.n;
    ctx = ` · ${tr(`${pctOf(s)} dób`, `${pctOf(s)} of days`)}`;
    ctxHint = tr(
      `O tej porze (${at}) ten stan w ${h.counts[k]} z ${h.n} poprzednich dób (${pctOf(s)}); historia ze świec 30m od otwarcia tej samej sesji w każdej dobie, VA dób też ze świec 30m (przybliżenie).`,
      `At this time (${at}) this state occurred on ${h.counts[k]} of the previous ${h.n} days (${pctOf(s)}); history from 30m candles from the open of the same session on each day, the days' VA from 30m candles too (an approximation).`
    );
  }
  const outside = f.anchor.session ? '' : ` · ${OUTSIDE_SESSION}`;
  const side = a.runSide > 0 ? tr('nad VAH', 'above the VAH') : tr('pod VAL', 'below the VAL');
  const run = a.runSide === 0 ? tr('ostatnie zamknięcie 30m w VA', 'last 30m close inside the VA') : tr(`kolejne zamknięcia 30m ${side}: ${a.run}`, `consecutive 30m closes ${side}: ${a.run}`);
  const unc = a.state.kind === 'unclassified' ? ` ${tr('Powód', 'Reason')}: ${UNCLASSIFIED_WHY[a.state.why]}.` : '';
  const p = f.prev;
  return {
    ...base,
    value: `${label}${outside}${ctx}`,
    hint: tr(
      `${m} (progi HyperQuant: ≥ ${ACCEPT_CLOSES} zamknięcia 30m i ≥ ${pctOf(ACCEPT_SHARE)} wolumenu od otwarcia poza VA po tej samej stronie): ${label}.${unc} ${start[0].toUpperCase()}${start.slice(1)}. Wobec ${refName(p)} (${valueNote(p)}): ${run}; wolumen od otwarcia nad VAH ${pctOf(a.above)}, pod VAL ${pctOf(a.below)}; ${fmtFixed(a.minutesOutside, 0)} min świec zamkniętych poza VA. ${ctxHint} Opis, nie prognoza.`,
      `${m} (HyperQuant thresholds: ≥ ${ACCEPT_CLOSES} 30m closes and ≥ ${pctOf(ACCEPT_SHARE)} of the volume since the open outside the VA on the same side): ${label}.${unc} ${start[0].toUpperCase()}${start.slice(1)}. Against ${refName(p)} (${valueNote(p)}): ${run}; volume since the open above the VAH ${pctOf(a.above)}, below the VAL ${pctOf(a.below)}; ${fmtFixed(a.minutesOutside, 0)} min of candles closed outside the VA. ${ctxHint} A description, not a forecast.`
    ),
  };
}

const IVB_NA: Record<Extract<IvbFrame, { kind: 'na' }>['why'], string> = {
  'no-rth': tr(
    'IVB liczymy od otwarcia giełdy w Nowym Jorku; rynek bazowy tego rynku nie ma sesji regularnej NYSE w kalendarzu desku',
    'The IVB starts at the New York stock exchange open; the underlying of this market has no regular NYSE session in the desk calendar'
  ),
  unknown: tr('Kalendarz rynku bazowego nieznany (rynek HIP-3 spoza listy desku), więc otwarcie NY nie jest pewne', 'The underlying calendar is unknown (a HIP-3 market outside the desk list), so the NY open is not certain'),
  'nyse-closed': tr('Dziś nie ma sesji NYSE (weekend albo święto), więc rynek bazowy nie ma otwarcia NY', 'No NYSE session today (weekend or holiday), so the underlying has no NY open'),
  'no-nyse-calendar': tr('Brak kalendarza NYSE na ten rok', 'No NYSE calendar for this year'),
};

/** Powód braku zakresu IVB (bez zakresu i plakietki). */
function ivbMissing(f: IvbFrame): string | null {
  if (f.kind === 'na') return IVB_NA[f.why];
  if (f.kind !== 'state') return null;
  const s = f.state;
  switch (s.kind) {
    case 'outside':
      return tr(`Poza sesją NY: najbliższe otwarcie o ${fmtHm(s.next)}`, `Outside the NY session: next open at ${fmtHm(s.next)}`);
    case 'waiting':
      return tr(`Okno IVB od ${fmtHm(s.open)}: żadna świeca 5m okna jeszcze się nie zamknęła`, `IVB window from ${fmtHm(s.open)}: no 5m candle of the window has closed yet`);
    case 'gap':
      return tr(`W oknie IVB od ${fmtHm(s.open)} brakuje świecy 5m: zakresu nie podajemy`, `A 5m candle is missing in the IVB window from ${fmtHm(s.open)}: no range given`);
    case 'interval':
      return tr('IVB na świecach do 30m', 'IVB on candles up to 30m');
    default:
      return tr('Czekam na świece 5m', 'Waiting for 5m candles');
  }
}

function ivbChip(x: FrameInput, minutes: number): FrameChip {
  const base = { id: 'ivb' as const, label: `IVB ${minutes}`, short: 'IVB', badge: 'LIVE' as const };
  const fr = val(x.frame);
  if (!fr) return { ...base, value: DASH, hint: why(x.frame) };
  const f = fr.ivb;
  const miss = ivbMissing(f);
  if (miss !== null || f.kind !== 'ok') return { ...base, value: DASH, hint: miss ?? WAIT_TEXT };
  const px = (p: number) => fmtPx(p, x.szDecimals);
  const range = `${px(f.ivb.lo)}–${px(f.ivb.hi)}`;
  const st = f.status;
  let value: string;
  let detail: string;
  switch (st.kind) {
    case 'forming':
      value = tr('w budowie', 'forming');
      detail = tr(`okno do ${fmtHm(f.ivb.end)}, dotąd ${range}`, `window until ${fmtHm(f.ivb.end)}, so far ${range}`);
      break;
    case 'inside':
      value = tr('w środku', 'inside');
      detail = tr(`zamknięcia 5m po oknie w zakresie ${range}`, `5m closes after the window inside the range ${range}`);
      break;
    case 'back':
      value = tr('powrót do środka', 'back inside');
      detail = tr(`ostatnie zamknięcie 5m w zakresie ${range} po zamknięciu poza nim`, `the last 5m close inside the range ${range} after a close outside it`);
      break;
    default: {
      const min = Math.max(0, Math.floor((x.now - st.since) / 60_000));
      value = st.side > 0 ? tr(`wybicie nad · ${min} min`, `broke above · ${min} min`) : tr(`wybicie pod · ${min} min`, `broke below · ${min} min`);
      detail = tr(
        `ostatnie zamknięcie 5m ${st.side > 0 ? 'nad' : 'pod'} zakresem ${range}, od zamknięcia pierwszej świecy tej serii o ${fmtHm(st.since)}`,
        `the last 5m close ${st.side > 0 ? 'above' : 'below'} the range ${range}, since the close of the first candle of this run at ${fmtHm(st.since)}`
      );
      break;
    }
  }
  return {
    ...base,
    value,
    hint: tr(
      `IVB ${minutes} min od otwarcia NY o ${fmtHm(f.ivb.start)} (ze świec 5m, jak wskaźnik IVB): ${detail}. Fakt, bez prognozy.`,
      `IVB ${minutes} min from the NY open at ${fmtHm(f.ivb.start)} (from 5m candles, like the IVB indicator): ${detail}. A fact, not a forecast.`
    ),
  };
}

function widthChip(x: FrameInput): FrameChip {
  const base = { id: 'ivbWidth' as const, label: tr('Szerokość IVB', 'IVB width'), short: tr('Szer. IVB', 'IVB width'), badge: 'MODEL' as const };
  const m = `MODEL · ${WIDTH_RULE}`;
  const fr = val(x.frame);
  if (!fr) return { ...base, value: DASH, hint: `${m}: ${why(x.frame)}` };
  const f = fr.ivb;
  const miss = ivbMissing(f);
  if (miss !== null || f.kind !== 'ok') return { ...base, value: DASH, hint: `${m}: ${miss ?? WAIT_TEXT}` };
  if (f.status.kind === 'forming') return { ...base, value: DASH, hint: `${m}: ${tr(`IVB w budowie; szerokość po końcu okna (${fmtHm(f.ivb.end)})`, `IVB forming; the width after the window ends (${fmtHm(f.ivb.end)})`)}` };
  if (x.historyWhy) return { ...base, value: DASH, hint: `${m}: ${x.historyWhy}` };
  const w = f.width;
  if (w.kind === 'noAtr')
    return { ...base, value: DASH, hint: `${m}: ${tr(`za mało pełnych dób świec 30m do ATR (min. ${ATR_MIN_DAYS} z ${ATR_DAYS})`, `too few full days of 30m candles for the ATR (min. ${ATR_MIN_DAYS} of ${ATR_DAYS})`)}` };
  const r = `${fmtFixed(w.ratio, 2)} ATR`;
  const atr = fmtPx(w.atr, x.szDecimals);
  if (w.kind === 'short')
    return {
      ...base,
      value: `${r} · ${shortHistory(sessions(w.n))}`,
      hint: `${m}: ${tr(
        `IVB ${fmtFixed(w.ratio, 2)} ATR doby (ATR ${atr}). Percentyla brak: historia świec 30m ma ${sessions(w.n)} NY tego samego typu z ${IVB_SESSIONS} potrzebnych.`,
        `IVB ${fmtFixed(w.ratio, 2)} daily ATR (ATR ${atr}). No percentile: the 30m candle history has ${sessions(w.n)} of the same type of the ${IVB_SESSIONS} needed.`
      )}`,
    };
  const p = Math.round(w.p);
  return {
    ...base,
    value: `${r} · p${p}`,
    hint: `${m}: ${tr(
      `IVB ${fmtFixed(w.ratio, 2)} ATR doby (ATR ${atr}, średni prawdziwy zakres ${ATR_DAYS} dób UTC przed dziś); percentyl ${p} wobec ${w.n} poprzednich sesji NY tego samego typu (mediana ${fmtFixed(w.median, 2)} ATR). Opis otwarcia, nie prognoza.`,
      `IVB ${fmtFixed(w.ratio, 2)} daily ATR (ATR ${atr}, the mean true range of the ${ATR_DAYS} UTC days before today); percentile ${p} against the previous ${w.n} NY sessions of the same type (median ${fmtFixed(w.median, 2)} ATR). A description of the open, not a forecast.`
    )}`,
  };
}

/** Cztery liczby paska „Rama dnia” (zawsze cztery, brak danych — „—” z powodem). */
export function frameChips(x: FrameInput, minutes: number): FrameChip[] {
  return [valueChip(x), auctionChip(x), ivbChip(x, minutes), widthChip(x)];
}
