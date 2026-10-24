import { locale, tr } from '../i18n';
/** Zdarzenie makro z oficjalnych harmonogramów (Fed, BLS, BEA). */
export interface MacroEvent {
  id: string;
  kind: 'FOMC' | 'CPI' | 'NFP' | 'PPI' | 'GDP_PCE';
  name: string;
  /** Czas publikacji w UTC (ms) */
  timeUtcMs: number;
  importance: 'high' | 'medium';
  source: string;
  sourceUrl: string;
  /** Opcjonalny mnożnik wariancji dla pojedynczego zdarzenia (np. protokół FOMC zamiast decyzji) */
  volMultiplier?: number;
}

/** Krótkie etykiety rodzajów do kafli i list. */
export const KIND_LABEL: Record<MacroEvent['kind'], string> = {
  FOMC: 'FOMC',
  CPI: 'CPI',
  NFP: 'NFP',
  PPI: 'PPI',
  GDP_PCE: tr('PKB+PCE', 'GDP+PCE'),
};

// Druga niedziela marca / pierwsza niedziela listopada (reguła DST w USA od 2007 r.)
function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}

/**
 * Czas wschodni USA (America/New_York) → UTC ms. EDT = UTC−4 od 2. niedzieli marca 2:00
 * do 1. niedzieli listopada 2:00 czasu lokalnego, poza tym EST = UTC−5.
 * Publikacje są o 8:30 i 14:00, więc niejednoznaczna godzina 1:00–2:00 nie występuje.
 */
export function etToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const dstStart = nthSunday(year, 3, 2);
  const dstEnd = nthSunday(year, 11, 1);
  const key = month * 100 + day;
  const afterStart = key > 300 + dstStart || (key === 300 + dstStart && hour >= 2);
  const beforeEnd = key < 1100 + dstEnd || (key === 1100 + dstEnd && hour < 2);
  const offsetH = afterStart && beforeEnd ? 4 : 5;
  return Date.UTC(year, month - 1, day, hour + offsetH, minute);
}

const SRC = {
  FED: { source: tr('Federal Reserve — kalendarz FOMC', 'Federal Reserve — FOMC calendar'), sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
  CPI: { source: tr('BLS — harmonogram CPI', 'BLS — CPI schedule'), sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm' },
  NFP: { source: tr('BLS — harmonogram Employment Situation', 'BLS — Employment Situation schedule'), sourceUrl: 'https://www.bls.gov/schedule/news_release/empsit.htm' },
  PPI: { source: tr('BLS — harmonogram PPI', 'BLS — PPI schedule'), sourceUrl: 'https://www.bls.gov/schedule/news_release/ppi.htm' },
  BEA: { source: tr('BEA — harmonogram publikacji', 'BEA — release schedule'), sourceUrl: 'https://www.bea.gov/news/schedule' },
} as const;

type Ymd = [number, number, number];
const iso = ([y, m, d]: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function ev(
  kind: MacroEvent['kind'],
  ymd: Ymd,
  hm: [number, number],
  name: string,
  importance: MacroEvent['importance'],
  src: { source: string; sourceUrl: string },
  extra: Partial<MacroEvent> = {}
): MacroEvent {
  return {
    id: `${extra.id ?? kind}-${iso(ymd)}`,
    kind,
    name,
    timeUtcMs: etToUtcMs(ymd[0], ymd[1], ymd[2], hm[0], hm[1]),
    importance,
    ...src,
    ...(extra.volMultiplier !== undefined ? { volMultiplier: extra.volMultiplier } : {}),
  };
}

const FOMC_NAME = tr('FOMC — decyzja ws. stóp (konf. 14:30 ET)', 'FOMC — rate decision (press conf. 14:30 ET)');
const FOMC_SEP = tr('FOMC — decyzja ws. stóp + projekcje SEP (konf. 14:30 ET)', 'FOMC — rate decision + SEP projections (press conf. 14:30 ET)');
const FOMC_TENT = tr('FOMC — decyzja ws. stóp (termin wstępny)', 'FOMC — rate decision (tentative date)');

// Daty zweryfikowane z federalreserve.gov, bls.gov, bea.gov (stan 2026-10-21). Czas ET.
const FOMC_DATES: [Ymd, string][] = [
  [[2026, 10, 28], FOMC_NAME],
  [[2026, 12, 9], FOMC_SEP],
  [[2027, 1, 27], FOMC_NAME],
  [[2027, 3, 17], FOMC_SEP],
  [[2027, 4, 28], FOMC_NAME],
  [[2027, 6, 9], FOMC_SEP],
  [[2027, 7, 28], FOMC_TENT],
  [[2027, 9, 15], FOMC_TENT],
  [[2027, 10, 27], FOMC_TENT],
  [[2027, 12, 8], FOMC_TENT],
];
const NFP_DATES: Ymd[] = [[2026, 11, 6], [2026, 12, 4], [2027, 1, 8], [2027, 2, 5], [2027, 3, 5], [2027, 4, 2], [2027, 5, 7], [2027, 6, 4]];
const CPI_DATES: Ymd[] = [[2026, 11, 10], [2026, 12, 10], [2027, 1, 13], [2027, 2, 11], [2027, 3, 10], [2027, 4, 13], [2027, 5, 12], [2027, 6, 10]];
const PPI_DATES: Ymd[] = [[2026, 11, 13], [2026, 12, 15], [2027, 1, 14], [2027, 2, 12], [2027, 3, 12], [2027, 4, 14], [2027, 5, 13], [2027, 6, 11]];
const BEA_DATES: Ymd[] = [[2026, 10, 29], [2026, 11, 25], [2026, 12, 23], [2027, 1, 28], [2027, 2, 25], [2027, 3, 31], [2027, 4, 29], [2027, 5, 27], [2027, 6, 25]];

/** Pełna tabela zdarzeń posortowana po czasie (czyste dane, bez sieci). */
export const MACRO_EVENTS: MacroEvent[] = [
  ...FOMC_DATES.map(([d, name]) => ev('FOMC', d, [14, 0], name, 'high', SRC.FED)),
  // Protokół z posiedzenia grudniowego — mniejsza reakcja niż decyzja
  ev('FOMC', [2026, 12, 30], [14, 0], tr('FOMC — protokół (minutes) z posiedzenia grudniowego', 'FOMC — minutes of the December meeting'), 'medium', SRC.FED, {
    id: 'FOMC_MIN',
    volMultiplier: 1.1,
  }),
  ...NFP_DATES.map((d) => ev('NFP', d, [8, 30], tr('NFP — raport z rynku pracy (BLS)', 'NFP — jobs report (BLS)'), 'high', SRC.NFP)),
  ...CPI_DATES.map((d) => ev('CPI', d, [8, 30], tr('CPI — inflacja konsumencka (BLS)', 'CPI — consumer inflation (BLS)'), 'high', SRC.CPI)),
  ...PPI_DATES.map((d) => ev('PPI', d, [8, 30], tr('PPI — inflacja producencka (BLS)', 'PPI — producer inflation (BLS)'), 'medium', SRC.PPI)),
  ...BEA_DATES.map((d, i) =>
    ev('GDP_PCE', d, [8, 30], i === 0
        ? tr('PKB Q3 (szac. wstępny) + PCE za wrzesień — BEA', 'Q3 GDP (advance estimate) + September PCE — BEA')
        : tr('PKB + PCE (dochody i wydatki) — BEA', 'GDP + PCE (personal income and outlays) — BEA'), 'medium', SRC.BEA)
  ),
].sort((a, b) => a.timeUtcMs - b.timeUtcMs);

export function eventsBetween(fromMs: number, toMs: number): MacroEvent[] {
  return MACRO_EVENTS.filter((e) => e.timeUtcMs >= fromMs && e.timeUtcMs <= toMs);
}

export function nextEvent(nowMs: number): MacroEvent | null {
  return MACRO_EVENTS.find((e) => e.timeUtcMs > nowMs) ?? null;
}

/**
 * Łączy tabelę statyczną z datami z potoku (np. BEA release_dates.json). Zdarzenie z `extra`
 * jest pomijane, gdy w `base` istnieje ten sam rodzaj w tym samym dniu UTC (tabela ma pierwszeństwo).
 */
export function mergeEvents(base: MacroEvent[], extra: MacroEvent[]): MacroEvent[] {
  const day = (e: MacroEvent) => `${e.kind}|${new Date(e.timeUtcMs).toISOString().slice(0, 10)}`;
  const known = new Set(base.map(day));
  const added = extra.filter((e) => Number.isFinite(e.timeUtcMs) && !known.has(day(e)));
  return [...base, ...added].sort((a, b) => a.timeUtcMs - b.timeUtcMs);
}

// Priory mnożnika wariancji (opis i literatura przy eventVolMultiplier)
const VOL_MULTIPLIER: Record<MacroEvent['kind'], number> = {
  FOMC: 1.6,
  CPI: 1.5,
  NFP: 1.4,
  PPI: 1.15,
  GDP_PCE: 1.15,
};

/**
 * Mnożnik WARIANCJI okna (horyzontu planu) zawierającego publikację: σ²_okna ← σ²_okna · m,
 * czyli σ skaluje się o √m. To stałe PRIORY do kalibracji na danych desku, nie estymata.
 * Uzasadnienie rzędu wielkości:
 *  - Kroner (2025), FEDS 2025-022: niespodzianka CPI o 1σ ≈ −114 bp zwrotu BTC w latach 2021–23,
 *    czyli reakcja porównywalna z kilkugodzinną zmiennością tła;
 *  - Benigno & Rosa (2023), NY Fed Staff Report 1052: BTC słabo reaguje na większość danych makro,
 *    stąd niskie mnożniki dla PPI i PKB/PCE;
 *  - Corbet i in. (2020): zmienność BTC rośnie wokół ogłoszeń FOMC i danych z rynku pracy.
 * Kontrakt: zwraca ≥ 1. Przyjmuje rodzaj albo całe zdarzenie (wtedy honoruje `volMultiplier`).
 */
export function eventVolMultiplier(kindOrEvent: MacroEvent['kind'] | MacroEvent): number {
  const m =
    typeof kindOrEvent === 'string' ? VOL_MULTIPLIER[kindOrEvent] : kindOrEvent.volMultiplier ?? VOL_MULTIPLIER[kindOrEvent.kind];
  return Number.isFinite(m) ? Math.max(1, m) : 1;
}

/** Krótka nazwa źródła do etykiet: Fed / BLS / BEA. */
export function sourceShort(e: MacroEvent): string {
  return e.source.startsWith('Federal Reserve') ? 'Fed' : e.source.split(' — ')[0];
}

const LOCAL_FMT = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ET_FMT = new Intl.DateTimeFormat(locale, { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

/** Czas zdarzenia w strefie użytkownika, np. „śr., 28 paź, 19:00”. */
export const fmtEventLocal = (ms: number): string => LOCAL_FMT.format(ms);
/** Czas zdarzenia w czasie wschodnim USA, np. „14:00 ET”. */
export const fmtEventEt = (ms: number): string => `${ET_FMT.format(ms)} ET`;
