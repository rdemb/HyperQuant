import React from 'react';
import { tr } from '../i18n';
import { useDeskLedger } from '../state/useDeskLedger';
import type { PhaseId } from '../charts/pro/chart/stations';
import ChartsView from './ChartsView';
import { DeskLedgerPanel } from './after/DeskLedgerPanel';
import { JournalTab } from './after/JournalTab';

/**
 * Ekran „Po sesji”: wykres z układem przeglądu (`review`), niżej „Dziennik prognoz” (weryfikowalny dziennik Desku)
 * i „Dziennik transakcji” (zagrania zapisane przez użytkownika). Miejsce na Rozliczenie doby (etap 1b) to
 * `<section id="rozliczenie">`, którego w 1a jeszcze nie renderujemy.
 */
const AfterView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => (
  <div className="flex flex-col gap-4">
    <ChartsView phase="after" onPhase={onPhase} />
    <LedgerSection />
    <section aria-labelledby="po-dziennik-transakcji" className="flex flex-col gap-2">
      <h2 id="po-dziennik-transakcji" className="text-sm font-semibold text-ink-1">
        {tr('Dziennik transakcji', 'Trade journal')}
      </h2>
      <JournalTab />
    </section>
  </div>
);

/** Dziennik prognoz; bez adresu danych w buildzie (lokalny build, fork) panel się nie rysuje, więc nie zostaje sam nagłówek. */
const LedgerSection: React.FC = () => {
  const { status } = useDeskLedger();
  if (status === 'unconfigured') return null;
  return (
    <section aria-labelledby="po-dziennik-prognoz" className="flex flex-col gap-2">
      <h2 id="po-dziennik-prognoz" className="text-sm font-semibold text-ink-1">
        {tr('Dziennik prognoz', 'Forecast ledger')}
      </h2>
      <DeskLedgerPanel />
    </section>
  );
};

export default AfterView;
