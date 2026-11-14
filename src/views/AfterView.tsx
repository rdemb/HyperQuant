import React from 'react';
import { tr } from '../i18n';
import { LocalBoundary, SectionHeading } from '../ui';
import { useDeskLedger } from '../state/useDeskLedger';
import type { PhaseId } from '../charts/pro/chart/stations';
import ChartsView from './ChartsView';
import { DeskLedgerPanel } from './after/DeskLedgerPanel';
import { JournalTab } from './after/JournalTab';
import { SessionReview } from './after/SessionReview';

/**
 * Ekran „Po sesji”: wykres z układem przeglądu (`review`), pod nim Rozliczenie sesji (`#rozliczenie`: ostatnia zamknięta
 * sesja Londynu i NY oraz sesja w toku), niżej „Dziennik prognoz” (weryfikowalny dziennik Desku) i „Dziennik transakcji”
 * (zagrania zapisane przez użytkownika).
 */
const AfterView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => (
  <div className="flex flex-col gap-4">
    <ChartsView phase="after" onPhase={onPhase} />
    {/* Zły ładunek z zewnątrz (taśma likwidacji, kohorty, dziennik, blog) wygasza tylko Rozliczenie */}
    <LocalBoundary what={tr('Rozliczenie sesji', 'Session review')}>
      <SessionReview />
    </LocalBoundary>
    <LedgerSection />
    <section aria-labelledby="po-dziennik-transakcji" className="flex flex-col gap-2">
      <SectionHeading id="po-dziennik-transakcji" nr="03" eyebrow={tr('Twoje transakcje', 'Your trades')} title={tr('Dziennik transakcji', 'Trade journal')} />
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
      <SectionHeading id="po-dziennik-prognoz" nr="02" eyebrow={tr('Prognozy przed faktem', 'Forecasts before the fact')} title={tr('Dziennik prognoz', 'Forecast ledger')} />
      <DeskLedgerPanel />
    </section>
  );
};

export default AfterView;
