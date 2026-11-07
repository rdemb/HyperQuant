/**
 * Narzędzia sesji Londynu i NY. `session_context`: sesja w toku, jej IB, typ dnia dotąd, oczekiwany zakres i budżet
 * zakresu, VWAP doby UTC i odległość od niego w σ, RVOL bieżącej godziny. `session_review`: wiersze karty Rozliczenia
 * sesji (`reviewRows`). Liczby i powody braku z tych samych funkcji `src/utils` co nagłówek układu na wykresie i karta
 * Rozliczenia na stronie; tu tylko pobranie wejść (świece Hyperliquid, publiczne pliki skanera) w miejsce magazynu strony.
 */
import * as z from 'zod';
import { utcDayStart } from '../../../src/charts/pro/core/sessions';
import type { Candle } from '../../../src/charts/pro/hl/parse';
import { tr } from '../../../src/i18n';
import type { BlogMapsState } from '../../../src/state/useBlogMaps';
import type { CohortFlowState } from '../../../src/state/useCohortFlow';
import type { DeskLedgerState } from '../../../src/state/useDeskLedger';
import type { LiqTapeState } from '../../../src/state/useLiqTape';
import { DASH, fmtPrice } from '../../../src/ui/format';
import { toVBars } from '../../../src/utils/auction';
import { cohortFreshness, isCohortFlow } from '../../../src/utils/cohorts';
import type { DayType } from '../../../src/utils/dayType';
import { dayVwapOf, vwapSigma } from '../../../src/utils/dayVwap';
import { isDeskLedgerSummary, ledgerFreshness } from '../../../src/utils/deskLedger';
import { isLiqTape, liqTapeFreshness } from '../../../src/utils/liqTape';
import { rvolOf } from '../../../src/utils/rvolOf';
import {
  type TradeSession,
  type TradeSessionId,
  currentTradeSession,
  lastClosedSessions,
  nextTradeSession,
  previousSameSession,
  rangeBudget,
} from '../../../src/utils/sessionDay';
import { type SessionNow, asianSessionWhy, dayTypeOf, expectedFrom, sessionFacts, sessionNowOf } from '../../../src/utils/sessionFacts';
import { type ReviewRow, reviewRows, sessionCloseOf } from '../../../src/utils/sessionReview';
import { type Expected, type Got, amt, isAbsent } from '../../../src/utils/sessionText';
import type { VolModel } from '../../../src/utils/volatility';
import { type Badge, type Envelope, type Num, type SourceRef, envelope, iso, num } from '../envelope';
import type { CandleInterval, Fetched, Sources } from '../sources';
import type { ToolDef } from './index';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Okno próby RVOL (mediana tej samej godziny z 20 dni, jak `rvolHour`). */
const RVOL_DAYS = 20;

// ───────────────────────── wspólne ─────────────────────────

const px = (v: number) => fmtPrice(v, 0);

/** Świece z Hyperliquid jako `Got`: nieudane żądanie albo pusta lista — powód (nigdy liczba z braku danych). */
function candlesGot(c: Fetched<Candle[]>, iv: CandleInterval): Got<Candle[]> {
  if (!c.ok) return { why: tr(`świece ${iv} Hyperliquid niedostępne (${c.why})`, `Hyperliquid ${iv} candles unavailable (${c.why})`) };
  if (c.value.length === 0) return { why: tr(`Hyperliquid nie zwrócił świec ${iv}`, `Hyperliquid returned no ${iv} candles`) };
  return c.value;
}

const candleSource = (iv: CandleInterval, c: Fetched<Candle[]>): SourceRef => ({ name: `Hyperliquid candleSnapshot BTC ${iv}`, url: c.url, asOf: c.ok ? iso(c.at) : null });

const fileSource = (name: string, f: Fetched<unknown>): SourceRef => ({ name, url: f.url, asOf: f.ok ? iso(f.asOf ?? f.at) : null });

function volSource(v: Fetched<VolModel | null>): SourceRef {
  return {
    name: tr('Model zmienności HAR (świece 1h i 5m Hyperliquid)', 'HAR volatility model (Hyperliquid 1h and 5m candles)'),
    url: v.url,
    asOf: v.ok ? iso(v.value?.builtAt ?? v.at) : null,
  };
}

/** Chwila migawki świec (z pamięci do 60 s starsza niż `now`): liczby jak w chwili, w której świece pobrano. */
const snapAt = (c: Fetched<Candle[]>, now: number) => (c.ok ? Math.min(now, c.at) : now);

/**
 * Oczekiwany zakres sesji w toku (MODEL) jak na stronie (`sessionExpectedOf`): z modelem HAR od razu; bez niego σ Parkinsona
 * ze świec 5m na chwilę ich migawki. Liczba i powód braku z `expectedFrom`; tu tylko powód nieudanego pobrania świec.
 */
function liveExpected(model: VolModel | null, f5: Fetched<Candle[]>, s: TradeSession, now: number, price: number): Got<Expected> {
  if (model) return expectedFrom(model, [], s, now, now, price);
  const c5 = candlesGot(f5, '5m');
  if (isAbsent(c5)) return c5;
  const at = snapAt(f5, now);
  return expectedFrom(null, toVBars(c5), s, at, at, price);
}

// ───────────────────────── session_context ─────────────────────────

type KnownDayType = Exclude<DayType, 'unknown'>;

export interface SessionContextData {
  /** Sesja Londynu albo NY trwająca teraz; w Azji (00:00 UTC do otwarcia Londynu) null. */
  session: { id: TradeSessionId; opensAt: string; closesAt: string } | null;
  /** Najbliższe otwarcie sesji Londynu albo NY po chwili odpowiedzi. */
  nextSession: { id: TradeSessionId; opensAt: string };
  /** Zamknięcie ostatniej świecy 1m (cena w chwili pobrania świec). */
  price: Num;
  /** Initial Balance (pierwsza godzina sesji): zakres dotąd, `complete` po pierwszej godzinie. W Azji null. */
  ib: { high: Num; low: Num; complete: boolean } | null;
  /** Typ dnia wg Daltona (MODEL) sesji w toku po IB: normal, normal-variation, trend albo neutral; brak — null (powód w `notes`). */
  dayTypeSoFar: KnownDayType | null;
  expectedRange: Num;
  /** Zakres sesji dotąd / oczekiwany zakres (1 = cały oczekiwany zakres). */
  rangeBudget: Num;
  vwap: Num;
  vwapDistance: Num;
  rvolHour: Num;
}

const NAME_CONTEXT = 'session_context';
const RVOL_METHOD = tr('mediana 20 dni', '20-day median');
const DALTON = 'MODEL · Dalton';
const EXPECTED_NOTE: Record<Expected['method'], string> = {
  har: tr(
    'E[H−L] = √(8/π)·σ sesji z modelu zmienności HAR (świece 1h i 5m Hyperliquid, profil godzin)',
    'E[H−L] = √(8/π)·session σ from the HAR volatility model (Hyperliquid 1h and 5m candles, hourly profile)'
  ),
  parkinson: tr(
    'bez modelu HAR: σ Parkinsona z ostatnich zamkniętych świec 5m (z ostatniej doby) przeskalowana do długości sesji, E[H−L] = √(8/π)·σ',
    'without the HAR model: Parkinson σ from the latest closed 5m candles (of the last day) scaled to the session length, E[H−L] = √(8/π)·σ'
  ),
};
const NO_IB = tr('Brak świec 1m z pierwszej godziny sesji (IB)', 'No 1m candles from the first hour of the session (IB)');

/** Część odpowiedzi zależna od sesji w toku (w Azji — same powody). */
interface SessionPart {
  ib: SessionContextData['ib'];
  dayTypeSoFar: KnownDayType | null;
  expectedRange: Num;
  rangeBudget: Num;
  sources: SourceRef[];
  note: string;
}

function ibNum(sn: Got<SessionNow>, s: TradeSession, now: number, edge: 'ibHi' | 'ibLo'): Num {
  if (isAbsent(sn)) return num(null, 'price', 'LIVE', { why: sn.why });
  const note =
    now >= s.ibEnd
      ? tr(`IB sesji ${iso(s.start)}–${iso(s.ibEnd)} ze świec 1m`, `session IB ${iso(s.start)}–${iso(s.ibEnd)} from 1m candles`)
      : tr(`IB w budowie do ${iso(s.ibEnd)}: zakres dotąd`, `IB forming until ${iso(s.ibEnd)}: the range so far`);
  // Świece sesji bez żadnej minuty IB (luka): ekstremum pustej listy to ±∞ — brak liczby z powodem
  return num(sn[edge], 'price', 'LIVE', { why: NO_IB, note });
}

/** Sesja azjatycka: liczby sesji null z powodem z godziną następnego otwarcia (jak nagłówek układu). */
function asianPart(now: number): SessionPart {
  const why = asianSessionWhy(now);
  return {
    ib: null,
    dayTypeSoFar: null,
    expectedRange: num(null, 'usd', 'MODEL', { why }),
    rangeBudget: num(null, 'ratio', 'MODEL', { why }),
    sources: [],
    note: tr('sesja azjatycka, typ dnia liczymy w sesjach Londynu i NY', 'Asian session, the day type is computed in the London and NY sessions'),
  };
}

/**
 * Sesja w toku: IB i zakres ze świec 1m (`sessionNowOf`, jak Kokpit i Otwarcie aukcji), typ dnia z faktów sesji
 * (`sessionFacts` + `dayTypeOf`, jak nagłówek Rozliczenie), oczekiwany zakres i budżet. Świece 5m i model pobierane od razu,
 * równolegle ze świecami 1m (`p1`, już w drodze).
 */
async function sessionPart(src: Sources, s: TradeSession, p1: Promise<Fetched<Candle[]>>, now: number): Promise<SessionPart> {
  const [f1, f5, fv] = await Promise.all([p1, src.candles('5m', now - DAY), src.volModel()]);
  const sources = [candleSource('5m', f5), volSource(fv)];
  const ib = (sn: Got<SessionNow>) => ({ high: ibNum(sn, s, now, 'ibHi'), low: ibNum(sn, s, now, 'ibLo'), complete: now >= s.ibEnd });
  const c1 = candlesGot(f1, '1m');
  if (isAbsent(c1)) {
    return { ib: ib(c1), dayTypeSoFar: null, expectedRange: num(null, 'usd', 'MODEL', { why: c1.why }), rangeBudget: num(null, 'ratio', 'MODEL', { why: c1.why }), sources, note: `${DALTON}: ${c1.why}` };
  }

  const f = sessionFacts(toVBars(c1), s, now);
  const d = isAbsent(f) ? f : dayTypeOf(f);
  const dayTypeSoFar = isAbsent(d) ? null : d;
  // Ten sam opis co podpowiedź „Typ dnia” w nagłówku układu Rozliczenie
  const note = isAbsent(d) ? `${DALTON}: ${d.why}` : tr(`${DALTON}, sesja w toku: typ może się zmienić do jej końca`, `${DALTON}, session in progress: the type may change until it ends`);

  const sn = sessionNowOf(c1, now);
  if (isAbsent(sn)) return { ib: ib(sn), dayTypeSoFar, expectedRange: num(null, 'usd', 'MODEL', { why: sn.why }), rangeBudget: num(null, 'ratio', 'MODEL', { why: sn.why }), sources, note };

  const model = fv.ok ? fv.value : null;
  const e = liveExpected(model, f5, s, now, c1[c1.length - 1].c);
  if (isAbsent(e)) return { ib: ib(sn), dayTypeSoFar, expectedRange: num(null, 'usd', 'MODEL', { why: e.why }), rangeBudget: num(null, 'ratio', 'MODEL', { why: e.why }), sources, note };
  const harWhy = !fv.ok ? fv.why : fv.value === null ? tr('za mało świec 1h albo 5m', 'too few 1h or 5m candles') : null;
  const expectedRange = num(e.usd, 'usd', 'MODEL', {
    method: e.method,
    note: e.method === 'parkinson' && harWhy ? `${EXPECTED_NOTE.parkinson} (${tr('model HAR', 'HAR model')}: ${harWhy})` : EXPECTED_NOTE[e.method],
  });
  const rangeBudgetNum = num(rangeBudget(sn.hi, sn.lo, e.usd), 'ratio', 'MODEL', {
    method: e.method,
    why: tr('brak zakresu sesji', 'no session range'),
    note: tr(
      `zakres sesji ${amt(sn.hi - sn.lo)} USD (${px(sn.lo)}–${px(sn.hi)}) z oczekiwanych ${amt(e.usd)} USD`,
      `session range ${amt(sn.hi - sn.lo)} USD (${px(sn.lo)}–${px(sn.hi)}) of an expected ${amt(e.usd)} USD`
    ),
  });
  return { ib: ib(sn), dayTypeSoFar, expectedRange, rangeBudget: rangeBudgetNum, sources, note };
}

/** Cena (zamknięcie ostatniej świecy 1m), VWAP doby UTC i odległość od niego w σ — jak liczba VWAP w nagłówku układu. */
function vwapPart(c1: Got<Candle[]>, now: number): { price: Num; vwap: Num; vwapDistance: Num } {
  if (isAbsent(c1)) return { price: num(null, 'price', 'LIVE', { why: c1.why }), vwap: num(null, 'price', 'LIVE', { why: c1.why }), vwapDistance: num(null, 'sigma', 'LIVE', { why: c1.why }) };
  const last = c1[c1.length - 1];
  const price = num(last.c, 'price', 'LIVE', { note: tr(`zamknięcie świecy 1m z ${iso(last.t)}`, `close of the 1m candle from ${iso(last.t)}`) });
  const dv = dayVwapOf(c1, now);
  if (isAbsent(dv)) return { price, vwap: num(null, 'price', 'LIVE', { why: dv.why }), vwapDistance: num(null, 'sigma', 'LIVE', { why: dv.why }) };
  return {
    price,
    vwap: num(dv.vwap, 'price', 'LIVE', {
      note: tr(`VWAP doby UTC ze świec 1m od 00:00 UTC (jak linia VWAP na wykresie), σ ${amt(dv.sd)} USD`, `UTC-day VWAP from 1m candles since 00:00 UTC (like the VWAP line on the chart), σ ${amt(dv.sd)} USD`),
    }),
    vwapDistance: num(vwapSigma(last.c, dv.vwap, dv.sd), 'sigma', 'LIVE', {
      why: tr('Odchylenie od VWAP jeszcze bez znaczenia: za mało świec od 00:00 UTC', 'The VWAP deviation is not meaningful yet: too few candles since 00:00 UTC'),
    }),
  };
}

/** RVOL na chwilę migawki świec 1h: wolumen bieżącej godziny wobec upływu godziny w tej samej chwili. */
function rvolNum(f1h: Fetched<Candle[]>, now: number): Num {
  const c1h = candlesGot(f1h, '1h');
  const rv = isAbsent(c1h) ? c1h : rvolOf(c1h, snapAt(f1h, now));
  if (isAbsent(rv)) return num(null, 'ratio', 'MODEL', { why: rv.why, method: RVOL_METHOD });
  return num(rv.value, 'ratio', 'MODEL', {
    method: RVOL_METHOD,
    note: tr(
      `wolumen godziny od ${iso(rv.hour)} wobec mediany tej godziny z ${rv.n} dni, przeskalowanej do upływu godziny; 1 — typowy wolumen o tej porze`,
      `volume of the hour from ${iso(rv.hour)} against the median of this hour over ${rv.n} days, scaled to the elapsed part of the hour; 1 is the typical volume at this time`
    ),
  });
}

async function contextRun(src: Sources): Promise<Envelope<SessionContextData>> {
  const now = src.now();
  const s = currentTradeSession(now);
  const hour = Math.floor(now / HOUR) * HOUR;
  // Wszystkie żądania naraz (jeden limit czasu na całość); w Azji bez świec 5m i modelu — nie ma sesji do oceny
  const p1 = src.candles('1m', utcDayStart(now));
  const p1h = src.candles('1h', hour - RVOL_DAYS * DAY);
  const [f1, f1h, part] = await Promise.all([p1, p1h, s ? sessionPart(src, s, p1, now) : asianPart(now)]);

  const next = nextTradeSession(now);
  const data: SessionContextData = {
    session: s ? { id: s.id, opensAt: iso(s.start), closesAt: iso(s.end) } : null,
    nextSession: { id: next.id, opensAt: iso(next.start) },
    ...vwapPart(candlesGot(f1, '1m'), now),
    ib: part.ib,
    dayTypeSoFar: part.dayTypeSoFar,
    expectedRange: part.expectedRange,
    rangeBudget: part.rangeBudget,
    rvolHour: rvolNum(f1h, now),
  };
  const sources = [candleSource('1m', f1), candleSource('1h', f1h), ...part.sources];
  return envelope(NAME_CONTEXT, data, sources, now, [`dayTypeSoFar: ${part.note}`]);
}

export const sessionContext: ToolDef = {
  name: NAME_CONTEXT,
  title: tr('Sesja Londynu albo NY w toku', 'London or NY session now'),
  description: tr(
    'Bieżąca sesja BTC (Londyn od 08:00 czasu londyńskiego, NY od 09:30 czasu nowojorskiego; w Azji session null i godzina następnego otwarcia): Initial Balance (pierwsza godzina), typ dnia dotąd (Dalton, po IB), oczekiwany zakres sesji (MODEL: HAR albo Parkinson), budżet zakresu (zakres dotąd / oczekiwany), VWAP doby UTC i odległość ceny od niego w σ, RVOL bieżącej godziny (MODEL: mediana 20 dni). Liczone tymi samymi funkcjami i tą samą metodą co nagłówek układu na wykresie HyperQuant, ze świec Hyperliquid; cena (świece do 60 s) i model zmienności (do 15 min) odświeżają się w innym rytmie niż na stronie, więc liczby mogą się nieco różnić. Bez argumentów. Dane publiczne, tylko odczyt; opis rynku, nie porada inwestycyjna.',
    'The current BTC session (London from 08:00 London time, NY from 09:30 New York time; in Asian hours session is null with the next open): the Initial Balance (first hour), the day type so far (Dalton, after the IB), the expected session range (MODEL: HAR or Parkinson), the range budget (range so far / expected), the UTC-day VWAP and the price distance from it in σ, and the current hour RVOL (MODEL: 20-day median). Computed with the same functions and method as the layout header on the HyperQuant chart, from Hyperliquid candles; the price (candles up to 60 s old) and the volatility model (up to 15 min) refresh on a different schedule than the site, so the numbers can differ slightly. No arguments. Public read-only data; market description, not investment advice.'
  ),
  run: (src) => contextRun(src),
};

// ───────────────────────── session_review ─────────────────────────

export interface SessionReviewRow {
  id: ReviewRow['id'];
  /** Klucz wiersza (mapy z bloga: `map:<id wpisu>`). */
  key: string;
  label: string;
  /** Liczba albo opis jak na karcie; brak danych — „—”. */
  value: string;
  /** Przy „—” null (karta pokazuje wtedy sam powód). */
  badge: Badge | null;
  /** Powód braku albo niepełnego wyniku (luka w świecach 1m). */
  why: string | null;
  /** Skąd liczba (MODEL: „MODEL · metoda: …”) albo powód braku. */
  hint: string;
  /** Szczegóły pod wartością: poziomy mapy, markouty kohort. */
  detail: string | null;
  /** `window`: wiersz z okna danych innego niż sesja (stożek 30 dni, kohorty 24 h). */
  scope: ReviewRow['scope'];
}

export interface SessionReviewData {
  session: { id: TradeSessionId; opensAt: string; closesAt: string; inProgress: boolean };
  rows: SessionReviewRow[];
}

const NAME_REVIEW = 'session_review';

const reviewInput = z.object({
  session: z
    .enum(['london', 'ny'])
    .optional()
    .describe(
      tr(
        'london albo ny: ostatnia sesja tego typu (w toku, gdy trwa teraz); bez argumentu — ostatnia zamknięta sesja',
        'london or ny: the latest session of that type (in progress if it is running now); without it, the last closed session'
      )
    ),
});

/** Sesja do rozliczenia: wskazany typ — trwający teraz albo ostatni zamknięty; bez wskazania — ostatnia zamknięta (karty strony). */
function reviewSessionOf(now: number, id: TradeSessionId | undefined): { s: TradeSession; inProgress: boolean } {
  const live = currentTradeSession(now);
  if (id && live?.id === id) return { s: live, inProgress: true };
  // Dwie ostatnie zamknięte to zawsze Londyn i NY (od starszej), jak karty Rozliczenia
  const closed = lastClosedSessions(now, 2);
  const s = id ? closed.find((x) => x.id === id) : closed[closed.length - 1];
  if (!s) throw new Error(`lastClosedSessions: brak sesji ${id ?? ''}`);
  return { s, inProgress: false };
}

function published<T extends { asOf: number }, S>(f: Fetched<T>, now: number, freshness: (v: T, now: number) => S): { status: S | 'error'; value: T | null } {
  return f.ok ? { status: freshness(f.value, now), value: f.value } : { status: 'error', value: null };
}

/**
 * Oczekiwany zakres karty jak na stronie (`sessionExpectedOf`): sesja w toku — jak na żywo; zamknięta — zawsze ex ante,
 * Parkinson ze świec 5m z doby przed jej otwarciem (`asOf = s.start`). Liczba i powód braku z `expectedFrom`.
 */
function cardExpected(s: TradeSession, inProgress: boolean, model: VolModel | null, f5: Fetched<Candle[]>, now: number, price: number): Got<Expected> {
  if (inProgress) return liveExpected(model, f5, s, now, price);
  const c5 = candlesGot(f5, '5m');
  return isAbsent(c5) ? c5 : expectedFrom(null, toVBars(c5), s, now, s.start, price);
}

async function reviewRun(src: Sources, args: unknown): Promise<Envelope<SessionReviewData>> {
  const { session: id } = reviewInput.parse(args ?? {});
  const now = src.now();
  const { s, inProgress } = reviewSessionOf(now, id);
  const prev = previousSameSession(s);
  // Świece 1m od otwarcia poprzedniej sesji tego typu (migracja VA), jak karta; zamknięta sesja — do jej końca (stały klucz pamięci)
  const [f1, f5, fm, fl, fc, fs, fv] = await Promise.all([
    src.candles('1m', prev.start, inProgress ? undefined : s.end - 1),
    // Zamknięta sesja: ocena ex ante ze świec 5m z doby przed otwarciem; w toku — ostatnia doba (gdy brak modelu HAR)
    inProgress ? src.candles('5m', now - DAY) : src.candles('5m', s.start - DAY, s.start - 1),
    src.blogMaps(),
    src.published('liq-tape/BTC.json', isLiqTape),
    src.published('cohorts/BTC.json', isCohortFlow),
    src.published('ledger/BTC/summary.json', isDeskLedgerSummary),
    inProgress ? src.volModel() : null,
  ]);
  const sources: SourceRef[] = [
    candleSource('1m', f1),
    candleSource('5m', f5),
    fileSource(tr('Mapy z bloga HyperQuant', 'HyperQuant blog maps'), fm),
    fileSource(tr('Taśma likwidacji skanera', 'Scanner liquidation tape'), fl),
    fileSource(tr('Przepływ kohort skanera', 'Scanner cohort flow'), fc),
    fileSource(tr('Podsumowanie dziennika prognoz', 'Forecast ledger summary'), fs),
  ];
  if (fv) sources.push(volSource(fv));

  const c1 = candlesGot(f1, '1m');
  const bars1m = isAbsent(c1) ? c1 : toVBars(c1);
  // Cena do oczekiwanego zakresu: zamknięcie sesji, bez świec sesji — ostatnia świeca 1m (strona: ostatnia cena rynku)
  const expected = isAbsent(c1) ? c1 : cardExpected(s, inProgress, fv?.ok ? fv.value : null, f5, now, sessionCloseOf(bars1m, s, now, c1[c1.length - 1].c));

  const maps: BlogMapsState = fm.ok ? fm.value : { status: 'missing', maps: [] };
  const lt = published(fl, now, liqTapeFreshness);
  const co = published(fc, now, cohortFreshness);
  const lg = published(fs, now, ledgerFreshness);
  const liq: LiqTapeState = { status: lt.status, tape: lt.value };
  const cohorts: CohortFlowState = { status: co.status, flow: co.value };
  const ledger: DeskLedgerState = { status: lg.status, summary: lg.value };

  const rows = reviewRows({ s, inProgress, now, bars1m, maps, expected, volLoading: false, liq, cohorts, ledger }).map(
    (r): SessionReviewRow => ({
      id: r.id,
      key: r.key,
      label: r.label,
      value: r.value,
      badge: r.value === DASH ? null : r.badge,
      why: r.why ?? null,
      hint: r.hint,
      detail: r.detail ?? null,
      scope: r.scope,
    })
  );
  const notes = [
    tr(
      'Wiersze z tej samej funkcji co karta Rozliczenia sesji (Po sesji) w HyperQuant, w tej samej kolejności. Wiersze z scope „window” opisują okno danych inne niż sesja (stożek: 30 dni dziennika, kohorty: ostatnie 24 h).',
      'Rows from the same function as the Session review card (After the session) on HyperQuant, in the same order. Rows with scope “window” describe a data window other than the session (cone: 30 days of the ledger, cohorts: the last 24 h).'
    ),
  ];
  return envelope(NAME_REVIEW, { session: { id: s.id, opensAt: iso(s.start), closesAt: iso(s.end), inProgress }, rows }, sources, now, notes);
}

export const sessionReview: ToolDef = {
  name: NAME_REVIEW,
  title: tr('Rozliczenie sesji Londynu albo NY', 'London or NY session review'),
  description: tr(
    'Rozliczenie sesji BTC, wiersze z tej samej funkcji co karta Rozliczenia sesji na stronie HyperQuant: typ dnia (Dalton), migracja value area wobec poprzedniej sesji tego typu, wynik IB, zakres wobec oczekiwanego (MODEL), dotknięte poziomy map z bloga, likwidacje w sesji z taśmy skanera, pokrycie stożka prognoz 1 h (30 dni) i markouty kohort (24 h). Każdy wiersz: wartość, oznaczenie LIVE albo MODEL, powód braku i źródło liczby. Argument session (london albo ny) — ostatnia sesja tego typu, także w toku; bez argumentu ostatnia zamknięta. Dane publiczne, tylko odczyt; opis rynku, nie porada inwestycyjna.',
    "A BTC session review, rows from the same function as the Session review card on the HyperQuant site: the day type (Dalton), the value area migration against the previous session of the same type, the IB result, the range against the expected range (MODEL), touched levels of the blog maps, liquidations in the session from the scanner tape, the 1 h forecast cone coverage (30 days) and cohort markouts (24 h). Each row: the value, a LIVE or MODEL badge, the reason when missing and where the number comes from. Argument session (london or ny): the latest session of that type, also in progress; without it, the last closed session. Public read-only data; market description, not investment advice."
  ),
  input: reviewInput,
  run: (src, args) => reviewRun(src, args),
};
