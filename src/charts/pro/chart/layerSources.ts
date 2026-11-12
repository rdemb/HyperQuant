import type { BadgeTone } from '../../../ui/Badge';
import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { Coverage } from '../core/coverage';
import { indicatorScope } from '../core/indicators';
import { fmtDayTime, fmtHm, fromDaily } from '../core/time';
import { tpoInterval } from '../core/tpo';
import { type HqIndicatorId, indicatorDef } from '../indicators/registry';
import type { ChartSettings } from './settings';
import { LAYERS_OFF } from './templates';
import { tr } from '../../../i18n';
import { SCANNER_FRESH_MS, type ScanState, liqScan, scannerAge, whalesScan } from '../../../utils/scanState';
import { WAIT_TEXT } from '../../../utils/sessionText';
import { BLOG_ONLY_WHY, BTC_ONLY_BADGE, NO_FORECASTS_BADGE, NO_SCANNER_BADGE, OUTCOMES_ONLY_WHY } from '../../../utils/marketCaps';
import { capsOf, noScannerWhyOf } from '../../../state/markets';

/**
 * Plakietki danych przy warstwach legendy (spec §7.4): skąd pochodzi warstwa — LIVE (dane Hyperliquid i skanera),
 * MODEL (wynik modelu na tych danych) albo SIM (symulacja, np. wejścia metody na historii). Warstwy ze skanera zamiast
 * LIVE pokazują wiek migawki, gdy jest starsza niż 2 min; warstwa, której rynek nie ma (zdolności rynku z rejestru) —
 * „—, bez skanera” (mapa likwidacji), „—, bez prognoz” (stożek) albo „—, tylko BTC” (mapy z bloga, rynki HIP-4).
 */

export type LayerSource = 'LIVE' | 'MODEL' | 'SIM';

/** Każdy przełącznik `show*` ustawień wykresu (warstwy ceny, panele pod nim, taśma, Stan rynku). */
type ShowKey = Extract<keyof ChartSettings, `show${string}`>;
/** Klucz plakietki: brak wpisu dla nowej warstwy albo nowego wskaźnika front/second to błąd kompilacji. */
export type SourceKey = ShowKey | HqIndicatorId;

const SOURCES = {
  // Warstwy na wykresie ceny
  showVwap: 'LIVE',
  showVwapBands: 'LIVE',
  showSessionVwap: 'LIVE',
  showProfile: 'LIVE',
  showPeriodProfiles: 'LIVE',
  showDevPoc: 'LIVE',
  showTpo: 'LIVE',
  // Zmiana OI minuty rozdzielona na ceny według wolumenu — przybliżenie, nie odczyt
  showTpoOi: 'MODEL',
  showLevels: 'LIVE',
  // Tekst opublikowanego wpisu (poziomy autora), nie wynik modelu
  showBlogMap: 'LIVE',
  showSessions: 'LIVE',
  showIb: 'LIVE',
  showLiq: 'LIVE',
  showWhales: 'LIVE',
  showZones: 'LIVE',
  showAuctions: 'LIVE',
  showHeatmap: 'LIVE',
  showBubbles: 'LIVE',
  showClashes: 'LIVE',
  showLots: 'LIVE',
  // Panele pod wykresem
  showVolume: 'LIVE',
  showDelta: 'LIVE',
  showCvd: 'LIVE',
  showVenueCvd: 'LIVE',
  showVenueOi: 'LIVE',
  showStats: 'LIVE',
  // Taśma obok wykresu i Stan rynku (zdanie ze stałych reguł na tych samych danych)
  showTape: 'LIVE',
  showState: 'LIVE',
  // Wskaźniki „Tylko w HyperQuant”
  oiflow: 'LIVE',
  // Ruch ceny wobec zwykłego przy takiej delcie (regresja z ostatnich świec)
  absorption: 'MODEL',
  breadth: 'LIVE',
  repeat: 'LIVE',
  makers: 'LIVE',
  twap: 'LIVE',
  slippage: 'LIVE',
  rvol: 'MODEL',
  ofi: 'LIVE',
  ordersize: 'LIVE',
  // „Więcej z HyperQuant”
  cone: 'MODEL',
  outcomes: 'MODEL',
  regime: 'MODEL',
  hawkes: 'MODEL',
  // Wejścia metody Nilla i ich wynik na historii
  pbrange: 'SIM',
  // Strefy i pudełka z reguł modelu na świecach i delcie taśmy (opis rynku, nie sygnały)
  effort: 'MODEL',
} as const satisfies Record<SourceKey, LayerSource>;

/** Źródło każdej warstwy `show*` (na wykresie ceny i panele pod nim) i każdego wskaźnika z warstw menu front i second. */
export const LAYER_SOURCE: Readonly<Record<string, LayerSource>> = SOURCES;

/** Klucze z wynikiem modelu albo symulacji: każdy ma metodę w podpowiedzi plakietki (brak to błąd kompilacji). */
type ModelKey = { [K in keyof typeof SOURCES]: (typeof SOURCES)[K] extends 'LIVE' ? never : K }[keyof typeof SOURCES];

/** Podpowiedź plakietki MODEL i SIM: „MODEL · metoda: …”. */
const METHOD_HINT: Record<ModelKey, string> = {
  showTpoOi: tr(
    'MODEL · podział OI według wolumenu: zmiana otwartych pozycji minuty rozłożona na ceny według jej wolumenu, nie odczyt OI na cenie',
    "MODEL · OI split by volume: a minute's open-interest change spread across prices by its volume, not an OI reading at the price"
  ),
  absorption: tr(
    'MODEL · Theil–Sen: zwykły ruch ceny przy takiej delcie z prostej Theila–Sena na poprzednich świecach, odchylenie w jednostkach MAD',
    'MODEL · Theil–Sen: the usual price move for such a delta from a Theil–Sen line over previous candles, the deviation in MAD units'
  ),
  rvol: tr('MODEL · mediana 20 dni: wolumen wobec mediany tej samej godziny UTC z 20 dni', 'MODEL · 20-day median: volume against the median of the same UTC hour over 20 days'),
  cone: tr(
    'MODEL · HAR: przedziały z modelu zmienności log-HAR z FHS, prognozy z dziennika desku (Po sesji)',
    'MODEL · HAR: intervals from the log-HAR volatility model with FHS, forecasts from the desk ledger (Post-session)'
  ),
  outcomes: tr(
    'MODEL · HAR: prawdopodobieństwo z modelu zmienności desku (log-HAR z FHS) obok ceny udziału na rynku HIP-4',
    'MODEL · HAR: the probability from the desk volatility model (log-HAR with FHS) next to the share price on the HIP-4 market'
  ),
  regime: tr('MODEL · BOCPD: bayesowskie wykrywanie punktów zmiany na zwrotach świec', 'MODEL · BOCPD: Bayesian change-point detection on candle returns'),
  hawkes: tr('MODEL · Hawkes: proces z jądrem wykładniczym dopasowany metodą największej wiarygodności', 'MODEL · Hawkes: a process with an exponential kernel fitted by maximum likelihood'),
  pbrange: tr(
    'SIM · metoda Nilla: strefy P/b i miejsca, w których metoda by weszła (👀), z wynikiem na historii; to nie transakcje',
    "SIM · Nill's method: P/b zones and places where the method would enter (👀), with their result on history; not trades"
  ),
  effort: tr(
    'MODEL · reguły modelu intraday Valentiniego: strefy absorpcji i dyskonta swingu oraz pudełka Effort z delty taśmy (bez taśmy przybliżonej ze świecy); to nie sygnały',
    "MODEL · Valentini's intraday model rules: absorption and swing discount zones and effort boxes from the tape delta (approximated from the candle without the tape); not signals"
  ),
};

/** Tekst brakującej, jeszcze wczytywanej liczby (nagłówek, legenda, Rozliczenie) — wspólny z utils/sessionText. */
export { WAIT_TEXT };
// Wiek i stan migawek skanera bez modułów wykresu (utils/scanState; też serwer MCP) — dawne miejsce eksportu
export { SCANNER_FRESH_MS, type ScanState, liqScan, scannerAge, whalesScan };

/**
 * Stan mapy z bloga (`useBlogMaps` i mapa wybrana przez `pickMap`): chwila wpisu albo powód, czemu poziomów nie ma —
 * ten sam w legendzie i w ustawieniach wykresu.
 */
export function blogMapScan(st: BlogMapsState, picked: Pick<BlogMap, 'publishedAt'> | null): ScanState {
  if (st.status === 'loading') return { why: WAIT_TEXT };
  if (st.status === 'missing') return { why: tr('Brak map z bloga', 'No maps from the blog') };
  if (!picked)
    return {
      why: tr(
        'Brak Mapy dnia z bieżącej doby UTC — inną mapę z bloga (ostatnie 3 dni) wybierzesz w Ustawieniach wykresu',
        'No Day map from the current UTC day yet — pick another blog map (last 3 days) in Chart settings'
      ),
    };
  return { asOf: picked.publishedAt };
}

/** Warstwy z migawek skanera (plik z `asOf`): po 2 min wiek zamiast LIVE. */
const SCANNER = new Set(['showLiq', 'showWhales']);
/** Plakietka „—” warstwy, której danych rynek nie ma (`marketCaps`); null — rynek ma te dane. */
function missingOn(key: string, coin: string): LayerBadge | null {
  const caps = capsOf(coin);
  if (key === 'showLiq' && !caps.scanner) return { tone: 'neutral', text: NO_SCANNER_BADGE, hint: noScannerWhyOf(coin) };
  if (key === 'cone' && !caps.forecasts) return { tone: 'neutral', text: NO_FORECASTS_BADGE, hint: noScannerWhyOf(coin) };
  if (key === 'showBlogMap' && !caps.blog) return { tone: 'neutral', text: BTC_ONLY_BADGE, hint: BLOG_ONLY_WHY };
  if (key === 'outcomes' && !caps.outcomes) return { tone: 'neutral', text: BTC_ONLY_BADGE, hint: OUTCOMES_ONLY_WHY };
  return null;
}

/** Pokrycie taśmą przedziału [from, to): ułamek 0–1 (pokryty czas / długość); pusty przedział — NaN. */
export function tapeCoveragePct(cov: Pick<Coverage, 'coveredMs'>, from: number, to: number): number {
  if (!(to > from)) return Number.NaN;
  return cov.coveredMs(from, to) / (to - from);
}

const TONE: Record<LayerSource, BadgeTone> = { LIVE: 'live', MODEL: 'model', SIM: 'sim' };
const SOURCE_HINT: Record<LayerSource, string> = {
  LIVE: tr('LIVE: dane Hyperliquid (świece, taśma, arkusz) albo skanera, bez modelu', 'LIVE: Hyperliquid data (candles, tape, book) or scanner data, no model'),
  MODEL: tr('MODEL: wynik modelu na tych danych, nie odczyt', 'MODEL: the output of a model on this data, not a reading'),
  SIM: tr('SIM: symulacja na historii (np. wejścia metody), nie transakcje', 'SIM: a simulation on history (e.g. method entries), not trades'),
};

export interface LayerBadge {
  tone: BadgeTone;
  text: string;
  hint: string;
}

/**
 * Plakietka warstwy albo wskaźnika `key` na rynku `coin`; `scan` — migawka skanera albo powód jej braku (warstwy skanera).
 * MODEL i SIM z nazwą metody w podpowiedzi.
 */
export function layerBadge(key: string, ctx: { coin: string; now: number; scan?: ScanState }): LayerBadge {
  const missing = missingOn(key, ctx.coin);
  if (missing) return missing;
  const src = LAYER_SOURCE[key] ?? 'LIVE';
  if (SCANNER.has(key)) {
    const scan = ctx.scan ?? { why: WAIT_TEXT };
    if ('why' in scan) return { tone: 'stale', text: '—', hint: scan.why };
    const age = scannerAge(scan.asOf, ctx.now);
    if (age) return { tone: 'stale', text: age, hint: tr(`Migawka skanera sprzed ${age} (stan z ${fmtHm(scan.asOf)})`, `Scanner snapshot from ${age} ago (as of ${fmtHm(scan.asOf)})`) };
    return { tone: 'live', text: 'LIVE', hint: tr(`LIVE: migawka skanera z ${fmtHm(scan.asOf)}`, `LIVE: scanner snapshot as of ${fmtHm(scan.asOf)}`) };
  }
  if (key === 'showBlogMap') {
    const scan = ctx.scan ?? { why: WAIT_TEXT };
    if ('why' in scan) return { tone: 'stale', text: '—', hint: scan.why };
    const when = fmtDayTime(scan.asOf, ctx.now);
    return {
      tone: 'live',
      text: 'LIVE',
      hint: tr(
        `LIVE: mapa autora z bloga HyperQuant opublikowana ${when} — poziomy z tekstu wpisu, nie model HyperQuant`,
        `LIVE: the author's map from the HyperQuant blog published ${when} — levels from the post text, not a HyperQuant model`
      ),
    };
  }
  const method = (METHOD_HINT as Readonly<Record<string, string>>)[key];
  return { tone: TONE[src], text: src, hint: method ?? SOURCE_HINT[src] };
}

/** Krótkie nazwy warstw w legendzie. */
const LAYER_LABEL: Record<keyof typeof LAYERS_OFF, string> = {
  showVwap: 'VWAP',
  showVwapBands: tr('Pasma VWAP', 'VWAP bands'),
  showSessionVwap: tr('VWAP sesji', 'Session VWAP'),
  showProfile: tr('Profil', 'Profile'),
  showPeriodProfiles: tr('Profile okresów', 'Period profiles'),
  showDevPoc: tr('Rozw. POC', 'Dev. POC'),
  showTpo: 'TPO',
  showTpoOi: 'TPO OI',
  showLevels: tr('Poziomy dnia', 'Daily levels'),
  showBlogMap: tr('Mapa z bloga', 'Blog map'),
  showSessions: tr('Sesje', 'Sessions'),
  showIb: 'IB',
  showLiq: tr('Klastry likw.', 'Liq. clusters'),
  showWhales: tr('Wieloryby', 'Whales'),
  showZones: tr('Strefy', 'Zones'),
  showAuctions: tr('Niedok. aukcje', 'Unfinished auctions'),
  showHeatmap: tr('Mapa ciepła', 'Heatmap'),
  showBubbles: tr('Bąble', 'Bubbles'),
  showClashes: tr('Serie i ściany', 'Bursts & walls'),
  showLots: tr('Duże zlecenia', 'Large orders'),
};

/** Nazwa warstwy wykresu ceny w liście „Warstwy”. */
export const layerLabel = (key: keyof typeof LAYERS_OFF): string => LAYER_LABEL[key];

/** Czy włączona warstwa jest rysowana na tym interwale (te same warunki co opisy „off” w oknie wskaźników). */
function drawn(s: Pick<ChartSettings, 'showTpo' | 'showBubbles' | 'stackedMin'>, key: keyof typeof LAYERS_OFF, ms: number): boolean {
  const scope = indicatorScope(ms);
  switch (key) {
    case 'showVwap':
    case 'showVwapBands':
      return !fromDaily(ms);
    case 'showSessionVwap':
      return scope.sessionVwap;
    case 'showPeriodProfiles':
    case 'showDevPoc':
      return scope.periodProfile !== null;
    case 'showTpo':
      return tpoInterval(ms);
    case 'showTpoOi':
      return tpoInterval(ms) && s.showTpo;
    case 'showLevels':
    case 'showBlogMap':
      return scope.levels;
    case 'showSessions':
      return scope.sessions;
    case 'showIb':
      return scope.ib;
    case 'showClashes':
      return s.showBubbles;
    case 'showZones':
      return s.stackedMin > 1;
    default:
      return true;
  }
}

export interface LayerChip extends LayerBadge {
  key: string;
  label: string;
}

/**
 * Plakietki legendy: włączone warstwy wykresu ceny rysowane na interwale `intervalMs` (w kolejności warstw) i widoczne
 * wskaźniki z warstw menu front i second (każdy typ raz). `scan` — migawki skanera (albo powody braku) warstw skanera.
 */
export function legendChips(
  s: Pick<ChartSettings, keyof typeof LAYERS_OFF | 'indicators' | 'stackedMin'>,
  x: { coin: string; now: number; intervalMs: number; scan: Partial<Record<string, ScanState>> }
): LayerChip[] {
  const out: LayerChip[] = [];
  for (const key of Object.keys(LAYERS_OFF) as (keyof typeof LAYERS_OFF)[]) {
    if (s[key] !== true || !drawn(s, key, x.intervalMs)) continue;
    out.push({ key, label: LAYER_LABEL[key], ...layerBadge(key, { coin: x.coin, now: x.now, scan: x.scan[key] }) });
  }
  const seen = new Set<string>();
  for (const ind of s.indicators) {
    const def = indicatorDef(ind.id);
    if (!ind.visible || (def.tier !== 'front' && def.tier !== 'second') || seen.has(ind.id)) continue;
    seen.add(ind.id);
    out.push({ key: ind.id, label: def.short, ...layerBadge(ind.id, { coin: x.coin, now: x.now }) });
  }
  return out;
}

/**
 * Plakietki do pokazania w danej postaci legendy: pełna — wszystkie; telefon — najpierw nie-LIVE (MODEL, SIM, wiek migawki,
 * „—, bez skanera”, „—, tylko BTC”), potem LIVE; zwinięta — tylko nie-LIVE (to, co odbiega od danych na żywo, widać zawsze).
 */
export function chipsFor(chips: readonly LayerChip[], mode: 'full' | 'compact' | 'folded'): LayerChip[] {
  const other = chips.filter((c) => c.tone !== 'live');
  if (mode === 'folded') return other;
  return mode === 'compact' ? [...other, ...chips.filter((c) => c.tone === 'live')] : [...chips];
}
