import React, { useCallback, useState } from 'react';
import { useDesk, usePrefillFromSignal } from '../state/DeskContext';
import { ShaakuniAggrChart2D } from '../components/ShaakuniAggrChart2D';
import { AggrOrderFlowTape } from '../components/AggrOrderFlowTape';
import { OrderFlowChart } from '../charts/orderflow/OrderFlowChart';
import { Segmented } from '../ui';
import { DeskRail } from './desk/DeskRail';
import { LiquidationMapPanel } from './desk/LiquidationMapPanel';
import { PlanQuickCard } from './plan/PlanQuickCard';

const TF_LABEL: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h' };

type Hero = 'flow' | 'candles';
const HERO_KEY = 'hq.deskHero';
const HERO_OPTIONS: { value: Hero; label: string; title: string }[] = [
  { value: 'flow', label: 'Order flow', title: 'Heatmapa arkusza L2, bąble transakcji, footprint i profil wolumenu (realne dane HL od otwarcia strony)' },
  { value: 'candles', label: 'Świece + Shaakuni', title: 'Świece, poziomy i strefy Shaakuni, CVD i delta perp' },
];

function readHero(): Hero {
  try {
    return window.localStorage.getItem(HERO_KEY) === 'candles' ? 'candles' : 'flow';
  } catch {
    return 'flow';
  }
}

/** Główny ekran 2D: wykres (bohater) + taśma/arkusz, pas kontekstu i szybki analizator planu. */
const DeskView: React.FC = () => {
  const { feed, shaakuni, heatmap, quant, ofi, shaakuniConfig, setShaakuniConfig } = useDesk();
  const onExhaustion = usePrefillFromSignal('OFI Tape');
  const [hero, setHeroState] = useState<Hero>(readHero);
  const setHero = useCallback((h: Hero) => {
    setHeroState(h);
    try {
      window.localStorage.setItem(HERO_KEY, h);
    } catch {
      // Brak dostępu do storage — wybór tylko na tę sesję
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-9 h-[560px] sm:h-[620px] lg:h-[700px] min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 overflow-x-auto [scrollbar-width:none]">
            <Segmented<Hero> ariaLabel="Wykres główny" value={hero} onChange={setHero} options={HERO_OPTIONS} />
            <span className="hidden sm:inline text-[11px] text-ink-3 whitespace-nowrap">BTC-PERP · Hyperliquid · {TF_LABEL[feed.timeframeSec] ?? '5m'}</span>
          </div>
          <div className="flex-1 min-h-0">
            {hero === 'flow' ? (
              <OrderFlowChart />
            ) : (
              <ShaakuniAggrChart2D
                bars={feed.bars}
                shaakuni={shaakuni}
                config={shaakuniConfig}
                onChangeConfig={setShaakuniConfig}
                heatmap={heatmap}
                quant={quant}
                timeframeLabel={TF_LABEL[feed.timeframeSec] ?? '5m'}
              />
            )}
          </div>
        </div>
        <div className="lg:col-span-3 h-[540px] lg:h-[700px] min-w-0">
          {feed.latestBar && (
            <AggrOrderFlowTape
              trades={feed.trades}
              latestBar={feed.latestBar}
              ofiSummary={ofi}
              currentPrice={feed.currentPrice}
              onTriggerExhaustionSignal={onExhaustion}
            />
          )}
        </div>
      </div>
      <DeskRail />
      <LiquidationMapPanel />
      <PlanQuickCard />
    </div>
  );
};
export default DeskView;
