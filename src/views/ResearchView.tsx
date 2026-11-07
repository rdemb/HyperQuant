import React from 'react';
import { useDesk } from '../state/DeskContext';
import { AggrOrderFlowTape } from '../components/AggrOrderFlowTape';
import { LiquidityMicrostructureLab, MicrostructureMethods } from '../components/LiquidityMicrostructureLab';
import { PositionSizer, QuantMetricTiles, QuantRegimePanel } from '../components/QuantSignalDesk';
import { BookMechanicsPanel } from './micro/BookMechanicsPanel';
import { MacroProxies } from './market/MacroProxies';
import { MarketMap } from './market/MarketMap';
import { ModelVsMarketPanel } from './market/ModelVsMarketPanel';

/**
 * Ekran „Badania”: narzędzia do analizy poza tokiem dnia. Model kontra rynek predykcyjny, proxy makro i mapa rynku;
 * mechanika arkusza, laboratorium mikrostruktury z reżimem i metrykami, metody oraz kalkulator wielkości pozycji;
 * taśma przepływu zleceń. Na telefonie jedna kolumna w tej samej kolejności.
 */
const ResearchView: React.FC = () => {
  const { feed, ofi, shaakuni, quant } = useDesk();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-7 min-w-0 flex flex-col gap-4">
        <ModelVsMarketPanel />
        <MacroProxies />
        <MarketMap />
      </div>
      <div className="lg:col-span-5 min-w-0 flex flex-col gap-4">
        <PositionSizer atr14={shaakuni.atr14} currentPrice={feed.currentPrice} />
        {feed.latestBar && (
          <div className="h-[540px] min-w-0">
            <AggrOrderFlowTape trades={feed.trades} latestBar={feed.latestBar} ofiSummary={ofi} currentPrice={feed.currentPrice} />
          </div>
        )}
      </div>
      <div className="lg:col-span-12 min-w-0">
        <BookMechanicsPanel />
      </div>
      <div className="lg:col-span-8 min-w-0">
        <LiquidityMicrostructureLab quant={quant} shaakuni={shaakuni} currentPrice={feed.currentPrice} />
      </div>
      <div className="lg:col-span-4 min-w-0 flex flex-col gap-4">
        <QuantRegimePanel quant={quant} currentPrice={feed.currentPrice} timeframeSec={feed.timeframeSec} />
        <QuantMetricTiles quant={quant} className="grid-cols-2 md:grid-cols-3 lg:grid-cols-2" />
      </div>
      <div className="lg:col-span-12 min-w-0">
        <MicrostructureMethods quant={quant} shaakuni={shaakuni} currentPrice={feed.currentPrice} />
      </div>
    </div>
  );
};
export default ResearchView;
