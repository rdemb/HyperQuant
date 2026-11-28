import { LiqMap, isLiqMap } from '../utils/liqMap';
import { LiqFreshness, liqMapFreshness } from '../utils/liqMapView';
import { HOME_MARKET } from '../utils/marketCaps';
import { usePublished } from './usePublished';

export interface LiqMapState {
  /**
   * unconfigured = brak adresu danych w buildzie; ready = LIVE; delayed = połowa nominału z odczytów > 15 min;
   * stale = publikacja lub kontekst rynku > 10 min (liczby ukryte); expired = publikacja > 60 min (mapy nie ma)
   */
  status: 'unconfigured' | 'loading' | 'error' | LiqFreshness;
  map: LiqMap | null;
}

/**
 * Mapa likwidacji rynku `coin` z pozycji on-chain (skaner HyperQuant) — odświeżana co minutę, wspólna dla widoków. Desk
 * opisuje rynek skanera (domyślnie); wykres prosi o swój rynek, a czy mapa jest dla niego, mówi zdolność `liqMap`.
 * Po zmianie rynku mapa poprzedniego nie jest zwracana (do wczytania nowej stan `loading`).
 */
export function useLiqMap(coin: string = HOME_MARKET): LiqMapState {
  const { configured, value, failed } = usePublished(`liq-map/${coin}.json`, isLiqMap);
  if (!configured) return { status: 'unconfigured', map: null };
  if (!value || value.coin !== coin) return { status: failed ? 'error' : 'loading', map: null };
  return { status: liqMapFreshness(value, Date.now()), map: value };
}
