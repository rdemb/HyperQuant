import type { BadgeTone } from '../../../ui/Badge';
import type { Coverage } from '../core/coverage';
import { indicatorScope } from '../core/indicators';
import { fmtHm, fromDaily } from '../core/time';
import { tpoInterval } from '../core/tpo';
import { indicatorDef } from '../indicators/registry';
import type { ChartSettings } from './settings';
import { LAYERS_OFF } from './templates';
import { tr } from '../../../i18n';

/**
 * Plakietki danych przy warstwach legendy (spec §7.4): skąd pochodzi warstwa — LIVE (dane Hyperliquid i skanera),
 * MODEL (wynik modelu na tych danych) albo SIM (symulacja, np. wejścia metody na historii). Warstwy ze skanera zamiast
 * LIVE pokazują wiek migawki, gdy jest starsza niż 2 min; warstwy tylko z BTC na innym rynku — „—, tylko BTC”.
 */

export type LayerSource = 'LIVE' | 'MODEL' | 'SIM';

/** Źródło każdej warstwy `show*` (na wykresie ceny i panele pod nim) i każdego wskaźnika z warstw menu front i second. */
export const LAYER_SOURCE: Readonly<Record<string, LayerSource>> = {
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
};

/** Warstwy z migawek skanera (plik z `asOf`): po 2 min wiek zamiast LIVE. */
const SCANNER = new Set(['showLiq', 'showWhales']);
/** Dane tylko dla BTC: mapa likwidacji skanera, dziennik prognoz Desku (stożek), rynki HIP-4 na BTC. */
const BTC_ONLY = new Set(['showLiq', 'cone', 'outcomes']);
/** Migawka skanera świeża do tylu ms. */
export const SCANNER_FRESH_MS = 2 * 60_000;

/** Wiek migawki skanera („2 min”, „1 h”, „2 d”), gdy przekracza 2 min; świeża albo brak migawki — null. */
export function scannerAge(asOf: number | null, now: number): string | null {
  if (asOf === null || !Number.isFinite(asOf) || !Number.isFinite(now)) return null;
  const age = now - asOf;
  if (!(age > SCANNER_FRESH_MS)) return null;
  const min = Math.floor(age / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
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

/** Plakietka warstwy albo wskaźnika `key` na rynku `coin`; `asOf` — chwila migawki skanera (warstwy skanera). */
export function layerBadge(key: string, ctx: { coin: string; now: number; asOf?: number | null }): LayerBadge {
  if (BTC_ONLY.has(key) && ctx.coin !== 'BTC') {
    return { tone: 'neutral', text: tr('—, tylko BTC', '—, BTC only'), hint: tr('Te dane są tylko dla BTC (skaner i dziennik prognoz liczą BTC)', 'This data exists for BTC only (the scanner and the forecast ledger cover BTC)') };
  }
  const src = LAYER_SOURCE[key] ?? 'LIVE';
  if (SCANNER.has(key)) {
    const asOf = ctx.asOf ?? null;
    if (asOf === null) return { tone: 'stale', text: '—', hint: tr('Skaner nie publikuje teraz aktualnej migawki tej warstwy', 'The scanner is not publishing a current snapshot of this layer right now') };
    const age = scannerAge(asOf, ctx.now);
    if (age) return { tone: 'stale', text: age, hint: tr(`Migawka skanera sprzed ${age} (stan z ${fmtHm(asOf)})`, `Scanner snapshot from ${age} ago (as of ${fmtHm(asOf)})`) };
    return { tone: 'live', text: 'LIVE', hint: tr(`LIVE: migawka skanera z ${fmtHm(asOf)}`, `LIVE: scanner snapshot as of ${fmtHm(asOf)}`) };
  }
  return { tone: TONE[src], text: src, hint: SOURCE_HINT[src] };
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
 * wskaźniki z warstw menu front i second (każdy typ raz). `asOf` — chwile migawek skanera warstw skanera.
 */
export function legendChips(
  s: Pick<ChartSettings, keyof typeof LAYERS_OFF | 'indicators' | 'stackedMin'>,
  x: { coin: string; now: number; intervalMs: number; asOf: Partial<Record<string, number | null>> }
): LayerChip[] {
  const out: LayerChip[] = [];
  for (const key of Object.keys(LAYERS_OFF) as (keyof typeof LAYERS_OFF)[]) {
    if (s[key] !== true || !drawn(s, key, x.intervalMs)) continue;
    out.push({ key, label: LAYER_LABEL[key], ...layerBadge(key, { coin: x.coin, now: x.now, asOf: x.asOf[key] }) });
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
