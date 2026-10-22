import { LiqTape, isLiqTape, liqTapeFreshness } from '../utils/liqTape';
import { usePublished } from './usePublished';

export interface LiqTapeState {
  /** unconfigured = brak adresu danych w buildzie; ready = LIVE; stale = publikacja > 10 min (liczby ukryte); expired > 60 min */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale' | 'expired';
  tape: LiqTape | null;
}

/** Taśma likwidacji śledzonych pozycji (skaner HyperQuant) — odświeżana co minutę. */
export function useLiqTape(): LiqTapeState {
  const { configured, value, failed } = usePublished('liq-tape/BTC.json', isLiqTape);
  if (!configured) return { status: 'unconfigured', tape: null };
  if (!value) return { status: failed ? 'error' : 'loading', tape: null };
  return { status: liqTapeFreshness(value, Date.now()), tape: value };
}
