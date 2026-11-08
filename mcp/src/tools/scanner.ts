/**
 * Narzędzia danych skanera HyperQuant (pliki publiczne repo `hyperquant-data`): mapa i taśma likwidacji, przepływ kohort,
 * wieloryby, udział TWAP z nagrań taśmy i dziennik prognoz. Strażniki plików, progi świeżości, powody braku i liczby
 * z tych samych funkcji `src/utils` co strona; tu tylko pobranie plików w miejsce magazynu strony. Każda liczba ze skanera
 * ma oznaczenie LIVE, a migawka starsza niż 2 min — uwagę z jej wiekiem (jak plakietka warstwy na wykresie).
 */
import { Coverage } from '../../../src/charts/pro/core/coverage';
import { utcDayStart } from '../../../src/charts/pro/core/sessions';
import { tr } from '../../../src/i18n';
import { COHORTS, COHORT_LABEL, type CohortId, type CohortTotal, cohortFreshness, cohortNet, cohortSeen, cohortTakerNet, cohortVolume, cohortWindowEnd, isCohortFlow } from '../../../src/utils/cohorts';
import { LEDGER_MIN_N, isDeskLedgerSummary, ledgerFreshness } from '../../../src/utils/deskLedger';
import { FUEL_BAND, liqFuel } from '../../../src/utils/fourNumbers';
import { type LiqBucket, type LiqMap, isLiqMap } from '../../../src/utils/liqMap';
import { liqMapFreshness } from '../../../src/utils/liqMapView';
import { isLiqTape, liqTapeFreshness } from '../../../src/utils/liqTape';
import { liqScan, scannerAge, whalesScan } from '../../../src/utils/scanState';
import { fmtFixed } from '../../../src/ui/format';
import { isAbsent } from '../../../src/utils/sessionText';
import {
  HIST_HOUR_MS,
  HIST_PART_MS,
  HIST_PUBLISH_LAG_MS,
  type HistTrade,
  type HistoryIndex,
  clipSpans,
  decodeTrades,
  historyPath,
  isHistoryIndex,
} from '../../../src/utils/tapeHistory';
import { twapShareOf } from '../../../src/utils/twapShare';
import { WHALES_STALE_MS, type WhaleOrderGroup, type WhalePosition, groupWhaleOrders, isWhaleLayer, whaleBalanceOf } from '../../../src/utils/whaleLayer';
import { type Envelope, type Num, type SourceRef, type Unit, envelope, iso, num } from '../envelope';
import { type Sources, TIMEOUT_MS, TTL } from '../sources';
import type { ToolDef } from './index';
import { candleSource, candlesGot, closeNum, fileSource } from './shared';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ───────────────────────── wspólne ─────────────────────────

/** Uwaga o wieku migawki skanera starszej niż 2 min (`scannerAge`, jak plakietka warstwy na wykresie); świeża — brak uwagi. */
function ageNote(asOf: number, now: number): string | undefined {
  const age = scannerAge(asOf, now);
  return age === null ? undefined : tr(`migawka skanera sprzed ${age} (stan z ${iso(asOf)})`, `scanner snapshot from ${age} ago (as of ${iso(asOf)})`);
}

const NO_NUMBER = tr('brak liczby w pliku skanera', 'no number in the scanner file');

/**
 * Liczba ze skanera: LIVE z uwagą o wieku migawki; brak liczby — null z powodem `why` (bez uwagi), domyślnie „brak liczby
 * w pliku skanera” — nigdy zastępcze „czekam na dane”.
 */
function live(value: number | null | undefined, unit: Unit, note: string | undefined, why: string = NO_NUMBER): Num {
  const ok = typeof value === 'number' && Number.isFinite(value);
  return num(value, unit, 'LIVE', { why, ...(ok && note !== undefined && { note }) });
}

/** Brak liczby z powodem. */
const nil = (unit: Unit, why: string): Num => num(null, unit, 'LIVE', { why });

const NO_DESC = tr('Dane publiczne, tylko odczyt; bez argumentów; opis rynku, nie porada inwestycyjna.', 'Public read-only data; no arguments; market description, not investment advice.');

// ───────────────────────── liquidation_map ─────────────────────────

export interface LiqMapData {
  why: string | null;
  /** Zamknięcie ostatniej świecy 1m Hyperliquid — cena, wokół której liczone jest paliwo. */
  price: Num;
  fuel1pct: { below: Num; above: Num };
  fuel3pct: { below: Num; above: Num };
  /** Po 5 największych kubełków likwidacji longów (pod ceną mark mapy) i shortów (nad nią), cena — środek kubełka. */
  clusters: { side: 'below' | 'above'; price: Num; usd: Num }[];
  /** Część open interest w pozycjach śledzonych przez skaner (1 = całość). */
  oiCoverage: Num;
  /** Wiek migawki mapy w pełnych minutach. */
  ageMin: Num;
}

const NAME_LIQ_MAP = 'liquidation_map';
const CLUSTERS_PER_SIDE = 5;
const FUEL_WIDE = 0.03;
const LIQ_MAP_NOTE = tr(
  'Mapa z pozycji on-chain Hyperliquid śledzonych przez skaner (tylko ta część open interest: oiCoverage). Paliwo: USD likwidacji longów i shortów razem w paśmie 1% i 3% pod ceną i nad nią, po środku kubełka (jak liczba „Paliwo ±1%” Przed sesją). Klastry: największe kubełki likwidacji longów (pod ceną mark mapy) i shortów (nad nią).',
  "A map of Hyperliquid on-chain positions tracked by the scanner (only that part of open interest: oiCoverage). Fuel: USD of long and short liquidations together within a 1% and a 3% band below and above the price, by bucket mid (like the “Fuel ±1%” number in Pre-session). Clusters: the largest buckets of long liquidations (below the map's mark price) and of short liquidations (above it)."
);

const ageMinNum = (asOf: number, now: number) => live(Math.max(0, Math.floor((now - asOf) / MIN)), 'min', ageNote(asOf, now));

async function liqMapRun(src: Sources): Promise<Envelope<LiqMapData>> {
  const now = src.now();
  // Cena z tych samych świec 1m co day_map i session_context (wspólny klucz pamięci przez dobę UTC), oba żądania naraz
  const [f, c] = await Promise.all([src.published('liq-map/BTC.json', isLiqMap), src.candles('1m', utcDayStart(now))]);
  const sources = [fileSource(tr('Mapa likwidacji skanera', 'Scanner liquidation map'), f), candleSource('1m', c)];
  const price = closeNum(candlesGot(c, '1m'));
  const notes = [LIQ_MAP_NOTE];
  const pair = (why: string) => ({ below: nil('usd', why), above: nil('usd', why) });
  const hidden = (why: string, map: LiqMap | null): Envelope<LiqMapData> =>
    envelope(
      NAME_LIQ_MAP,
      { why, price, fuel1pct: pair(why), fuel3pct: pair(why), clusters: [], oiCoverage: nil('ratio', why), ageMin: map ? ageMinNum(map.asOf, now) : nil('min', why) },
      sources,
      now,
      notes
    );
  if (!f.ok) return hidden(tr(`mapa likwidacji niedostępna (${f.why})`, `liquidation map unavailable (${f.why})`), null);

  const map = f.value;
  const status = liqMapFreshness(map, now);
  // Nieaktualna mapa: liczby ukryte z tym samym powodem co Czwórka i legenda wykresu
  const ls = liqScan({ status, map });
  if ('why' in ls) return hidden(ls.why, map);
  const delayed = status === 'delayed';
  const note = ageNote(map.asOf, now) ?? (delayed ? tr('opóźnione', 'delayed') : undefined);
  if (delayed) {
    notes.push(
      tr(
        `Połowa nominału na mapie pochodzi z odczytów pozycji starszych niż ${Math.round(map.ageMin.ntlP50)} min — klastry mogły się przesunąć.`,
        `Half of the notional on the map comes from position reads older than ${Math.round(map.ageMin.ntlP50)} min, so clusters may have moved.`
      )
    );
  }
  const p = price.value;
  const fuel = (band: number) => {
    if (p === null || !(p > 0)) return pair(price.why ?? tr('brak ceny', 'no price'));
    const r = liqFuel(map, p, band);
    return { below: live(r.below, 'usd', note), above: live(r.above, 'usd', note) };
  };
  const top = (buckets: readonly LiqBucket[], side: 'below' | 'above') =>
    [...buckets]
      .sort((a, b) => b.ntlUsd - a.ntlUsd)
      .slice(0, CLUSTERS_PER_SIDE)
      .map((b) => ({ side, price: live(b.px + map.stepUsd / 2, 'price', note), usd: live(b.ntlUsd, 'usd', note) }));
  const data: LiqMapData = {
    why: null,
    price,
    // 1% — pasmo liczby „Paliwo ±1%” Czwórki (FUEL_BAND)
    fuel1pct: fuel(FUEL_BAND),
    fuel3pct: fuel(FUEL_WIDE),
    clusters: [...top(map.longs, 'below'), ...top(map.shorts, 'above')],
    // Bez open interest z API pokrycie w pliku to 0 z braku mianownika, nie pomiar
    oiCoverage:
      map.coverage.oiBtc > 0
        ? live(map.coverage.share, 'ratio', note)
        : nil('ratio', tr('mapa bez open interest z API (OI ≤ 0): pokrycie nieznane', 'the map has no open interest from the API (OI ≤ 0): coverage unknown')),
    ageMin: ageMinNum(map.asOf, now),
  };
  return envelope(NAME_LIQ_MAP, data, sources, now, notes);
}

export const liquidationMap: ToolDef = {
  name: NAME_LIQ_MAP,
  title: tr('Mapa likwidacji BTC', 'BTC liquidation map'),
  description: tr(
    `Mapa likwidacji BTC ze skanera HyperQuant (pozycje on-chain Hyperliquid, agregaty bez adresów): paliwo, czyli USD likwidacji w 1% i 3% pod ceną i nad nią, po 5 największych klastrów pod i nad ceną, pokrycie open interest i wiek migawki. Cena z ostatniej świecy 1m Hyperliquid. ${NO_DESC}`,
    `The BTC liquidation map from the HyperQuant scanner (Hyperliquid on-chain positions, aggregates without addresses): fuel, i.e. USD of liquidations within 1% and 3% below and above the price, the 5 largest clusters below and above the price, open interest coverage and the snapshot age. Price from the latest Hyperliquid 1m candle. ${NO_DESC}`
  ),
  run: (src) => liqMapRun(src),
};

// ───────────────────────── liquidation_tape ─────────────────────────

export interface LiqTapeData {
  why: string | null;
  /** Od kiedy skaner obserwuje bez przerwy (po restarcie sumy 24 h obejmują krótszy czas). */
  observedSince: string | null;
  sum1h: { longs: Num; shorts: Num };
  sum24h: { longs: Num; shorts: Num };
  /** Do 10 ostatnich likwidacji, od najnowszej: czas (do minuty), strona likwidowanej pozycji, wartość, cena. */
  recent: { at: string; side: 'long' | 'short'; usd: Num; price: Num }[];
}

const NAME_LIQ_TAPE = 'liquidation_tape';
const RECENT = 10;
const LIQ_TAPE_NOTE = tr(
  'Likwidacje pozycji śledzonych przez skaner, potwierdzone fillami konta z polem liquidation (publiczne API Hyperliquid): tylko zmierzona część open interest, jak mapa likwidacji. longs — likwidacje longów (sprzedaż przy spadku), shorts — likwidacje shortów (kupno przy wzroście). Bez adresów; czas do minuty, rozmiar zaokrąglony; opóźnienie do kilku minut.',
  'Liquidations of positions tracked by the scanner, confirmed by account fills with the liquidation field (public Hyperliquid API): only the measured part of open interest, like the liquidation map. longs are long liquidations (selling into a drop), shorts are short liquidations (buying into a rise). No addresses; time to the minute, size rounded; delay up to a few minutes.'
);

async function liqTapeRun(src: Sources): Promise<Envelope<LiqTapeData>> {
  const now = src.now();
  const f = await src.published('liq-tape/BTC.json', isLiqTape);
  const sources = [fileSource(tr('Taśma likwidacji skanera', 'Scanner liquidation tape'), f)];
  const notes = [LIQ_TAPE_NOTE];
  const sums = (why: string) => ({ longs: nil('usd', why), shorts: nil('usd', why) });
  const hidden = (why: string) => envelope(NAME_LIQ_TAPE, { why, observedSince: null, sum1h: sums(why), sum24h: sums(why), recent: [] }, sources, now, notes);
  if (!f.ok) return hidden(tr(`taśma likwidacji niedostępna (${f.why})`, `liquidation tape unavailable (${f.why})`));
  const tape = f.value;
  // Jak karta taśmy na stronie: publikacja starsza niż 10 min — liczby ukryte
  if (liqTapeFreshness(tape, now) !== 'ready') {
    return hidden(tr(`Taśma nieaktualna — ostatnia publikacja ${iso(tape.asOf)}; liczby ukryte.`, `Tape out of date, last published ${iso(tape.asOf)}; numbers hidden.`));
  }
  const note = ageNote(tape.asOf, now);
  if (tape.since > tape.asOf - DAY) {
    notes.push(tr(`Obserwacja od ${iso(tape.since)}: sumy 24 h obejmują krótszy czas.`, `Observed since ${iso(tape.since)}: the 24 h sums cover a shorter time.`));
  }
  const data: LiqTapeData = {
    why: null,
    observedSince: iso(tape.since),
    sum1h: { longs: live(tape.totals.h1.longUsd, 'usd', note), shorts: live(tape.totals.h1.shortUsd, 'usd', note) },
    sum24h: { longs: live(tape.totals.h24.longUsd, 'usd', note), shorts: live(tape.totals.h24.shortUsd, 'usd', note) },
    // Tylko publiczne pola zdarzenia (plik i tak nie ma adresów ani identyfikatorów transakcji)
    recent: tape.events.slice(0, RECENT).map((e) => ({ at: iso(e.t), side: e.side, usd: live(e.usd, 'usd', note), price: live(e.px, 'price', note) })),
  };
  return envelope(NAME_LIQ_TAPE, data, sources, now, notes);
}

export const liquidationTape: ToolDef = {
  name: NAME_LIQ_TAPE,
  title: tr('Taśma likwidacji BTC', 'BTC liquidation tape'),
  description: tr(
    `Zrealizowane likwidacje BTC pozycji śledzonych przez skaner HyperQuant (potwierdzone fillami Hyperliquid, bez adresów): sumy longów i shortów z ostatniej godziny i doby oraz do 10 ostatnich zdarzeń (czas, strona, wartość, cena). ${NO_DESC}`,
    `Realised BTC liquidations of positions tracked by the HyperQuant scanner (confirmed by Hyperliquid fills, without addresses): sums of longs and shorts over the last hour and day and up to 10 latest events (time, side, value, price). ${NO_DESC}`
  ),
  run: (src) => liqTapeRun(src),
};

// ───────────────────────── cohort_flow ─────────────────────────

export interface CohortRow {
  id: CohortId;
  label: string;
  /** Kupno − sprzedaż wszystkich wypełnień kohorty (zmiana zapasów; suma po kohortach = 0). */
  net: Num;
  /** Kupno − sprzedaż kohorty jako biorcy płynności (agresor). */
  takerNet: Num;
  /** Kupno + sprzedaż kohorty. */
  volume: Num;
  /** Udział kohorty w sumie obrotu kohort w oknie (każda transakcja liczy się po obu stronach). */
  volumeShare: Num;
  /** Kubełki z komórką kohorty ukrytą dla prywatności (k-anonimowość) i z ukrytą warstwą biorcy. */
  hiddenBuckets: Num;
  hiddenTakerBuckets: Num;
}

export interface CohortWindow {
  from: string | null;
  to: string | null;
  cohorts: CohortRow[];
}

export interface CohortFlowData {
  why: string | null;
  observedSince: string | null;
  /** Ostatnia godzina: 4 ostatnie zamknięte kubełki 15 min. */
  h1: CohortWindow;
  /** Kubełki z ostatnich 24 h w pliku. */
  h24: CohortWindow;
}

const NAME_COHORTS = 'cohort_flow';
const NO_TRADES = tr('brak transakcji kohorty w oknie', 'no cohort trades in the window');
/** Definicja udziału w obrocie — w uwagach odpowiedzi i w opisie narzędzia. */
const VOLUME_SHARE_DEF = tr(
  'volumeShare = kupno + sprzedaż kohorty ÷ widoczne kupno + sprzedaż czterech kohort w oknie (każda transakcja liczona po obu stronach; ukryte komórki pominięte)',
  "volumeShare = cohort buy+sell ÷ the four cohorts' visible buy+sell in the window (each trade counted on both sides; hidden cells excluded)"
);
const COHORT_NOTE = tr(
  `Kohorty uczestników Hyperliquid na BTC (market makerzy, poinformowani, wieloryby, reszta) z publicznej taśmy: adresy obu stron i strona agresora zostają na serwerze, publikowane są tylko agregaty zaokrąglone do 10 tys. USD. Komórki ukryte dla prywatności nie są wliczone. net = kupno − sprzedaż wszystkich wypełnień kohorty (zmiana zapasów), takerNet = kupno − sprzedaż kohorty jako biorcy płynności, volume = kupno + sprzedaż; ${VOLUME_SHARE_DEF}. „Poinformowani” to wynik statystyczny z przeszłości. Opis przepływu, nie sygnał.`,
  `Hyperliquid BTC participant cohorts (market makers, informed, whales, rest) from the public tape: the addresses of both sides and the aggressor side stay on the server, only aggregates rounded to USD 10k are published. Cells hidden for privacy are not included. net = buys − sells over all the cohort's fills (inventory change), takerNet = buys − sells of the cohort as liquidity taker, volume = buys + sells; ${VOLUME_SHARE_DEF}. “Informed” is a statistical result from the past. A description of flow, not a signal.`
);

function cohortRows(totals: Record<CohortId, CohortTotal>, note: string | undefined): CohortRow[] {
  const all = COHORTS.reduce((s, id) => s + cohortVolume(totals[id]), 0);
  return COHORTS.map((id) => {
    const t = totals[id];
    // Jak panel: kohorta bez transakcji i ukrytych kubełków to „—”, nie zero
    const seen = cohortSeen(t);
    const usd = (v: number) => (seen ? live(v, 'usd', note) : nil('usd', NO_TRADES));
    const share = !seen ? nil('ratio', NO_TRADES) : all > 0 ? live(cohortVolume(t) / all, 'ratio', note) : nil('ratio', tr('brak widocznego obrotu w oknie', 'no visible volume in the window'));
    return {
      id,
      label: COHORT_LABEL[id],
      net: usd(cohortNet(t)),
      takerNet: usd(cohortTakerNet(t)),
      volume: usd(cohortVolume(t)),
      volumeShare: share,
      hiddenBuckets: live(t.hidden, 'count', note),
      hiddenTakerBuckets: live(t.takerHidden, 'count', note),
    };
  });
}

async function cohortsRun(src: Sources): Promise<Envelope<CohortFlowData>> {
  const now = src.now();
  const f = await src.published('cohorts/BTC.json', isCohortFlow);
  const sources = [fileSource(tr('Przepływ kohort skanera', 'Scanner cohort flow'), f)];
  const notes = [COHORT_NOTE];
  const empty = (why: string): CohortWindow => ({
    from: null,
    to: null,
    cohorts: COHORTS.map((id) => ({
      id,
      label: COHORT_LABEL[id],
      net: nil('usd', why),
      takerNet: nil('usd', why),
      volume: nil('usd', why),
      volumeShare: nil('ratio', why),
      hiddenBuckets: nil('count', why),
      hiddenTakerBuckets: nil('count', why),
    })),
  });
  const hidden = (why: string) => envelope(NAME_COHORTS, { why, observedSince: null, h1: empty(why), h24: empty(why) }, sources, now, notes);
  if (!f.ok) return hidden(tr(`przepływ kohort niedostępny (${f.why})`, `cohort flow unavailable (${f.why})`));
  const flow = f.value;
  // Jak panel Przepływ kohort: publikacja starsza niż 10 min — liczby ukryte
  if (cohortFreshness(flow, now) !== 'ready') {
    return hidden(tr(`Dane nieaktualne — ostatnia publikacja ${iso(flow.asOf)}; liczby ukryte`, `Data out of date, last published ${iso(flow.asOf)}; numbers hidden`));
  }
  const note = ageNote(flow.asOf, now);
  const end = cohortWindowEnd(flow);
  const first = flow.buckets[0]?.t ?? null;
  if (flow.since > flow.asOf - DAY) notes.push(tr(`Obserwacja od ${iso(flow.since)}: okno doby jest krótsze.`, `Observed since ${iso(flow.since)}: the day window is shorter.`));
  const data: CohortFlowData = {
    why: null,
    observedSince: iso(flow.since),
    h1: { from: end === null ? null : iso(end - HOUR), to: end === null ? null : iso(end), cohorts: cohortRows(flow.totals.h1, note) },
    h24: { from: first === null ? null : iso(first), to: end === null ? null : iso(end), cohorts: cohortRows(flow.totals.h24, note) },
  };
  return envelope(NAME_COHORTS, data, sources, now, notes);
}

export const cohortFlow: ToolDef = {
  name: NAME_COHORTS,
  title: tr('Przepływ kohort BTC', 'BTC cohort flow'),
  description: tr(
    `Kto kupuje, kto sprzedaje na BTC w Hyperliquid: cztery kohorty uczestników ze skanera HyperQuant (market makerzy, poinformowani, wieloryby, reszta) z saldem (zmiana zapasów), deltą agresora, obrotem i udziałem w obrocie, w oknie ostatniej godziny i doby, z granicami okien; ${VOLUME_SHARE_DEF}. Tylko agregaty, bez adresów. ${NO_DESC}`,
    `Who buys and who sells BTC on Hyperliquid: four participant cohorts from the HyperQuant scanner (market makers, informed, whales, rest) with the net flow (inventory change), aggressor delta, volume and volume share over the last hour and day, with the window bounds; ${VOLUME_SHARE_DEF}. Aggregates only, no addresses. ${NO_DESC}`
  ),
  run: (src) => cohortsRun(src),
};

// ───────────────────────── whales ─────────────────────────

export interface WhalePositionOut {
  /** Pseudonim konta ważny jedną dobę UTC. */
  id: string;
  side: WhalePosition['side'];
  usd: Num;
  entry: Num;
  liquidation: Num;
  leverage: Num;
  /** Czas odczytu pozycji (ISO UTC). */
  readAt: string;
}

export interface WhaleOrdersOut {
  id: string;
  side: WhaleOrderGroup['side'];
  kind: WhaleOrderGroup['kind'];
  count: Num;
  usd: Num;
  priceLow: Num;
  priceHigh: Num;
}

export interface WhalesData {
  why: string | null;
  /** Konta odczytane w ostatnich 15 min. */
  accounts: Num;
  /** Progi publikacji pozycji i zlecenia (USD). */
  thresholds: { position: Num; order: Num };
  /** Saldo wszystkich pozycji BTC od progu: longi, shorty, różnica i liczba pozycji. */
  balance: { longs: Num; shorts: Num; net: Num; positions: Num };
  /** Największe pozycje (do 10), od największej. */
  positions: WhalePositionOut[];
  /** Zlecenia jednego konta po jednej stronie i jednego rodzaju razem (do 10 grup), od największej sumy. */
  orders: WhaleOrdersOut[];
}

const NAME_WHALES = 'whales';
const WHALE_TOP = 10;
const WHALES_NOTE = tr(
  'Pozycje i zlecenia oczekujące największych kont Hyperliquid z ich publicznego stanu, pod pseudonimem ważnym jedną dobę UTC (bez adresów). Kwoty zaokrąglone do 2 cyfr znaczących, ceny do siatki ułamka procenta ceny, dźwignia do liczby całkowitej. Zlecenia jednego konta po jednej stronie arkusza (bid albo ask) i jednego rodzaju (limit, stop albo tp) razem: zakres cen, liczba i suma wartości. Saldo: longi minus shorty wszystkich pozycji od progu publikacji. Opis, nie sygnał.',
  'Positions and resting orders of the largest Hyperliquid accounts from their public state, under a pseudonym valid for one UTC day (no addresses). Amounts rounded to 2 significant digits, prices to a grid of a fraction of a percent of the price, leverage to an integer. Orders of one account on one book side (bid or ask) and of one kind (limit, stop or tp) together: price range, count and total value. Balance: longs minus shorts of all positions above the publication threshold. A description, not a signal.'
);

/** Liczba z obiektu pliku pod kluczem `BTC` (progi nie są sprawdzane przez strażnika pliku). */
function btcValue(r: unknown): number | undefined {
  if (typeof r !== 'object' || r === null) return undefined;
  const v = (r as Record<string, unknown>).BTC;
  return typeof v === 'number' ? v : undefined;
}

async function whalesRun(src: Sources): Promise<Envelope<WhalesData>> {
  const now = src.now();
  const f = await src.published('whales.json', isWhaleLayer);
  const sources = [fileSource(tr('Warstwa wielorybów skanera', 'Scanner whale layer'), f)];
  const notes = [WHALES_NOTE];
  const hidden = (why: string) =>
    envelope(
      NAME_WHALES,
      {
        why,
        accounts: nil('count', why),
        thresholds: { position: nil('usd', why), order: nil('usd', why) },
        balance: { longs: nil('usd', why), shorts: nil('usd', why), net: nil('usd', why), positions: nil('count', why) },
        positions: [],
        orders: [],
      },
      sources,
      now,
      notes
    );
  if (!f.ok) return hidden(tr(`warstwa wielorybów niedostępna (${f.why})`, `whale layer unavailable (${f.why})`));
  const w = f.value;
  // Jak wykres: plik starszy niż 20 min nie jest pokazywany; powód z tej samej funkcji co legenda
  const ws = whalesScan(now - w.asOf < WHALES_STALE_MS ? w : null, 'BTC', true);
  if ('why' in ws) return hidden(ws.why);
  const m = w.markets.BTC;
  const note = ageNote(w.asOf, now);
  const bal = whaleBalanceOf(m.positions, w.asOf);
  const none = tr(`Skaner nie widzi pozycji od progu publikacji (stan z ${iso(w.asOf)})`, `The scanner sees no positions above the publication threshold (as of ${iso(w.asOf)})`);
  const noThreshold = tr('brak progu w pliku', 'no threshold in the file');
  const positions = [...m.positions].sort((a, b) => b.usd - a.usd).slice(0, WHALE_TOP);
  const groups = groupWhaleOrders(m.orders);
  notes.push(tr(`Pokazane: ${positions.length} z ${m.positions.length} pozycji i ${Math.min(WHALE_TOP, groups.length)} z ${groups.length} grup zleceń (największe).`, `Shown: ${positions.length} of ${m.positions.length} positions and ${Math.min(WHALE_TOP, groups.length)} of ${groups.length} order groups (the largest).`));
  const data: WhalesData = {
    why: null,
    accounts: live(w.accounts, 'count', note),
    thresholds: { position: live(btcValue(w.minPositionUsd), 'usd', note, noThreshold), order: live(btcValue(w.minOrderUsd), 'usd', note, noThreshold) },
    balance:
      bal.n === 0
        ? { longs: nil('usd', none), shorts: nil('usd', none), net: nil('usd', none), positions: live(0, 'count', note) }
        : { longs: live(bal.long, 'usd', note), shorts: live(bal.short, 'usd', note), net: live(bal.long - bal.short, 'usd', note), positions: live(bal.n, 'count', note) },
    // Tylko pola pozycji i zlecenia znane stronie: dodatkowe pola pliku nie wychodzą
    positions: positions.map((p) => ({
      id: p.id,
      side: p.side,
      usd: live(p.usd, 'usd', note),
      entry: live(p.entry, 'price', note),
      liquidation: p.liq === null ? nil('price', tr('brak ceny likwidacji (np. pozycja zabezpieczona marżą krzyżową z zapasem)', 'no liquidation price (e.g. a position covered by cross margin with room to spare)')) : live(p.liq, 'price', note),
      leverage: live(p.lev, 'ratio', note),
      readAt: iso(p.at),
    })),
    orders: groups.slice(0, WHALE_TOP).map((g) => ({
      id: g.id,
      side: g.side,
      kind: g.kind,
      count: live(g.n, 'count', note),
      usd: live(g.usd, 'usd', note),
      priceLow: live(g.lo, 'price', note),
      priceHigh: live(g.hi, 'price', note),
    })),
  };
  return envelope(NAME_WHALES, data, sources, now, notes);
}

export const whales: ToolDef = {
  name: NAME_WHALES,
  title: tr('Wieloryby BTC', 'BTC whales'),
  description: tr(
    `Największe konta BTC na Hyperliquid ze skanera HyperQuant, pod pseudonimami ważnymi jedną dobę UTC (bez adresów): saldo longów i shortów, do 10 największych pozycji (wartość, wejście, cena likwidacji, dźwignia) i do 10 grup zleceń oczekujących (strona arkusza, rodzaj, zakres cen, suma). ${NO_DESC}`,
    `The largest BTC accounts on Hyperliquid from the HyperQuant scanner, under pseudonyms valid for one UTC day (no addresses): the balance of longs and shorts, up to 10 largest positions (value, entry, liquidation price, leverage) and up to 10 groups of resting orders (book side, kind, price range, total). ${NO_DESC}`
  ),
  run: (src) => whalesRun(src),
};

// ───────────────────────── twaps ─────────────────────────

export interface TwapShare {
  from: string | null;
  to: string | null;
  /** Udział wypełnień z hashem zerowym w wartości wszystkich transakcji okna (0–1), łącznie i po stronach agresora. */
  total: Num;
  buy: Num;
  sell: Num;
}

export interface TwapsData {
  why: string | null;
  /** Koniec nagrania taśmy (okna liczone od tej chwili, nie od chwili odpowiedzi). */
  recordedTo: string | null;
  share15: TwapShare;
  share60: TwapShare;
  activeCount: Num;
}

const NAME_TWAPS = 'twaps';
const ACTIVE_WHY = tr('liczba aktywnych TWAP-ów wymaga strumienia na żywo (w planach)', 'the number of active TWAPs requires the live stream (planned)');
const TWAP_NOTE = tr(
  'Udział wypełnień z hashem zerowym (m.in. podzlecenia TWAP, algorytm Hyperliquid dzielący zlecenie na części co 30 s) w wartości wszystkich transakcji okna, łącznie i po stronie agresora kupna i sprzedaży, jako ułamek 0–1. Ta sama formuła co liczba „TWAP 15 min” i wskaźnik „Udział TWAP w taśmie” na wykresie HyperQuant, z nagrań taśmy serwera (gałąź history repo danych: części 5 min bieżącej godziny i pliki godzinowe). Okna liczone od końca nagrania (recordedTo).',
  'The share of zero-hash fills (among others TWAP suborders, the Hyperliquid algorithm that splits an order into parts every 30 s) in the value of all trades in the window, in total and on the buying and the selling aggressor side, as a fraction 0–1. The same formula as the “TWAP 15 min” number and the “TWAP share of the tape” indicator on the HyperQuant chart, from the server tape recordings (the history branch of the data repo: 5-min parts of the current hour and hour files). Windows count back from the end of the recording (recordedTo).'
);

/** Plik nagrania taśmy: godzina albo część 5-minutowa, [start, end). */
interface HistUnit {
  start: number;
  end: number;
  part: boolean;
}

/**
 * Pliki taśmy BTC z ostatnich 60 min nagrania według spisu (plus zapas jednej części, gdy ostatnia część jest nagrana
 * tylko w części): godzina z plikiem godzinowym — ten plik, inaczej jej części. Wpisy spoza siatki (część nie na pełnych
 * 5 min, godzina nie na pełnej godzinie — ścieżka pliku zgubiłaby resztę i ten sam plik weszłby dwa razy) i spoza zakresu
 * czasu (uszkodzony spis: ujemne, z przyszłości) są pomijane; każdy plik najwyżej raz.
 */
function unitsOf(m: HistoryIndex['markets'][string], now: number): HistUnit[] {
  const sane = (step: number) => (t: number) => Number.isSafeInteger(t) && t >= 0 && t <= now + HOUR && t % step === 0;
  const hours = new Set(m.hours.filter(sane(HIST_HOUR_MS)));
  const parts = [...new Set(m.parts.filter(sane(HIST_PART_MS)))].sort((a, b) => a - b);
  let end = Number.NEGATIVE_INFINITY;
  for (const p of parts) end = Math.max(end, p + HIST_PART_MS);
  for (const h of hours) end = Math.max(end, h + HIST_HOUR_MS);
  if (!Number.isFinite(end)) return [];
  const from = end - HOUR - HIST_PART_MS;
  const first = Math.floor(from / HIST_HOUR_MS) * HIST_HOUR_MS;
  // Klucz: ścieżka pliku (ten sam plik najwyżej raz)
  const out = new Map<string, HistUnit>();
  const add = (start: number, part: boolean) => {
    const path = historyPath('BTC', start, 'trades', part);
    if (!out.has(path)) out.set(path, { start, end: start + (part ? HIST_PART_MS : HIST_HOUR_MS), part });
  };
  // Okno 65 min sięga najwyżej trzech godzin zegarowych
  for (let k = 0; k < 3; k++) {
    const h = first + k * HIST_HOUR_MS;
    if (h >= end) break;
    if (hours.has(h)) add(h, false);
    else for (const p of parts) if (p >= h && p < h + HIST_HOUR_MS && p + HIST_PART_MS > from) add(p, true);
  }
  return [...out.values()];
}

/** Ile minut z [from, to) obejmuje pokrycie, z jedną cyfrą po przecinku, w dół (59,98 min to „59,9”, nie pełne „60,0”). */
const coveredMin = (c: Coverage, from: number, to: number) => fmtFixed(Math.floor((c.coveredMs(from, to) / MIN) * 10) / 10, 1);

/** Wynik obietnicy albo null po `ms` — limit całego narzędzia przy dwóch kolejnych etapach żądań (spis, potem pliki). */
async function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Plik taśmy BTC (`decodeTrades` strony); inny rynek w pliku — zły kształt. */
function btcTrades(raw: unknown) {
  const t = decodeTrades(raw);
  return t && t.coin === 'BTC' ? t : null;
}

async function twapsRun(src: Sources): Promise<Envelope<TwapsData>> {
  const now = src.now();
  const t0 = performance.now();
  // Całość w 1,2 limitu żądania (12 s): spis i pliki to dwa kolejne etapy
  const budget = 1.2 * (src.cfg.timeoutMs ?? TIMEOUT_MS);
  const fi = await src.history('index.json', (raw) => (isHistoryIndex(raw) ? raw : null));
  const sources: SourceRef[] = [fileSource(tr('Spis nagrań taśmy', 'Tape recording index'), fi)];
  const notes = [TWAP_NOTE];
  const activeCount = nil('count', ACTIVE_WHY);
  const empty = (why: string, from: number | null = null, to: number | null = null): TwapShare => ({
    from: from === null ? null : iso(from),
    to: to === null ? null : iso(to),
    total: nil('ratio', why),
    buy: nil('ratio', why),
    sell: nil('ratio', why),
  });
  const none = (why: string) => envelope(NAME_TWAPS, { why, recordedTo: null, share15: empty(why), share60: empty(why), activeCount }, sources, now, notes);
  if (!fi.ok) return none(tr(`spis nagrań taśmy niedostępny (${fi.why})`, `tape recording index unavailable (${fi.why})`));
  const m = fi.value.markets.BTC;
  const units = m ? unitsOf(m, now) : [];
  if (units.length === 0) return none(tr('spis nie ma nagrań taśmy BTC', 'the index has no BTC tape recordings'));

  // Opublikowany plik zamkniętej godziny albo części już się nie zmienia: w pamięci 15 min zamiast 60 s
  const ttl = (u: HistUnit) => (u.end + HIST_PUBLISH_LAG_MS <= now ? TTL.historyClosed : TTL.published);
  const files = await within(Promise.all(units.map((u) => src.history(historyPath('BTC', u.start, 'trades', u.part), btcTrades, ttl(u)))), budget - (performance.now() - t0));
  if (!files) return none(tr(`pliki nagrań taśmy bez odpowiedzi w ${budget / 1000} s`, `tape recording files did not respond within ${budget / 1000} s`));
  units.forEach((u, i) => {
    const f = files[i];
    const name = u.part ? tr(`Nagranie taśmy BTC, część od ${iso(u.start)}`, `BTC tape recording, part from ${iso(u.start)}`) : tr(`Nagranie taśmy BTC, godzina od ${iso(u.start)}`, `BTC tape recording, hour from ${iso(u.start)}`);
    // Czas danych: koniec nagrania pliku (`to`), w granicach jego godziny albo części
    sources.push({ name, url: f.url, asOf: f.ok ? iso(Math.min(u.end, Math.max(u.start, f.value.to))) : null });
  });

  // Pokrycie nagraniem i znacznikami hasha zerowego (plik bez kolumny `z` — bez znaczników), jak `zeroKnown` magazynu strony;
  // odcinki i transakcje pliku tylko z jego godziny albo części (uszkodzony plik nie udaje nagrania spoza niej)
  const recorded = new Coverage();
  const zero = new Coverage();
  const trades: HistTrade[] = [];
  files.forEach((f, i) => {
    if (!f.ok) return;
    const { start: lo, end: hi } = units[i];
    for (const [a, b] of clipSpans(f.value.spans, lo, hi)) {
      recorded.addSpan(a, b);
      if (f.value.zeroKnown) zero.addSpan(a, b);
    }
    for (const t of f.value.trades) if (t.t >= lo && t.t < hi) trades.push(t);
  });
  const spans = recorded.list();
  const failed = files.find((f) => !f.ok);
  if (spans.length === 0) return none(failed && !failed.ok ? tr(`pliki nagrań taśmy niedostępne (${failed.why})`, `tape recording files unavailable (${failed.why})`) : tr('pliki nagrań taśmy bez nagranego czasu', 'tape recording files with no recorded time'));
  const end = spans[spans.length - 1][1];
  const age = scannerAge(end, now);
  const note = age === null ? undefined : tr(`nagranie taśmy do ${iso(end)} (sprzed ${age})`, `tape recorded up to ${iso(end)} (${age} ago)`);

  const share = (minutes: number): TwapShare => {
    const from = end - minutes * MIN;
    // Jak na stronie: udział tylko z okna pokrytego w całości; powód mówi, ile okna jest pokryte (sekunda luki ≠ brak godziny)
    if (!zero.covers(from, end)) {
      const why = recorded.covers(from, end)
        ? tr(
            `Taśma bez znaczników TWAP (hash zerowy) w całych ostatnich ${minutes} min nagrania: znaczniki obejmują ${coveredMin(zero, from, end)} min z ${minutes}`,
            `The tape lacks TWAP marks (zero hash) over the whole last ${minutes} min of the recording: marks cover ${coveredMin(zero, from, end)} min of ${minutes}`
          )
        : tr(
            `luka w nagraniu taśmy w ostatnich ${minutes} min: nagranie obejmuje ${coveredMin(recorded, from, end)} min z ${minutes} (przerwa nagrania albo plik niedostępny)`,
            `a gap in the tape recording over the last ${minutes} min: the recording covers ${coveredMin(recorded, from, end)} min of ${minutes} (a recording break or a file unavailable)`
          );
      return empty(why, from, end);
    }
    const fills = trades.filter((t) => t.t >= from && t.t < end).map((t) => ({ notional: t.px * t.sz, side: t.side === 'B' ? (1 as const) : (-1 as const), ...(t.z && { zero: true as const }) }));
    const s = twapShareOf(fills);
    if (isAbsent(s)) return empty(s.why, from, end);
    return { from: iso(from), to: iso(end), total: live(s.share, 'ratio', note), buy: live(s.buy, 'ratio', note), sell: live(s.sell, 'ratio', note) };
  };
  const data: TwapsData = { why: null, recordedTo: iso(end), share15: share(15), share60: share(60), activeCount };
  return envelope(NAME_TWAPS, data, sources, now, notes);
}

export const twaps: ToolDef = {
  name: NAME_TWAPS,
  title: tr('Udział TWAP w taśmie BTC', 'TWAP share of the BTC tape'),
  description: tr(
    `Udział wypełnień z hashem zerowym (m.in. podzlecenia TWAP Hyperliquid) w wartości taśmy BTC w ostatnich 15 i 60 min nagrania serwera HyperQuant, łącznie i po stronie agresora kupna i sprzedaży (ułamek 0–1), z końcem nagrania. Liczba aktywnych TWAP-ów jeszcze niedostępna (null z powodem). ${NO_DESC}`,
    `The share of zero-hash fills (among others Hyperliquid TWAP suborders) in the value of the BTC tape over the last 15 and 60 min of the HyperQuant server recording, in total and on the buying and the selling aggressor side (a fraction 0–1), with the recording end. The number of active TWAPs is not available yet (null with a reason). ${NO_DESC}`
  ),
  run: (src) => twapsRun(src),
};

// ───────────────────────── forecast_ledger ─────────────────────────

export interface LedgerReturns {
  /** Horyzont prognozy rozkładu zwrotu („60 min”, „240 min”). */
  horizon: string;
  settled: Num;
  /** Umiejętność CRPS wobec rozkładu normalnego z 30 dni (> 0 — lepiej). */
  crpss: Num;
  /** Odsetek realizacji w przedziałach 90%, 60% i ACI (nominał 0,9, 0,6 i 0,9). */
  cov90: Num;
  cov60: Num;
  covAci: Num;
  /** p-wartość testu Kupca pokrycia 90% na podpróbie rozłącznej. */
  kupiecP90: Num;
}

export interface ForecastLedgerData {
  why: string | null;
  /** Gdzie sprawdzić dziennik samodzielnie. */
  verifyUrl: string;
  returns: LedgerReturns[];
  /** Szanse dotknięcia PDH, D-EQ i PDL w 2 h: Brier modelu, Brier klimatologii i umiejętność (BSS). */
  touch: { settled: Num; brier: Num; brierBase: Num; bss: Num };
  pending: Num;
  voided: Num;
  slotsIssued: Num;
  slotsSkipped: Num;
}

const NAME_LEDGER = 'forecast_ledger';
const LEDGER_NOTE = tr(
  'Weryfikowalny dziennik prognoz HyperQuant: co 15 min prognozy zapisane przed faktem (rozkład zwrotu BTC na 1 h i 4 h, szanse dotknięcia PDH, D-EQ i PDL w 2 h), łańcuch hashy i kotwica w Bitcoinie (OpenTimestamps); rozstrzygnięcia ze świec 1m Hyperliquid. Prognozy nakładają się horyzontami, więc ich wyniki są skorelowane; test Kupca liczony na podpróbie rozłącznej. Wyniki od 20 rozstrzygnięć. Każdy może przeliczyć wyniki sam (verifyUrl).',
  'The verifiable HyperQuant forecast ledger: every 15 min forecasts recorded before the fact (the BTC return distribution over 1 h and 4 h, the chances of touching PDH, D-EQ and PDL within 2 h), a hash chain and a Bitcoin anchor (OpenTimestamps); settlements from Hyperliquid 1m candles. Forecast horizons overlap, so their outcomes are correlated; the Kupiec test runs on a disjoint subsample. Scores from 20 settlements. Anyone can recompute the scores (verifyUrl).'
);

async function ledgerRun(src: Sources): Promise<Envelope<ForecastLedgerData>> {
  const now = src.now();
  const f = await src.published('ledger/BTC/summary.json', isDeskLedgerSummary);
  const sources = [fileSource(tr('Podsumowanie dziennika prognoz', 'Forecast ledger summary'), f)];
  const notes = [LEDGER_NOTE];
  const verifyUrl = `${src.cfg.siteBase}/#sources`;
  if (!f.ok) {
    const why = tr(`podsumowanie dziennika prognoz niedostępne (${f.why})`, `forecast ledger summary unavailable (${f.why})`);
    const data: ForecastLedgerData = {
      why,
      verifyUrl,
      returns: [],
      touch: { settled: nil('count', why), brier: nil('ratio', why), brierBase: nil('ratio', why), bss: nil('ratio', why) },
      pending: nil('count', why),
      voided: nil('count', why),
      slotsIssued: nil('count', why),
      slotsSkipped: nil('count', why),
    };
    return envelope(NAME_LEDGER, data, sources, now, notes);
  }
  const s = f.value;
  const note = ageNote(s.asOf, now);
  // Jak panel dziennika: liczby zostają, z informacją o ostatniej aktualizacji
  if (ledgerFreshness(s, now) !== 'ready') notes.push(tr(`Dziennik nie był aktualizowany od ponad 35 min (ostatnia aktualizacja ${iso(s.asOf)}).`, `The ledger has not been updated for over 35 min (last update ${iso(s.asOf)}).`));
  const fromN = (n: number) => tr(`wyniki od ${LEDGER_MIN_N} rozstrzygnięć (jest ${n})`, `scores from ${LEDGER_MIN_N} settlements (now ${n})`);
  const noScore = tr('brak wyniku w podsumowaniu', 'no score in the summary');
  const score = (n: number) => (v: number | null | undefined) => (n >= LEDGER_MIN_N ? live(v, 'ratio', note, noScore) : nil('ratio', fromN(n)));
  const returns = Object.entries(s.scores.ret)
    .map(([k, sc]) => ({ h: Number(k), sc }))
    .filter((x) => Number.isFinite(x.h) && x.h > 0)
    .sort((a, b) => a.h - b.h)
    .map(({ h, sc }): LedgerReturns => {
      const at = score(sc.n);
      return {
        horizon: `${h} min`,
        settled: live(sc.n, 'count', note),
        crpss: at(sc.crpss),
        cov90: at(sc.cov90?.rate),
        cov60: at(sc.cov60?.rate),
        covAci: at(sc.covAci?.rate),
        kupiecP90: at(sc.cov90?.kupiecP),
      };
    });
  const t = s.scores.touch;
  const tt = score(t.n);
  const data: ForecastLedgerData = {
    why: null,
    verifyUrl,
    returns,
    touch: { settled: live(t.n, 'count', note), brier: tt(t.brier), brierBase: tt(t.brierBase), bss: tt(t.bss) },
    pending: live(s.pending, 'count', note),
    voided: live(s.voided, 'count', note),
    slotsIssued: live(s.participation.issued, 'count', note),
    slotsSkipped: live(s.participation.skipped, 'count', note),
  };
  return envelope(NAME_LEDGER, data, sources, now, notes);
}

export const forecastLedger: ToolDef = {
  name: NAME_LEDGER,
  title: tr('Dziennik prognoz HyperQuant', 'HyperQuant forecast ledger'),
  description: tr(
    `Trafność i kalibracja weryfikowalnego dziennika prognoz HyperQuant (prognozy BTC zapisywane co 15 min przed faktem, łańcuch hashy, kotwica w Bitcoinie): dla horyzontów zwrotu umiejętność CRPSS, pokrycie przedziałów 90%, 60% i ACI z testem Kupca; dla szans dotknięcia poziomów Brier i BSS; liczby rozstrzygnięć i pominiętych slotów; link do samodzielnej weryfikacji. Wyniki od 20 rozstrzygnięć. ${NO_DESC}`,
    `Accuracy and calibration of the verifiable HyperQuant forecast ledger (BTC forecasts recorded every 15 min before the fact, a hash chain, a Bitcoin anchor): for the return horizons the CRPSS skill and the coverage of the 90%, 60% and ACI intervals with the Kupiec test; for the level touch chances the Brier score and BSS; counts of settlements and skipped slots; a link to verify it yourself. Scores from 20 settlements. ${NO_DESC}`
  ),
  run: (src) => ledgerRun(src),
};
