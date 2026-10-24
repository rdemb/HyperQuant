import React from 'react';
import { CexSettings } from './sources/CexSettings';
import { LineageTable } from './sources/LineageTable';
import { Attributions } from './sources/Attributions';
import { AggrTemplateCard } from './sources/AggrTemplateCard';
import { tr } from '../i18n';

/**
 * Widok „Źródła”: ustawienia (opt-in CEX, dźwięk), rodowód każdej liczby, atrybucje i licencje, szablon Aggr.
 * Na telefonie najpierw ustawienia; na desktopie tabela rodowodu po lewej, reszta w kolumnie bocznej.
 */
const SourcesView: React.FC = () => (
  <div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="lg:col-span-4 lg:order-2 flex flex-col gap-4 min-w-0">
        <CexSettings />
        <Attributions />
        <AggrTemplateCard />
      </div>
      <div className="lg:col-span-8 lg:order-1 min-w-0">
        <LineageTable />
      </div>
    </div>
    <p className="text-xs text-ink-3 leading-relaxed max-w-prose">
      {tr(
        'HyperQuant to narzędzie edukacyjne. Nie jest poradą inwestycyjną, finansową ani prawną i nie generuje sygnałów transakcyjnych — ocenia plan, który przygotowujesz sam. Handel instrumentami z dźwignią wiąże się z wysokim ryzykiem utraty kapitału.',
        'HyperQuant is an educational tool. It is not investment, financial or legal advice and does not generate trading signals; it evaluates the plan you prepare yourself. Trading leveraged instruments carries a high risk of losing capital.'
      )}
    </p>
  </div>
);
export default SourcesView;
