import React, { useState } from 'react';
import { useDesk, usePrefillFromSignal } from '../state/DeskContext';
import { AggrOrderFlowTape } from '../components/AggrOrderFlowTape';
import { ConnectingState } from '../shell/ConnectingState';
import { DeskRail } from './desk/DeskRail';
import { LiquidationMapPanel } from './desk/LiquidationMapPanel';
import { CohortFlowPanel } from './desk/CohortFlowPanel';
import { WelcomePanel } from './desk/WelcomePanel';
import { PlanQuickCard } from './plan/PlanQuickCard';

/**
 * Ekran główny: powitanie z mapą strony (bohater, widoczny od razu) i obok arkusz z taśmą; niżej pas kontekstu,
 * mapa likwidacji, przepływ kohort i szybki analizator planu, gdy przyjdą pierwsze dane.
 */
const DeskView: React.FC = () => {
  const { feed, ofi } = useDesk();
  const onExhaustion = usePrefillFromSignal('OFI Tape');
  const [startedAt] = useState(() => Date.now());
  const ready = feed.bars.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 xl:col-span-9 min-w-0 flex">
          <WelcomePanel />
        </div>
        {/* Na desktopie taśma ma wysokość powitania (absolutne wypełnienie komórki siatki), na telefonie stałą;
            przy 1024 px dostaje 4 kolumny, bo w 3 (ok. 230 px) wiersze arkusza łamały się na dwie linie */}
        {feed.latestBar && (
          <div className="lg:col-span-4 xl:col-span-3 h-[540px] lg:h-auto lg:min-h-[560px] min-w-0 lg:relative">
            <div className="h-full lg:absolute lg:inset-0">
              <AggrOrderFlowTape
                trades={feed.trades}
                latestBar={feed.latestBar}
                ofiSummary={ofi}
                currentPrice={feed.currentPrice}
                onTriggerExhaustionSignal={onExhaustion}
              />
            </div>
          </div>
        )}
      </div>
      {ready ? (
        <>
          <DeskRail />
          <LiquidationMapPanel />
          <CohortFlowPanel />
          <PlanQuickCard />
        </>
      ) : (
        <ConnectingState onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />
      )}
    </div>
  );
};
export default DeskView;
