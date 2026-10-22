import { CohortFlow, cohortFreshness, isCohortFlow } from '../utils/cohorts';
import { usePublished } from './usePublished';

export interface CohortFlowState {
  /** unconfigured = brak adresu danych w buildzie; ready = LIVE; stale = publikacja > 10 min (liczby ukryte); expired > 60 min */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale' | 'expired';
  flow: CohortFlow | null;
}

/** Przepływ kohort (skaner HyperQuant) — odświeżany co minutę. */
export function useCohortFlow(): CohortFlowState {
  const { configured, value, failed } = usePublished('cohorts/BTC.json', isCohortFlow);
  if (!configured) return { status: 'unconfigured', flow: null };
  if (!value) return { status: failed ? 'error' : 'loading', flow: null };
  return { status: cohortFreshness(value, Date.now()), flow: value };
}
