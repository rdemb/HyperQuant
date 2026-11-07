/**
 * Stan migawek skanera (mapa likwidacji, warstwa wielorybów): wiek migawki starszej niż 2 min i powód, czemu liczb nie ma.
 * Wspólne dla legendy wykresu, nagłówka układu, Czwórki i serwera MCP; bez modułów wykresu (stare miejsce eksportu:
 * `charts/pro/chart/layerSources`).
 */
import { tr } from '../i18n';
import { WAIT_TEXT } from './sessionText';

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

/** Migawka skanera dla warstwy: chwila stanu albo powód braku — ten sam w nagłówku układu i w legendzie. */
export type ScanState = { asOf: number } | { why: string };

/** Stan mapy likwidacji (`useLiqMap`): chwila pokazanej mapy albo powód, czemu klastrów nie ma. */
export function liqScan(liq: { status: string; map: { asOf: number } | null }): ScanState {
  switch (liq.status) {
    case 'ready':
    case 'delayed':
      return liq.map ? { asOf: liq.map.asOf } : { why: WAIT_TEXT };
    case 'loading':
      return { why: WAIT_TEXT };
    case 'unconfigured':
      return { why: tr('Mapa likwidacji niedostępna w tej wersji strony', 'Liquidation map unavailable in this version of the site') };
    case 'error':
      return { why: tr('Nie udało się pobrać mapy likwidacji', 'Could not load the liquidation map') };
    default:
      return { why: tr('Skaner nie publikuje teraz aktualnej mapy — klastry ukryte', 'The scanner is not publishing a current map right now — clusters hidden') };
  }
}

/** Stan warstwy wielorybów dla rynku `coin`: chwila aktualnego pliku albo powód (bez adresu danych, nieaktualny plik, brak rynku). */
export function whalesScan(w: { asOf: number; markets: Readonly<Record<string, unknown>> } | null, coin: string, configured: boolean): ScanState {
  if (!configured) return { why: tr('Warstwa wielorybów niedostępna w tej wersji strony', 'Whale layer unavailable in this version of the site') };
  if (!w) return { why: tr('Skaner nie publikuje teraz warstwy wielorybów', 'The scanner is not publishing the whale layer right now') };
  if (!w.markets[coin]) return { why: tr(`Skaner nie publikuje wielorybów dla ${coin}`, `The scanner publishes no whales for ${coin}`) };
  return { asOf: w.asOf };
}
