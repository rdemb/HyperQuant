import { LiqMap, isLiqMap } from '../utils/liqMap';
import { LiqFreshness, liqMapFreshness } from '../utils/liqMapView';
import { usePublished } from './usePublished';

export interface LiqMapState {
  /**
   * unconfigured = brak adresu danych w buildzie; ready = LIVE; delayed = połowa nominału z odczytów > 15 min;
   * stale = publikacja lub kontekst rynku > 10 min (liczby ukryte); expired = publikacja > 60 min (mapy nie ma)
   */
  status: 'unconfigured' | 'loading' | 'error' | LiqFreshness;
  map: LiqMap | null;
}

/** Mapa likwidacji z pozycji on-chain (skaner HyperQuant) — odświeżana co minutę, wspólna dla widoków. */
export function useLiqMap(): LiqMapState {
  const { configured, value, failed } = usePublished('liq-map/BTC.json', isLiqMap);
  if (!configured) return { status: 'unconfigured', map: null };
  if (!value) return { status: failed ? 'error' : 'loading', map: null };
  return { status: liqMapFreshness(value, Date.now()), map: value };
}
