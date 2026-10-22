/**
 * Laboratorium folkloru: prerejestrowany katalog reguł day tradingu BTC, ocena historyczna (eksploracyjna, FDR
 * Benjaminiego–Hochberga) i ocena do przodu (potwierdzająca: e-wartości z procesu zakładów, e-BH, sekwencja ufności) —
 * wyłącznie na zdarzeniach rozpoczętych po zapisie katalogu w weryfikowalnym dzienniku.
 * Metoda zdarzeń i hipotezy zerowej: src/utils/labEvents.ts; statystyka: src/utils/anytime.ts.
 */
import { bettingEProcess, bhQValues, eBH, effectCS } from './anytime.ts';
import {
  MIN_BAND_RANGES,
  cmeGapEvents,
  fundingEvents,
  ibBreakEvents,
  intradayMomEvents,
  levelEvents,
  nyTenAmEvents,
  prevDayEvents,
  vwapEvents,
  weekendEvents,
  type Dropped,
  type GenResult,
  type LabBar,
  type LabEvent,
} from './labEvents.ts';
import { mulberry32 } from './pathEngine.ts';
import { normCdf } from './stats.ts';

export const LAB_VERSION = 'lab-v1';

/**
 * Prerejestrowana definicja reguły (część hashowanego katalogu). Teksty prezentacyjne (nazwa, teza, źródło) są osobno
 * w `LAB_TEXT` — ich poprawka nie zmienia katalogu ani nie zeruje oceny do przodu.
 */
export interface LabHypothesis {
  id: string;
  family: 'folklore' | 'control';
  /** Definicja zdarzenia i sukcesu */
  rule: string;
  /** Parametry generatora (jedyne źródło prawdy dla kodu) */
  params: Record<string, number>;
}

export const LAB_RULES = {
  /** e-BH osobno dla potwierdzenia i obalenia, każda rodzina na 5% → łącznie FDR ≤ 10% */
  alphaFamily: 0.05,
  /** BH dla testów historycznych (eksploracyjnych) */
  fdrQ: 0.1,
  /** Sekwencja ufności efektu */
  csAlpha: 0.1,
  /** „Efekt wykluczony”, gdy cała sekwencja ufności w ±csExclude */
  csExclude: 0.05,
  /** Werdykt historyczny od tylu zdarzeń */
  minHist: 30,
  /**
   * Ocena do przodu od zdarzeń rozpoczętych tyle godzin po rekordzie prerejestracji — pokwitowanie OpenTimestamps
   * w bloku Bitcoina powstaje z opóźnieniem, a dowód „katalog przed danymi” ma być ścisły
   */
  forwardGraceH: 24,
  minBandRanges: MIN_BAND_RANGES,
} as const;

/**
 * Wektor kontrolny: SHA-256 kanonicznego wyniku `labGoldenOutput()` (cały silnik — zdarzenia, statystyka historyczna,
 * e-procesy, sekwencje ufności — na stałych danych syntetycznych). Test pilnuje zgodności, więc każda zmiana zachowania
 * kodu wymusza aktualizację tej wartości, a przez nią nowy hash katalogu i nową prerejestrację.
 */
const LAB_GOLDEN = 'db63694047a639004e4e3af452e0a933b30d12caffccaa4f9f55ec4d6c7b537e';

export const LAB_CATALOG: {
  version: string;
  data: string;
  null: string;
  rules: typeof LAB_RULES;
  golden: string;
  hypotheses: LabHypothesis[];
} = {
  version: LAB_VERSION,
  data: 'Świece 1h (kontrola weekendu: świece 1d) i godzinowe finansowanie BTC-USD z publicznego API Hyperliquid, czas UTC; historia z archiwum (gałąź archive repo danych).',
  null:
    'Reguły barierowe: cena jest martyngałem — P(sukces) = p0 = |C − porażka| / |sukces − porażka| (twierdzenie o opcjonalnym zatrzymaniu, bez założeń o kształcie rozkładu przyrostów); limit czasu albo luka w danych → wynik ułamkowy z ostatniego zamknięcia (nadal E = p0); świeca dotykająca obu barier odrzucona (neutralne przy symetrii odbicia przyrostów, rzadkie dzięki regule szerokości pasma). Reguły kalendarzowe: p0 = 0,5 z symetrii znaku (10:00 NY, momentum) albo wymienialności dni (weekend).',
  rules: LAB_RULES,
  golden: LAB_GOLDEN,
  hypotheses: [
    {
      id: 'round-res',
      family: 'folklore',
      rule: 'Przebicie od dołu poziomu 1000·k w świecy 1h (poprzednie zamknięcie poniżej poziomu, maksimum świecy ≥ poziom); start na zamknięciu tej świecy. Sukces: spadek do L − 1%·L przed wzrostem do L + 1%·L; limit 72 h.',
      params: { step: 1000, offset: 0, dPct: 0.01, maxBars: 72 },
    },
    {
      id: 'round-sup',
      family: 'folklore',
      rule: 'Przebicie od góry poziomu 1000·k w świecy 1h (poprzednie zamknięcie powyżej, minimum ≤ poziom); start na zamknięciu. Sukces: wzrost do L + 1%·L przed spadkiem do L − 1%·L; limit 72 h.',
      params: { step: 1000, offset: 0, dPct: 0.01, maxBars: 72 },
    },
    {
      id: 'pdh-sweep',
      family: 'folklore',
      rule: 'Pierwsze w dniu UTC dotknięcie maksimum poprzedniego dnia (PDH) wśród świec po rozstrzygnięciu poprzedniego zdarzenia tej reguły. Sukces: środek zakresu poprzedniego dnia przed PDH + (PDH − środek); limit 36 h.',
      params: { maxBars: 36 },
    },
    {
      id: 'pdl-sweep',
      family: 'folklore',
      rule: 'Pierwsze w dniu UTC dotknięcie minimum poprzedniego dnia (PDL) wśród świec po rozstrzygnięciu poprzedniego zdarzenia tej reguły. Sukces: środek zakresu poprzedniego dnia przed PDL − (środek − PDL); limit 36 h.',
      params: { maxBars: 36 },
    },
    {
      id: 'ib-break',
      family: 'folklore',
      rule: 'IB = świeca 00:00–01:00 UTC. Pierwsze wyjście poza IB w tym dniu (świeca wychodząca w obie strony — dzień pominięty). Sukces: krawędź IB ± zakres IB w stronę wybicia przed przeciwną krawędzią IB; limit 24 h.',
      params: { maxBars: 24 },
    },
    {
      id: 'vwap-revert',
      family: 'folklore',
      rule: 'VWAP sesji UTC z ceny typowej świec 1h ważonej wolumenem, σ ważone. Zamknięcie od 4. godziny poza VWAP ± 2σ. Sukces: dotknięcie VWAP przed VWAP ± 4σ (zamrożone przy starcie); limit 24 h.',
      params: { maxBars: 24 },
    },
    {
      id: 'cme-gap',
      family: 'folklore',
      rule: 'Czasy nominalne CME bez kalendarza świąt: poziom luki = zamknięcie świecy HL kończącej się w piątek 16:00 (Chicago), start = zamknięcie świecy HL kończącej się w niedzielę 17:00; luka ≥ 0,3%. Sukces: dotknięcie poziomu luki przed lustrem po drugiej stronie (p0 = 0,5); limit — piątkowe zamknięcie CME.',
      params: { minGap: 0.003 },
    },
    {
      id: 'funding-flush',
      family: 'folklore',
      rule: 'Stawka finansowania powyżej 95. percentyla z 30 dni i dodatnia (albo poniżej 5. i ujemna); start na zamknięciu świecy kończącej się w chwili stawki. Sukces: ruch o 1% przeciw tłumowi przed ruchem o 1% z tłumem (p0 = 0,5); limit 48 h.',
      params: { pct: 0.05, windowDays: 30, dPct: 0.01, maxBars: 48 },
    },
    {
      id: 'ny-10am',
      family: 'folklore',
      rule: 'Dni od poniedziałku do piątku (bez kalendarza świąt w USA). Sukces: zwrot godziny zaczynającej się o 10:00 czasu Nowego Jorku w dolnej połowie (ranga ≤ 12) 24 zwrotów godzinowych dnia UTC (p0 = 0,5 z symetrii znaku).',
      params: {},
    },
    {
      id: 'intraday-mom',
      family: 'folklore',
      rule: 'Dzień UTC. Sukces: znak zwrotu 23:00–24:00 = znak zwrotu 00:00–01:00 (p0 = 0,5 z symetrii znaku; dni z zerowym zwrotem pominięte).',
      params: {},
    },
    {
      id: 'ctrl-weekend',
      family: 'control',
      rule: 'Tydzień pon–nd UTC, świece 1d. Sukces: log-zakres soboty + niedzieli < środy + czwartku (p0 = 0,5 z wymienialności dni).',
      params: {},
    },
    {
      id: 'ctrl-placebo',
      family: 'control',
      rule: 'Jak opór i wsparcie razem, ale poziomy 1000·k + 437 (dowolne, nieokrągłe).',
      params: { step: 1000, offset: 437, dPct: 0.01, maxBars: 72 },
    },
  ],
};

/** Teksty prezentacyjne (poza hashowanym katalogiem). */
export const LAB_TEXT: Record<string, { name: string; claim: string; source?: string }> = {
  'round-res': { name: 'Okrągły poziom = opór', claim: 'Pełne tysiące dolarów zatrzymują wzrosty.', source: 'Osler (2000), Federal Reserve Bank of New York Economic Policy Review' },
  'round-sup': { name: 'Okrągły poziom = wsparcie', claim: 'Pełne tysiące dolarów zatrzymują spadki.', source: 'Osler (2000)' },
  'pdh-sweep': { name: 'Zebranie PDH → powrót', claim: 'Po zebraniu płynności nad wczorajszym maksimum cena wraca do środka zakresu.' },
  'pdl-sweep': { name: 'Zebranie PDL → powrót', claim: 'Po zebraniu płynności pod wczorajszym minimum cena wraca do środka zakresu.' },
  'ib-break': { name: 'Wybicie IB jedzie dalej', claim: 'Wyjście poza Initial Balance rozszerza zakres w stronę wybicia.' },
  'vwap-revert': { name: 'Z 2σ od VWAP cena wraca', claim: 'Po odejściu o 2σ od VWAP sesji cena wraca do VWAP.' },
  'cme-gap': { name: 'Luka CME przyciąga cenę', claim: 'Weekendowe luki na kontraktach CME się zamykają.' },
  'funding-flush': { name: 'Skrajne finansowanie → flush', claim: 'Przepełniona strona (skrajne finansowanie) zostaje wyczyszczona.' },
  'ny-10am': { name: 'Dump o 10:00 w Nowym Jorku', claim: 'BTC spada w pierwszej godzinie po otwarciu rynku akcji w USA.' },
  'intraday-mom': { name: 'Momentum śróddzienne', claim: 'Kierunek pierwszej godziny dnia powtarza się w ostatniej.', source: 'Gao, Han, Li, Zhou (2018), Market intraday momentum, Journal of Financial Economics' },
  'ctrl-weekend': { name: 'Kontrola +: weekend spokojniejszy', claim: 'Kontrola pozytywna — znany efekt, który metoda musi wykryć.' },
  'ctrl-placebo': { name: 'Kontrola −: placebo', claim: 'Kontrola negatywna — poziomy bez znaczenia; efekt nie powinien wyjść.' },
};

export interface LabData {
  hourly: readonly LabBar[];
  daily: readonly LabBar[];
  funding: readonly { t: number; rate: number }[];
}

const P = (id: string) => LAB_CATALOG.hypotheses.find((h) => h.id === id)!.params;

/** Zdarzenia wszystkich reguł katalogu. */
export function runCatalog(d: LabData): Record<string, GenResult> {
  const lvl = (id: string, dir: 'res' | 'sup' | 'both') => {
    const p = P(id);
    return levelEvents(d.hourly, { step: p.step, offset: p.offset, dir, dPct: p.dPct, maxBars: p.maxBars });
  };
  const f = P('funding-flush');
  return {
    'round-res': lvl('round-res', 'res'),
    'round-sup': lvl('round-sup', 'sup'),
    'pdh-sweep': prevDayEvents(d.hourly, 'pdh', P('pdh-sweep').maxBars),
    'pdl-sweep': prevDayEvents(d.hourly, 'pdl', P('pdl-sweep').maxBars),
    'ib-break': ibBreakEvents(d.hourly, P('ib-break').maxBars),
    'vwap-revert': vwapEvents(d.hourly, P('vwap-revert').maxBars),
    'cme-gap': cmeGapEvents(d.hourly, P('cme-gap').minGap),
    'funding-flush': fundingEvents(d.hourly, d.funding, { pct: f.pct, windowDays: f.windowDays, dPct: f.dPct, maxBars: f.maxBars }),
    'ny-10am': nyTenAmEvents(d.hourly),
    'intraday-mom': intradayMomEvents(d.hourly),
    'ctrl-weekend': weekendEvents(d.daily),
    'ctrl-placebo': lvl('ctrl-placebo', 'both'),
  };
}

export interface LabStats {
  n: number;
  /** Średni wynik (odsetek sukcesów; ułamki z limitu czasu wliczone) */
  rate: number | null;
  /** Średnie p0 — oczekiwany odsetek pod hipotezą zerową */
  p0: number | null;
  /** rate − p0 */
  effect: number | null;
  /** Przedział 90% efektu (z wariancji próby) */
  lo: number | null;
  hi: number | null;
}

export type HistVerdict = 'support' | 'against' | 'none' | 'few';
export type FwdVerdict = 'confirmed' | 'against' | 'excluded' | 'collecting';

export interface HistResult extends LabStats {
  /** p-wartość dwustronna (wariancja pod H0: Σ p0(1 − p0) — górne ograniczenie dla wyników w [0, 1]) */
  p: number | null;
  /** q-wartość BH w rodzinie reguł folkloru (kontrole: null) */
  q: number | null;
  verdict: HistVerdict;
  dropped: Dropped;
  from: number | null;
  to: number | null;
}

export interface FwdResult extends LabStats {
  /** e-wartość za tezą folkloru (efekt > 0) */
  e: number;
  /** e-wartość przeciw tezie (efekt < 0) */
  eAgainst: number;
  cs: { lo: number; hi: number } | null;
  verdict: FwdVerdict;
  /** Trajektoria e-wartości [czas rozstrzygnięcia, e] (najwyżej 200 punktów) */
  path: [number, number][];
  /** Wszystkie zdarzenia do przodu [t0, t1, x, p0] — do niezależnego przeliczenia */
  events: [number, number, number, number][];
}

export interface LabHypResult {
  id: string;
  family: 'folklore' | 'control';
  hist: HistResult;
  fwd: FwdResult;
}

export interface LabReport {
  v: 1;
  coin: string;
  asOf: number;
  version: string;
  /** SHA-256 kanonicznego JSON katalogu (rekord prerejestracji w dzienniku) */
  catalogHash: string;
  /** Czas rekordu prerejestracji w dzienniku; null = katalog jeszcze niezarejestrowany */
  registeredAt: number | null;
  /** Hash linii rekordu prerejestracji w łańcuchu dziennika */
  registrationHash: string | null;
  /** Ocena do przodu obejmuje zdarzenia z t0 > forwardFrom (rejestracja + karencja); null = brak rejestracji */
  forwardFrom: number | null;
  data: { hourlyFrom: number | null; hourlyTo: number | null; hours: number; dailyFrom: number | null; days: number; fundingFrom: number | null };
  hypotheses: LabHypResult[];
}

const Z90 = 1.6448536269514722;
const E_CAP = 1e12;

/** Statystyka efektu na zdarzeniach (p-wartość z wariancją pod H0, przedział z wariancji próby). */
export function histStats(events: readonly LabEvent[]): LabStats & { p: number | null } {
  const n = events.length;
  if (n === 0) return { n, rate: null, p0: null, effect: null, lo: null, hi: null, p: null };
  let sx = 0;
  let sp = 0;
  let v0 = 0;
  for (const e of events) {
    sx += e.x;
    sp += e.p0;
    v0 += e.p0 * (1 - e.p0);
  }
  const effect = (sx - sp) / n;
  let ss = 0;
  for (const e of events) ss += (e.x - e.p0 - effect) ** 2;
  const se = n > 1 ? Math.sqrt(ss / (n - 1) / n) : Number.NaN;
  const z = v0 > 0 ? (sx - sp) / Math.sqrt(v0) : 0;
  return {
    n,
    rate: sx / n,
    p0: sp / n,
    effect,
    lo: Number.isFinite(se) ? effect - Z90 * se : null,
    hi: Number.isFinite(se) ? effect + Z90 * se : null,
    p: 2 * (1 - normCdf(Math.abs(z))),
  };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  return Array.from({ length: max }, (_, k) => xs[Math.round((k * (xs.length - 1)) / (max - 1))]);
}

export interface LabMeta {
  coin: string;
  asOf: number;
  registeredAt: number | null;
  registrationHash?: string | null;
  catalogHash: string;
}

/** Raport z wyników generatorów: historia (BH w rodzinie folkloru) + do przodu (e-BH, sekwencje ufności). */
export function summarize(gen: Record<string, GenResult>, m: LabMeta, d: LabData): LabReport {
  const hyps = LAB_CATALOG.hypotheses;
  const hist = hyps.map((h) => histStats(gen[h.id].events));
  const folk = hyps.map((h, i) => (h.family === 'folklore' ? i : -1)).filter((i) => i >= 0);
  const qFolk = bhQValues(folk.map((i) => hist[i].p ?? 1));
  const q = hyps.map((_, i) => (folk.includes(i) ? qFolk[folk.indexOf(i)] : null));

  const forwardFrom = m.registeredAt === null ? null : m.registeredAt + LAB_RULES.forwardGraceH * 3_600_000;
  const fwdEv = hyps.map((h) => (forwardFrom === null ? [] : gen[h.id].events.filter((e) => e.t0 > forwardFrom)));
  const ePath = fwdEv.map((ev) => bettingEProcess(ev));
  // Przeciw tezie: lustrzane zdarzenia (1 − x, 1 − p0) — proces zakładów na efekt < 0
  const eNeg = fwdEv.map((ev) => bettingEProcess(ev.map((e) => ({ x: 1 - e.x, p0: 1 - e.p0 }))).at(-1) ?? 1);
  const ePos = ePath.map((p) => p.at(-1) ?? 1);
  const a = LAB_RULES.alphaFamily;
  const rejPos = eBH(folk.map((i) => ePos[i]), a);
  const rejNeg = eBH(folk.map((i) => eNeg[i]), a);

  const out: LabHypResult[] = hyps.map((h, i) => {
    const hs = hist[i];
    const sig = h.family === 'folklore' ? q[i] : hs.p;
    let hv: HistVerdict = 'none';
    if (hs.n < LAB_RULES.minHist) hv = 'few';
    else if (sig !== null && sig <= LAB_RULES.fdrQ && hs.effect !== null) hv = hs.effect > 0 ? 'support' : 'against';
    const ev = fwdEv[i];
    const fs = histStats(ev);
    const cs = effectCS(ev, LAB_RULES.csAlpha);
    const k = folk.indexOf(i);
    const pos = k >= 0 ? rejPos[k] : ePos[i] >= 1 / a;
    const neg = k >= 0 ? rejNeg[k] : eNeg[i] >= 1 / a;
    let fv: FwdVerdict = 'collecting';
    if (pos) fv = 'confirmed';
    else if (neg) fv = 'against';
    else if (cs && cs.lo > -LAB_RULES.csExclude && cs.hi < LAB_RULES.csExclude) fv = 'excluded';
    const evs = gen[h.id].events;
    return {
      id: h.id,
      family: h.family,
      hist: {
        n: hs.n,
        rate: hs.rate,
        p0: hs.p0,
        effect: hs.effect,
        lo: hs.lo,
        hi: hs.hi,
        p: hs.p,
        q: q[i],
        verdict: hv,
        dropped: gen[h.id].dropped,
        from: evs.length ? evs[0].t0 : null,
        to: evs.length ? evs[evs.length - 1].t1 : null,
      },
      fwd: {
        n: fs.n,
        rate: fs.rate,
        p0: fs.p0,
        effect: fs.effect,
        lo: fs.lo,
        hi: fs.hi,
        e: Math.min(ePos[i], E_CAP),
        eAgainst: Math.min(eNeg[i], E_CAP),
        cs,
        verdict: fv,
        path: downsample(
          ev.map((e, j): [number, number] => [e.t1, Math.min(ePath[i][j], E_CAP)]),
          200
        ),
        events: ev.map((e): [number, number, number, number] => [e.t0, e.t1, r6(e.x), r6(e.p0)]),
      },
    };
  });
  return {
    v: 1,
    coin: m.coin,
    asOf: m.asOf,
    version: LAB_VERSION,
    catalogHash: m.catalogHash,
    registeredAt: m.registeredAt,
    registrationHash: m.registrationHash ?? null,
    forwardFrom,
    data: {
      hourlyFrom: d.hourly[0]?.t ?? null,
      hourlyTo: d.hourly.at(-1)?.t ?? null,
      hours: d.hourly.length,
      dailyFrom: d.daily[0]?.t ?? null,
      days: d.daily.length,
      fundingFrom: d.funding[0]?.t ?? null,
    },
    hypotheses: out,
  };
}

/** Pełna ocena: generatory katalogu + raport. */
export function evaluateLab(d: LabData, m: LabMeta): LabReport {
  return summarize(runCatalog(d), m, d);
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v: unknown) => v === null || fin(v);
const HIST_V = new Set<HistVerdict>(['support', 'against', 'none', 'few']);
const FWD_V = new Set<FwdVerdict>(['confirmed', 'against', 'excluded', 'collecting']);

function isStats(s: Partial<LabStats> | null | undefined): boolean {
  return !!s && fin(s.n) && finOrNull(s.rate) && finOrNull(s.p0) && finOrNull(s.effect) && finOrNull(s.lo) && finOrNull(s.hi);
}

/** Walidacja publikowanego raportu (strona nie ufa plikowi z sieci). */
export function isLabReport(x: unknown): x is LabReport {
  const r = x as Partial<LabReport> | null;
  if (!r || r.v !== 1 || typeof r.coin !== 'string' || !fin(r.asOf) || typeof r.version !== 'string') return false;
  if (typeof r.catalogHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.catalogHash) || !finOrNull(r.registeredAt) || !finOrNull(r.forwardFrom)) return false;
  if (r.registrationHash !== null && !(typeof r.registrationHash === 'string' && /^[0-9a-f]{64}$/.test(r.registrationHash))) return false;
  const d = r.data;
  if (!d || !finOrNull(d.hourlyFrom) || !finOrNull(d.hourlyTo) || !fin(d.hours) || !finOrNull(d.dailyFrom) || !fin(d.days) || !finOrNull(d.fundingFrom)) return false;
  if (!Array.isArray(r.hypotheses)) return false;
  return r.hypotheses.every((h) => {
    if (!h || typeof h.id !== 'string' || (h.family !== 'folklore' && h.family !== 'control')) return false;
    const hs = h.hist;
    if (!isStats(hs) || !finOrNull(hs.p) || !finOrNull(hs.q) || !HIST_V.has(hs.verdict) || !finOrNull(hs.from) || !finOrNull(hs.to)) return false;
    const dr = hs.dropped;
    if (!dr || !fin(dr.ambiguous) || !fin(dr.narrow) || !fin(dr.timeout) || !fin(dr.gap)) return false;
    const fs = h.fwd;
    if (!isStats(fs) || !fin(fs.e) || !fin(fs.eAgainst) || !FWD_V.has(fs.verdict)) return false;
    if (fs.cs !== null && !(fs.cs && fin(fs.cs.lo) && fin(fs.cs.hi))) return false;
    if (!Array.isArray(fs.path) || !fs.path.every((p) => Array.isArray(p) && p.length === 2 && p.every(fin))) return false;
    return Array.isArray(fs.events) && fs.events.every((e) => Array.isArray(e) && e.length === 4 && e.every(fin));
  });
}

/** Liczby zaokrąglone do 10 cyfr znaczących (stabilność wektora kontrolnego między maszynami). */
function roundDeep(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toPrecision(10)) : String(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
}

/**
 * Wejście wektora kontrolnego: martyngał log-ceny (60 kroków w godzinie, 120 dni od poniedziałku 5.01.2026), świece
 * dzienne z godzinowych, finansowanie z rzadkimi skokami — tak, by każda reguła miała zdarzenia.
 */
export function labGoldenData(): LabData {
  const rnd = mulberry32(20261022);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const t0 = Date.UTC(2026, 0, 5);
  const H = 3_600_000;
  const hourly: LabBar[] = [];
  let lp = Math.log(80000);
  for (let i = 0; i < 24 * 120; i++) {
    const o = Math.exp(lp);
    let h = o;
    let l = o;
    for (let k = 0; k < 60; k++) {
      lp += (0.005 / Math.sqrt(60)) * gauss() - (0.5 * 0.000025) / 60;
      h = Math.max(h, Math.exp(lp));
      l = Math.min(l, Math.exp(lp));
    }
    hourly.push({ t: t0 + i * H, o, h, l, c: Math.exp(lp), v: 1 + rnd() });
  }
  const daily: LabBar[] = [];
  for (let i = 0; i + 24 <= hourly.length; i += 24) {
    const d = hourly.slice(i, i + 24);
    daily.push({ t: d[0].t, o: d[0].o, h: Math.max(...d.map((b) => b.h)), l: Math.min(...d.map((b) => b.l)), c: d[23].c, v: 24 });
  }
  const funding = hourly.map((b) => ({ t: b.t + H, rate: 0.00001 * gauss() + (rnd() < 0.02 ? 0.0003 * (rnd() < 0.5 ? 1 : -1) : 0) }));
  return { hourly, daily, funding };
}

/** Wynik całego silnika na danych kontrolnych (rejestracja w 60. dniu) — wejście wektora kontrolnego katalogu. */
export function labGoldenOutput(): unknown {
  const d = labGoldenData();
  const rep = evaluateLab(d, { coin: 'GOLDEN', asOf: 0, registeredAt: d.hourly[24 * 60].t, catalogHash: '0'.repeat(64) });
  return roundDeep({ data: rep.data, hypotheses: rep.hypotheses });
}
