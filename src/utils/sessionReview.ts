/**
 * Rozliczenie doby (Po sesji, spec §7.11): dzień tradera to sesja, więc rozliczamy ostatnią zamkniętą sesję Londynu i NY
 * oraz sesję w toku. Każdy wiersz to jedna liczba z plakietką LIVE albo MODEL (MODEL z nazwą metody w podpowiedzi),
 * a brak danych — „—” z powodem, nigdy 0 ani liczba zastępcza. Wiersze z okna danych innego niż sesja (stożek: 30 dni
 * dziennika, kohorty: ostatnie 24 h) są tak podpisane i oznaczone `scope: 'window'`. Opis, nie sygnał.
 */
import { tr } from '../i18n';
import { DASH, fmtCompact, fmtFixed, fmtSigned } from '../ui/format';
import { utcDayStart } from '../charts/pro/core/sessions';
import { fmtDayTime, fmtDm, fmtHm } from '../charts/pro/core/time';
import { blogMapName } from '../charts/pro/chart/blogMapLayer';
import { fmtPx } from '../charts/pro/chart/layout';
import { WAIT_TEXT } from '../charts/pro/chart/layerSources';
import { DAY_TYPE_LABEL, type Expected, type Got, METHOD, METHOD_NOTE, VA_MIGRATION_LABEL, isAbsent, profileStep } from '../charts/pro/chart/layoutNumbers';
import { replayHash } from '../charts/pro/replay/link';
import type { BlogMap, BlogMapsState } from '../state/useBlogMaps';
import type { CohortFlowState } from '../state/useCohortFlow';
import type { DeskLedgerState } from '../state/useDeskLedger';
import type { LiqTapeState } from '../state/useLiqTape';
import { type VBar, profile } from './auction';
import { COHORTS, COHORT_LABEL, type CohortId } from './cohorts';
import { classifyDay, vaMigration } from './dayType';
import { mapWindow, settleRange } from './mapSettlement';
import { type TradeSession, currentTradeSession, lastClosedSessions, nextTradeSession, previousSameSession, rangeBudget } from './sessionDay';
import { TRADE_SESSION_NAME } from './sessionNames';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Fakty sesji tylko przy ≥ 95% minut sesji w świecach 1m (jak profil sesji w nagłówku Rozliczenia). */
const COVERAGE = 0.95;
/** Pokrycie stożka od tylu rozstrzygniętych prognoz 1 h (jak opis stożka w legendzie wykresu). */
const CONE_MIN_N = 20;
/** Serwer trzyma nagranie taśmy i arkusza przez 7 dni — starsze minuty nie mają powtórki. */
export const REPLAY_KEEP_MS = 7 * DAY;

export type ReviewRowId = 'dayType' | 'vaMigration' | 'ib' | 'range' | 'map' | 'liq' | 'cone' | 'cohorts';

export interface ReviewRow {
  id: ReviewRowId;
  /** Klucz wiersza (mapy: id wpisu). */
  key: string;
  label: string;
  /** Liczba albo opis; brak danych — „—” z powodem w `why`. */
  value: string;
  badge: 'LIVE' | 'MODEL';
  /** Skąd liczba (MODEL: „MODEL · metoda: …”) albo powód braku. */
  hint: string;
  /** Powód braku albo niepełnego wyniku (luka w świecach 1m). */
  why?: string;
  /** Szczegóły pod wartością: poziomy mapy, markouty kohort. */
  detail?: string;
  /** `window` — wiersz z okna danych innego niż sesja (30 dni, ostatnie 24 h); widok pokazuje go raz, pod kartami. */
  scope: 'session' | 'window';
  /** Minuta do linku powtórki (`reviewReplay`); null — bez linku. */
  replayAt: number | null;
}

/** Wejścia rozliczenia jednej sesji; pole `undefined` — jeszcze się wczytuje. */
export interface ReviewInputs {
  s: TradeSession;
  inProgress: boolean;
  now: number;
  /** Świece 1m BTC rosnąco, od otwarcia poprzedniej sesji tego samego typu (migracja VA). */
  bars1m: Got<readonly VBar[]> | undefined;
  maps: BlogMapsState;
  /** Oczekiwany zakres sesji (MODEL: HAR albo Parkinson, ta sama metoda co budżet zakresu na żywo). */
  expected: Got<Expected> | undefined;
  liq: LiqTapeState;
  cohorts: CohortFlowState;
  ledger: DeskLedgerState;
}

/** Fakty sesji ze świec 1m: zakres z minutami ekstremów, IB i pierwsze wyjście z niego, value area tej i poprzedniej sesji. */
interface Facts {
  hi: number;
  lo: number;
  hiAt: number;
  loAt: number;
  close: number;
  ibHi: number;
  ibLo: number;
  ibDone: boolean;
  /** Pierwsza minuta po IB z ceną poza nim; null — bez wybicia. */
  breakAt: number | null;
  step: number;
  va: { vah: number; val: number } | null;
  prev: TradeSession;
  /** Value area poprzedniej sesji tego samego typu; null — świece jej nie obejmują. */
  prevVa: { vah: number; val: number } | null;
}

const name = (s: TradeSession) => TRADE_SESSION_NAME[s.id];
const whyOf = (v: Got<unknown> | undefined): string => (v === undefined ? WAIT_TEXT : isAbsent(v) ? v.why : WAIT_TEXT);
const pctOf = (b: number) => `${fmtFixed(b * 100, 0)}%`;
/** Odsetek bez „−0%”. */
const pct = (v: number) => `${fmtFixed(Math.round(v * 100) || 0, 0)}%`;
const amt = (v: number) => fmtFixed(v, Math.abs(v) >= 100 ? 0 : 2);
const BP = tr('pb', 'bp');

const absent = (id: ReviewRowId, label: string, badge: ReviewRow['badge'], why: string, o: { key?: string; hint?: string; scope?: ReviewRow['scope'] } = {}): ReviewRow => ({
  id,
  key: o.key ?? id,
  label,
  value: DASH,
  badge,
  hint: o.hint ?? why,
  why,
  scope: o.scope ?? 'session',
  replayAt: null,
});

/** Świece okresu [from, min(to, now)), gdy obejmują jego początek i ≥ 95% minut; inaczej null. */
function windowBars(bars: readonly VBar[], from: number, to: number, now: number): VBar[] | null {
  const end = Math.min(to, now);
  if (bars.length === 0 || bars[0].time > from || !(end > from)) return null;
  const list = bars.filter((b) => b.time >= from && b.time < end);
  return list.length > 0 && list.length >= COVERAGE * Math.ceil((end - from) / MIN) ? list : null;
}

function factsOf(x: ReviewInputs): Got<Facts> | undefined {
  const all = x.bars1m;
  if (all === undefined || isAbsent(all)) return all;
  const { s, now } = x;
  const bars = windowBars(all, s.start, s.end, now);
  const ib = bars ? bars.filter((b) => b.time < s.ibEnd) : [];
  if (!bars || ib.length === 0) {
    const since = all.length ? tr(`; świece od ${fmtDayTime(all[0].time, now)}`, `; candles from ${fmtDayTime(all[0].time, now)}`) : '';
    return {
      why: tr(
        `Świece 1m nie obejmują całej sesji ${name(s)} od ${fmtHm(s.start)} (min. 95% minut${since})`,
        `The 1m candles do not cover the whole ${name(s)} session since ${fmtHm(s.start)} (min. 95% of minutes${since})`
      ),
    };
  }
  let hi = -Infinity;
  let lo = Infinity;
  let hiAt = 0;
  let loAt = 0;
  for (const b of bars) {
    if (b.high > hi) [hi, hiAt] = [b.high, b.time];
    if (b.low < lo) [lo, loAt] = [b.low, b.time];
  }
  const ibHi = Math.max(...ib.map((b) => b.high));
  const ibLo = Math.min(...ib.map((b) => b.low));
  const brk = bars.find((b) => b.time >= s.ibEnd && (b.high > ibHi || b.low < ibLo));
  const close = bars[bars.length - 1].close;
  const step = profileStep(close);
  const prev = previousSameSession(s);
  const prevBars = windowBars(all, prev.start, prev.end, now);
  const va = profile(bars, step);
  const pv = prevBars ? profile(prevBars, step) : null;
  return {
    hi,
    lo,
    hiAt,
    loAt,
    close,
    ibHi,
    ibLo,
    ibDone: now >= s.ibEnd,
    breakAt: brk ? brk.time : null,
    step,
    va: va ? { vah: va.vah, val: va.val } : null,
    prev,
    prevVa: pv ? { vah: pv.vah, val: pv.val } : null,
  };
}

/** Ostatnia minuta zamkniętej sesji (powtórka pokazuje całą sesję); sesja w toku — bez linku, wykres na żywo jest wyżej. */
const sessionEnd = (x: ReviewInputs) => (x.inProgress ? null : x.s.end - MIN);

function dayTypeRow(x: ReviewInputs, f: Got<Facts> | undefined): ReviewRow {
  const label = tr('Typ dnia', 'Day type');
  const m = 'MODEL · Dalton';
  const no = (why: string) => absent('dayType', label, 'MODEL', why, { hint: `${m}: ${why}` });
  if (!f || isAbsent(f)) return no(whyOf(f));
  if (!f.ibDone) return no(tr(`IB w budowie do ${fmtHm(x.s.ibEnd)}`, `IB forming until ${fmtHm(x.s.ibEnd)}`));
  const t = classifyDay(f);
  if (t === 'unknown') return no(tr('zakres IB zerowy albo brak liczb', 'zero IB range or missing numbers'));
  const k = fmtFixed((f.hi - f.lo) / (f.ibHi - f.ibLo), 1);
  return {
    id: 'dayType',
    key: 'dayType',
    label,
    value: DAY_TYPE_LABEL[t],
    badge: 'MODEL',
    hint: tr(
      `${m}: IB ${fmtPx(f.ibLo)}–${fmtPx(f.ibHi)}, zakres sesji ${fmtPx(f.lo)}–${fmtPx(f.hi)} (${k}× IB), zamknięcie ${fmtPx(f.close)}${x.inProgress ? ' (sesja w toku, typ może się zmienić)' : ''}. Do 1,15× IB normalny, od 2× z zamknięciem w skrajnych 20% po stronie wybicia trendowy, wybicie w obie strony neutralny, reszta wariant normalny. Ze świec 1m sesji. Opis, nie sygnał.`,
      `${m}: IB ${fmtPx(f.ibLo)}–${fmtPx(f.ibHi)}, session range ${fmtPx(f.lo)}–${fmtPx(f.hi)} (${k}× IB), close ${fmtPx(f.close)}${x.inProgress ? ' (session in progress, the type may change)' : ''}. Up to 1.15× IB normal, from 2× with a close in the outer 20% on the breakout side trend, a breakout on both sides neutral, otherwise normal variation. From the session's 1m candles. A description, not a signal.`
    ),
    scope: 'session',
    replayAt: sessionEnd(x),
  };
}

function vaRow(x: ReviewInputs, f: Got<Facts> | undefined): ReviewRow {
  const label = tr('Migracja VA', 'VA migration');
  const no = (why: string) => absent('vaMigration', label, 'LIVE', why);
  if (!f || isAbsent(f)) return no(whyOf(f));
  const pn = `${name(f.prev)} ${fmtDm(f.prev.start)}`;
  if (!f.prevVa) return no(tr(`Świece 1m nie obejmują poprzedniej sesji ${pn} (min. 95% minut)`, `The 1m candles do not cover the previous session ${pn} (min. 95% of minutes)`));
  if (!f.va) return no(tr('Brak wolumenu w świecach sesji', 'No volume in the session candles'));
  const m = vaMigration(f.va, f.prevVa);
  if (m === 'unknown') return no(tr('Value area bez liczb', 'Value area without numbers'));
  return {
    id: 'vaMigration',
    key: 'vaMigration',
    label,
    value: VA_MIGRATION_LABEL[m],
    badge: 'LIVE',
    hint: tr(
      `Value area 70% sesji ${name(x.s)} ${fmtPx(f.va.val)}–${fmtPx(f.va.vah)} wobec poprzedniej sesji ${pn} ${fmtPx(f.prevVa.val)}–${fmtPx(f.prevVa.vah)}; profile wolumenu ze świec 1m (koszyk ${amt(f.step)} USD).`,
      `The ${name(x.s)} session 70% value area ${fmtPx(f.va.val)}–${fmtPx(f.va.vah)} against the previous session ${pn} ${fmtPx(f.prevVa.val)}–${fmtPx(f.prevVa.vah)}; volume profiles from 1m candles (bin ${amt(f.step)} USD).`
    ),
    scope: 'session',
    replayAt: sessionEnd(x),
  };
}

function ibRow(x: ReviewInputs, f: Got<Facts> | undefined): ReviewRow {
  const label = tr('Wynik IB', 'IB result');
  const no = (why: string) => absent('ib', label, 'LIVE', why);
  if (!f || isAbsent(f)) return no(whyOf(f));
  const { s } = x;
  const range = `${fmtPx(f.ibLo)}–${fmtPx(f.ibHi)}`;
  if (!f.ibDone) {
    return {
      id: 'ib',
      key: 'ib',
      label,
      value: tr('w budowie', 'forming'),
      badge: 'LIVE',
      hint: tr(`Initial balance to pierwsza godzina sesji, do ${fmtHm(s.ibEnd)}; dotąd ${range}.`, `The initial balance is the first hour of the session, until ${fmtHm(s.ibEnd)}; so far ${range}.`),
      scope: 'session',
      replayAt: null,
    };
  }
  const ibr = f.ibHi - f.ibLo;
  if (!(ibr > 0)) return no(tr('Zakres IB zerowy', 'Zero IB range'));
  const up = f.hi > f.ibHi;
  const down = f.lo < f.ibLo;
  const k = `${fmtFixed((f.hi - f.lo) / ibr, 1)}×`;
  const value =
    up && down ? tr(`w obie strony · ${k}`, `both sides · ${k}`) : up ? tr(`w górę · ${k}`, `up · ${k}`) : down ? tr(`w dół · ${k}`, `down · ${k}`) : tr('brak wybicia', 'no breakout');
  const first = f.breakAt === null ? '' : tr(`; pierwsze wyjście poza IB o ${fmtHm(f.breakAt)}`, `; first move out of the IB at ${fmtHm(f.breakAt)}`);
  return {
    id: 'ib',
    key: 'ib',
    label,
    value,
    badge: 'LIVE',
    hint: tr(
      `IB sesji ${name(s)} (pierwsza godzina, ${fmtHm(s.start)}–${fmtHm(s.ibEnd)}): ${range}. Zakres sesji ${fmtPx(f.lo)}–${fmtPx(f.hi)} to ${k} IB${first}. Wybicie to wyjście ceny poza IB po pierwszej godzinie. Ze świec 1m. Opis aukcji, nie sygnał.`,
      `The ${name(s)} session IB (first hour, ${fmtHm(s.start)}–${fmtHm(s.ibEnd)}): ${range}. The session range ${fmtPx(f.lo)}–${fmtPx(f.hi)} is ${k} the IB${first}. A breakout is price leaving the IB after the first hour. From 1m candles. A description of the auction, not a signal.`
    ),
    scope: 'session',
    replayAt: f.breakAt ?? (x.inProgress ? null : s.ibEnd),
  };
}

function rangeRow(x: ReviewInputs, f: Got<Facts> | undefined): ReviewRow {
  const label = tr('Zakres / oczekiwany', 'Range / expected');
  const no = (why: string, m = tr('HAR albo Parkinson', 'HAR or Parkinson')) => absent('range', label, 'MODEL', why, { hint: `MODEL · ${m}: ${why}` });
  if (!f || isAbsent(f)) return no(whyOf(f));
  const e = x.expected;
  if (e === undefined || isAbsent(e)) return no(whyOf(e));
  const m = METHOD[e.method];
  const b = rangeBudget(f.hi, f.lo, e.usd);
  if (!Number.isFinite(b)) return no(tr('brak zakresu sesji', 'no session range'), m);
  const closed = !x.inProgress;
  const note =
    closed && e.method === 'parkinson'
      ? tr(
          'Bez modelu HAR: σ Parkinsona ze świec 5m z doby przed otwarciem sesji (oczekiwanie sprzed sesji), E[H−L] = √(8/π)·σ.',
          'Without the HAR model: Parkinson σ from 5m candles of the day before the session open (the expectation before the session), E[H−L] = √(8/π)·σ.'
        )
      : closed
        ? `${METHOD_NOTE.har} ${tr(
            'Dla zamkniętej sesji poziom zmienności z bieżącego modelu przeniesiony profilem godzin na jej godziny — model nie zapisuje prognozy sprzed sesji.',
            'For a closed session the volatility level of the current model is carried to its hours by the hourly profile; the model keeps no forecast from before the session.'
          )}`
        : METHOD_NOTE[e.method];
  return {
    id: 'range',
    key: 'range',
    label,
    value: pctOf(b),
    badge: 'MODEL',
    hint: tr(
      `MODEL · ${m}: zakres sesji ${name(x.s)} ${amt(f.hi - f.lo)} USD (${fmtPx(f.lo)}–${fmtPx(f.hi)}) wobec oczekiwanych ${amt(e.usd)} USD${x.inProgress ? ' (sesja w toku)' : ''}: 100% — dokładnie, ponad 100% — ruch większy niż oczekiwany. ${note}`,
      `MODEL · ${m}: the ${name(x.s)} session range ${amt(f.hi - f.lo)} USD (${fmtPx(f.lo)}–${fmtPx(f.hi)}) against an expected ${amt(e.usd)} USD${x.inProgress ? ' (session in progress)' : ''}: 100% exactly, over 100% a bigger move than expected. ${note}`
    ),
    scope: 'session',
    replayAt: Math.max(f.hiAt, f.loAt),
  };
}

/**
 * Mapy z bloga sesji: rozliczane, których okno ważności zachodzi na sesję, oraz mapy tygodnia i weekendu (bez okna)
 * opublikowane w jej części doby (Azja i Londyn — karta Londynu, NY — karta NY). Od najstarszej.
 */
function sessionMaps(maps: readonly BlogMap[], s: TradeSession, now: number): BlogMap[] {
  const dayFrom = s.id === 'london' ? utcDayStart(s.start) : s.start;
  return maps
    .filter((m) => {
      if (m.publishedAt > now) return false;
      const w = mapWindow(m.kind, m.publishedAt);
      return w ? w.from < s.end && w.to > s.start : m.publishedAt >= dayFrom && m.publishedAt < s.end;
    })
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

function mapRow(x: ReviewInputs, m: BlogMap): ReviewRow {
  const { s, now, inProgress } = x;
  const label = `${blogMapName(m.kind)} ${fmtDayTime(m.publishedAt, now)}`;
  const key = `map:${m.id}`;
  const no = (why: string, hint?: string) => absent('map', label, 'LIVE', why, { key, hint });
  const w = mapWindow(m.kind, m.publishedAt);
  if (!w) {
    return no(
      tr('bez rozliczenia (mapa tygodnia/weekendu)', 'not settled (weekly/weekend map)'),
      tr(`Wpis „${m.title}”: mapy tygodnia i weekendu nie mają okna sesji, więc ich poziomów się nie rozlicza.`, `Post “${m.title}”: weekly and weekend maps have no session window, so their levels are not settled.`)
    );
  }
  const bars = x.bars1m;
  if (bars === undefined || isAbsent(bars)) return no(whyOf(bars));
  const from = Math.max(w.from, s.start);
  const to = Math.min(w.to, s.end);
  const r = settleRange(m.levels, bars, from, to, now);
  if (!r) {
    // Świece w drodze widok podaje jako `undefined`; tu historia 1m (limit API albo błąd) nie sięga początku okresu
    const since = bars.length ? tr(` (świece od ${fmtDayTime(bars[0].time, now)})`, ` (candles from ${fmtDayTime(bars[0].time, now)})`) : '';
    return no(tr(`Świece 1m nie sięgają ${fmtHm(from)}${since}`, `The 1m candles do not reach ${fmtHm(from)}${since}`));
  }
  const hit = r.levels.filter((l) => l.touchedAt !== null).sort((a, b) => a.touchedAt! - b.touchedAt!);
  const miss = r.levels.filter((l) => l.touchedAt === null);
  const k = `${hit.length}/${r.levels.length}`;
  const missWord = !r.complete ? tr('nierozliczone', 'unsettled') : inProgress ? tr('jeszcze niedotknięte', 'not touched yet') : tr('chybione', 'missed');
  // Z ceną: mapa bywa z dwoma poziomami o tym samym podpisie (np. dwa klastry likwidacji longów)
  const px = (l: { label: string; price: number }) => `${l.label} ${fmtPx(l.price)}`;
  const detail = [...hit.map((l) => `${px(l)} ✓ ${fmtHm(l.touchedAt!)}`), ...(miss.length ? [`${missWord}: ${miss.map(px).join(', ')}`] : [])].join(' · ');
  const until = inProgress && now < to ? tr('teraz', 'now') : fmtHm(to);
  return {
    id: 'map',
    key,
    label,
    value: tr(`${k} dotknięte`, `${k} touched`),
    badge: 'LIVE',
    hint: tr(
      `Wpis „${m.title}”: poziomy z tekstu autora, nie model HyperQuant. Rozliczenie w sesji ${name(s)} od ${fmtHm(from)} do ${until}: dotknięcie = świeca 1m Hyperliquid z low ≤ poziom ≤ high, ta sama reguła co ✓ na wykresie; bez świecy każdej pełnej minuty niedotknięte poziomy zostają nierozliczone.`,
      `Post “${m.title}” (PL blog): levels from the author's text, not a HyperQuant model. Settled in the ${name(s)} session from ${fmtHm(from)} until ${until}: a touch is a Hyperliquid 1m candle with low ≤ level ≤ high, the same rule as the ✓ on the chart; without a candle for every full minute, untouched levels stay unsettled.`
    ),
    ...(r.complete ? {} : { why: tr('reszta nierozliczona: luka w świecach 1m', 'the rest is unsettled: a gap in the 1m candles') }),
    detail,
    scope: 'session',
    replayAt: hit.length ? hit[0].touchedAt : null,
  };
}

function mapRows(x: ReviewInputs): ReviewRow[] {
  const label = tr('Mapa z bloga', 'Blog map');
  if (x.maps.status === 'loading') return [absent('map', label, 'LIVE', WAIT_TEXT)];
  if (x.maps.status === 'missing') return [absent('map', label, 'LIVE', tr('Brak mapy: plik map z bloga niedostępny', 'No map: the blog maps file is unavailable'))];
  const list = sessionMaps(x.maps.maps, x.s, x.now);
  if (list.length === 0) {
    return [absent('map', label, 'LIVE', tr(`Brak mapy z bloga dla sesji ${name(x.s)} (plik ma mapy z ostatnich 3 dni)`, `No blog map for the ${name(x.s)} session (the file holds maps from the last 3 days)`))];
  }
  return list.map((m) => mapRow(x, m));
}

function liqRow(x: ReviewInputs): ReviewRow {
  const label = tr('Likwidacje w sesji', 'Liquidations in the session');
  const no = (why: string) => absent('liq', label, 'LIVE', why);
  const st = x.liq;
  if (st.status === 'unconfigured') return no(tr('Taśma likwidacji niedostępna w tej wersji strony', 'The liquidation tape is unavailable in this version of the site'));
  if (st.status === 'loading') return no(WAIT_TEXT);
  if (st.status === 'error' || !st.tape) return no(tr('Nie udało się pobrać taśmy likwidacji', 'Could not load the liquidation tape'));
  const tape = st.tape;
  const { s, now, inProgress } = x;
  const at = (t: number) => fmtDayTime(t, now);
  const day = tape.asOf - DAY;
  if (s.start < Math.max(tape.since, day)) {
    return no(
      tape.since > day
        ? tr(`Skaner obserwuje likwidacje bez przerwy od ${at(tape.since)}, a sesja zaczęła się ${at(s.start)}`, `The scanner has watched liquidations without a break since ${at(tape.since)}, and the session began ${at(s.start)}`)
        : tr(`Taśma likwidacji obejmuje ostatnie 24 h (od ${at(day)}), a sesja zaczęła się ${at(s.start)}`, `The liquidation tape covers the last 24 h (since ${at(day)}), and the session began ${at(s.start)}`)
    );
  }
  if (inProgress && tape.asOf < s.start) return no(tr(`Taśma likwidacji jeszcze bez tej sesji (stan z ${at(tape.asOf)})`, `The liquidation tape does not reach this session yet (as of ${at(tape.asOf)})`));
  if (!inProgress && tape.asOf < s.end) return no(tr(`Taśma likwidacji kończy się ${at(tape.asOf)}, przed końcem sesji`, `The liquidation tape ends at ${at(tape.asOf)}, before the session end`));
  if (inProgress && st.status === 'expired') return no(tr(`Taśma likwidacji nieaktualna (stan z ${at(tape.asOf)})`, `The liquidation tape is stale (as of ${at(tape.asOf)})`));
  let long = 0;
  let short = 0;
  let n = 0;
  let top: { t: number; usd: number } | null = null;
  for (const b of tape.buckets) {
    if (b.t < s.start || b.t >= s.end) continue;
    long += b.longUsd;
    short += b.shortUsd;
    n += b.n;
    if (!top || b.longUsd + b.shortUsd > top.usd) top = { t: b.t, usd: b.longUsd + b.shortUsd };
  }
  const end = inProgress ? tape.asOf : s.end;
  const peak = top ? tr(`; najwięcej w kubełku od ${fmtHm(top.t)}`, `; the most in the bucket from ${fmtHm(top.t)}`) : '';
  return {
    id: 'liq',
    key: 'liq',
    label,
    value: tr(`longi ${fmtCompact(long)} · shorty ${fmtCompact(short)}`, `longs ${fmtCompact(long)} · shorts ${fmtCompact(short)}`),
    badge: 'LIVE',
    hint: tr(
      `Taśma likwidacji skanera, kubełki 5 min sesji ${name(s)} ${fmtHm(s.start)}–${fmtHm(end)}: ${n} likwidacji, longi ${fmtCompact(long)} USD, shorty ${fmtCompact(short)} USD${peak}. Tylko pozycje śledzone przez skaner (część open interest), potwierdzone fillami z polem liquidation.`,
      `The scanner's liquidation tape, 5 min buckets of the ${name(s)} session ${fmtHm(s.start)}–${fmtHm(end)}: ${n} liquidations, longs ${fmtCompact(long)} USD, shorts ${fmtCompact(short)} USD${peak}. Only positions tracked by the scanner (part of open interest), confirmed by fills with the liquidation field.`
    ),
    scope: 'session',
    replayAt: top ? top.t : null,
  };
}

function coneRow(x: ReviewInputs): ReviewRow {
  const label = tr('Pokrycie stożka 1 h · 30 dni', 'Cone coverage 1 h · 30 days');
  const m = tr('MODEL · dziennik prognoz (HAR + FHS)', 'MODEL · forecast ledger (HAR + FHS)');
  const no = (why: string) => absent('cone', label, 'MODEL', why, { hint: `${m}: ${why}`, scope: 'window' });
  const st = x.ledger;
  if (st.status === 'unconfigured') return no(tr('Dziennik prognoz niedostępny w tej wersji strony', 'The forecast ledger is unavailable in this version of the site'));
  if (st.status === 'loading') return no(WAIT_TEXT);
  if (st.status === 'error' || !st.summary) return no(tr('Nie udało się pobrać podsumowania dziennika prognoz', 'Could not load the forecast ledger summary'));
  const sum = st.summary;
  const asOf = fmtDayTime(sum.asOf, x.now);
  if (st.status === 'expired') return no(tr(`Podsumowanie dziennika nieaktualne (stan z ${asOf})`, `The ledger summary is stale (as of ${asOf})`));
  const sc = sum.scores.ret['60'];
  if (!sc || !sc.cov90 || !sc.cov60 || sc.n < CONE_MIN_N) {
    const n = sc?.n ?? 0;
    return no(tr(`Za mało rozstrzygniętych prognoz 1 h (od ${CONE_MIN_N}, jest ${n})`, `Too few settled 1 h forecasts (from ${CONE_MIN_N}, now ${n})`));
  }
  const kupiec = sc.cov90.kupiecP === null ? '' : tr(`, test Kupca p = ${fmtFixed(sc.cov90.kupiecP, 2)}`, `, Kupiec test p = ${fmtFixed(sc.cov90.kupiecP, 2)}`);
  return {
    id: 'cone',
    key: 'cone',
    label,
    value: `90%: ${pct(sc.cov90.rate)} · 60%: ${pct(sc.cov60.rate)}`,
    badge: 'MODEL',
    hint: tr(
      `${m}: odsetek rozstrzygniętych prognoz 1 h z ostatnich 30 dni, których wynik zmieścił się w przedziale 90% i 60% stożka (nominał 90% i 60%${kupiec}); ${sc.n} prognoz, stan z ${asOf}. Okno 30 dni dziennika, nie wynik tej sesji.`,
      `${m}: the share of settled 1 h forecasts over the last 30 days whose outcome fell inside the cone's 90% and 60% intervals (nominal 90% and 60%${kupiec}); ${sc.n} forecasts, as of ${asOf}. The ledger's 30-day window, not this session's result.`
    ),
    scope: 'window',
    replayAt: null,
  };
}

function cohortsRow(x: ReviewInputs): ReviewRow {
  const label = tr('Kto wygrał · ostatnie 24 h (dane dobowe)', 'Who won · last 24 h (daily data)');
  const no = (why: string) => absent('cohorts', label, 'LIVE', why, { scope: 'window' });
  const st = x.cohorts;
  if (st.status === 'unconfigured') return no(tr('Przepływ kohort niedostępny w tej wersji strony', 'Cohort flow is unavailable in this version of the site'));
  if (st.status === 'loading') return no(WAIT_TEXT);
  if (st.status === 'error' || !st.flow) return no(tr('Nie udało się pobrać przepływu kohort', 'Could not load the cohort flow'));
  const flow = st.flow;
  const asOf = fmtDayTime(flow.asOf, x.now);
  if (st.status === 'expired') return no(tr(`Dane kohort nieaktualne (stan z ${asOf})`, `Cohort data is stale (as of ${asOf})`));
  let best: { c: CohortId; v: number } | null = null;
  for (const c of COHORTS) {
    const v = flow.oos[c].m60;
    if (v !== null && Number.isFinite(v) && (!best || v > best.v)) best = { c, v };
  }
  if (!best) return no(tr('Brak markoutów 60 min w ostatnich 24 h (godziny ukryte albo za mało biorców)', 'No 60 min markouts in the last 24 h (hidden hours or too few takers)'));
  const detail = `${COHORTS.map((c) => {
    const v = flow.oos[c].m60;
    return `${COHORT_LABEL[c]} ${v === null ? DASH : fmtSigned(v, 1)}`;
  }).join(' · ')} ${BP}`;
  return {
    id: 'cohorts',
    key: 'cohorts',
    label,
    value: `${COHORT_LABEL[best.c]} ${fmtSigned(best.v, 1)} ${BP}`,
    badge: 'LIVE',
    hint: tr(
      `Markout 60 min transakcji biorców według kohorty: średnia ważona nominałem w pb (dodatni — cena poszła w kierunku transakcji) z 24 ostatnich sfinalizowanych godzin, stan z ${asOf}. Najwyższy ma kohorta ${COHORT_LABEL[best.c]}. Dane dobowe skanera, nie wynik tej sesji. Opis, nie sygnał.`,
      `60 min markout of taker trades by cohort: a notional-weighted average in bp (positive means price moved in the trade's direction) over the last 24 finalized hours, as of ${asOf}. The highest is ${COHORT_LABEL[best.c]}. The scanner's daily data, not this session's result. A description, not a signal.`
    ),
    detail,
    scope: 'window',
    replayAt: null,
  };
}

/** Wiersze rozliczenia sesji: typ dnia, migracja VA, wynik IB, zakres wobec oczekiwanego, mapy z bloga, likwidacje, stożek, kohorty. */
export function reviewRows(x: ReviewInputs): ReviewRow[] {
  const f = factsOf(x);
  return [dayTypeRow(x, f), vaRow(x, f), ibRow(x, f), rangeRow(x, f), ...mapRows(x), liqRow(x), coneRow(x), cohortsRow(x)];
}

export interface ReviewCard {
  s: TradeSession;
  inProgress: boolean;
}

/**
 * Karty Rozliczenia w chwili `now`: dwie ostatnie zamknięte sesje (zawsze Londyn i NY, od starszej) i sesja w toku.
 * W sesji azjatyckiej karty w toku nie ma — `next` to najbliższe otwarcie.
 */
export function reviewCards(now: number): { cards: ReviewCard[]; next: TradeSession | null } {
  const closed = lastClosedSessions(now, 2).map((s): ReviewCard => ({ s, inProgress: false }));
  const live = currentTradeSession(now);
  return live ? { cards: [...closed, { s: live, inProgress: true }], next: null } : { cards: closed, next: nextTradeSession(now) };
}

/**
 * Link do powtórki minuty `at` w układzie Rozliczenie (5m, zakres sesji). Tylko minuty z ostatnich 7 dni — starsze
 * nagranie serwer już usunął; brak minuty albo minuta z przyszłości — null.
 */
export function reviewReplay(at: number | null, s: TradeSession, now: number): string | null {
  if (at === null || !Number.isFinite(at) || at > now || now - at > REPLAY_KEEP_MS) return null;
  return replayHash({ source: 'history', coin: 'BTC', interval: '5m', from: Math.max(s.start, now - REPLAY_KEEP_MS), to: s.end, t: at, station: 'review' });
}
