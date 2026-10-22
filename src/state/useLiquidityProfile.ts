import { isLiquidityProfile, type LiquidityProfile } from '../utils/liquidity';
import { usePublished } from './usePublished';

export interface LiquidityProfileState {
  /** unconfigured = brak adresu danych w buildzie; stale = publikacja starsza niż 30 min (profil co 10 min) */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale';
  profile: LiquidityProfile | null;
}

const STALE_MS = 30 * 60_000;

/** Profil płynności arkusza (rejestrator skanera HyperQuant) — odświeżany co minutę. */
export function useLiquidityProfile(): LiquidityProfileState {
  const { configured, value, failed } = usePublished('liquidity/BTC.json', isLiquidityProfile);
  if (!configured) return { status: 'unconfigured', profile: null };
  if (!value) return { status: failed ? 'error' : 'loading', profile: null };
  return { status: Date.now() - value.asOf > STALE_MS ? 'stale' : 'ready', profile: value };
}
