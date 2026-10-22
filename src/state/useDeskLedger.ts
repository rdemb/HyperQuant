import { DeskLedgerSummary, isDeskLedgerSummary, ledgerFreshness } from '../utils/deskLedger';
import { LEDGER_BASE, usePublished } from './usePublished';

export interface DeskLedgerState {
  /** unconfigured = brak adresu danych w buildzie; ready = aktualne; stale = > 35 min bez publikacji; expired > 3 h */
  status: 'unconfigured' | 'loading' | 'error' | 'ready' | 'stale' | 'expired';
  summary: DeskLedgerSummary | null;
}

/** Podsumowanie weryfikowalnego dziennika prognoz (gałąź `ledger` repo danych). */
export function useDeskLedger(): DeskLedgerState {
  const { configured, value, failed } = usePublished('BTC/summary.json', isDeskLedgerSummary, LEDGER_BASE);
  if (!configured) return { status: 'unconfigured', summary: null };
  if (!value) return { status: failed ? 'error' : 'loading', summary: null };
  return { status: ledgerFreshness(value, Date.now()), summary: value };
}
