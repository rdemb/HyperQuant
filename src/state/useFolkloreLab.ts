import { isLabReport, type LabReport } from '../utils/folkloreLab';
import { usePublished } from './usePublished';

export interface FolkloreLabState {
  /** unconfigured = brak adresu danych w buildzie; stale = raport starszy niż 3 h (przeliczany co godzinę) */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale';
  report: LabReport | null;
}

const STALE_MS = 3 * 60 * 60_000;

/** Laboratorium folkloru (skaner HyperQuant): wyniki historyczne i prerejestrowane do przodu. */
export function useFolkloreLab(): FolkloreLabState {
  const { configured, value, failed } = usePublished('lab/BTC.json', isLabReport);
  if (!configured) return { status: 'unconfigured', report: null };
  if (!value) return { status: failed ? 'error' : 'loading', report: null };
  return { status: Date.now() - value.asOf > STALE_MS ? 'stale' : 'ready', report: value };
}
