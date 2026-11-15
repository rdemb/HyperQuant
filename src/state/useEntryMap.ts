import { type EntryMap, isEntryMap } from '../utils/entryMap';
import { usePublished } from './usePublished';

export interface EntryMapState {
  /** unconfigured = brak adresu danych; ready; delayed = połowa wartości z odczytów > 15 min; stale > 10 min; expired > 60 min */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'delayed' | 'stale' | 'expired';
  map: EntryMap | null;
}

export function entryMapFreshness(m: EntryMap, now: number): 'ready' | 'delayed' | 'stale' | 'expired' {
  const min = 60_000;
  if (now - m.asOf > 60 * min) return 'expired';
  if (now - m.asOf > 10 * min) return 'stale';
  if (m.ageMin.ntlP50 > 15) return 'delayed';
  return 'ready';
}

/** Mapa uwięzionych pozycji (skaner HyperQuant, `entry-map/BTC.json`) — odświeżana jak mapa likwidacji. */
export function useEntryMap(): EntryMapState {
  const { configured, value, failed } = usePublished('entry-map/BTC.json', isEntryMap);
  if (!configured) return { status: 'unconfigured', map: null };
  if (!value) return { status: failed ? 'error' : 'loading', map: null };
  return { status: entryMapFreshness(value, Date.now()), map: value };
}
