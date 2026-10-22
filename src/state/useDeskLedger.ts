import { DeskLedgerSummary, isDeskLedgerSummary, ledgerFreshness } from '../utils/deskLedger';
import { usePublished } from './usePublished';

export interface DeskLedgerState {
  /** unconfigured = brak adresu danych w buildzie; ready = aktualne; stale = > 35 min bez publikacji; expired > 3 h */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale' | 'expired';
  summary: DeskLedgerSummary | null;
}

/** Podsumowanie weryfikowalnego dziennika (publikowane na gałęzi `main`; pliki dziennika — na gałęzi `ledger`). */
export function useDeskLedger(): DeskLedgerState {
  const { configured, value, failed } = usePublished('ledger/BTC/summary.json', isDeskLedgerSummary);
  if (!configured) return { status: 'unconfigured', summary: null };
  if (!value) return { status: failed ? 'error' : 'loading', summary: null };
  return { status: ledgerFreshness(value, Date.now()), summary: value };
}
