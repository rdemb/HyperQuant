import React from 'react';
import { useDesk, usePrefillFromSignal } from '../state/DeskContext';
import { LiquidityMicrostructureLab, MicrostructureMethods } from '../components/LiquidityMicrostructureLab';
import { PositionSizer, QuantMetricTiles, QuantRegimePanel } from '../components/QuantSignalDesk';
import { BookMechanicsPanel } from './micro/BookMechanicsPanel';
import { LiquidityByHourPanel } from './micro/LiquidityByHourPanel';
import { tr } from '../i18n';

/** Mikrostruktura: mechanika arkusza (estymatory z literatury), profil płynności, kafle (reżim, metryki, metody, wielkość pozycji). */
const MicroView: React.FC = () => {
  const { feed, shaakuni, quant } = useDesk();
  const onPrefill = usePrefillFromSignal(tr('Mikrostruktura', 'Microstructure'));
  const onMethod = usePrefillFromSignal(tr('Mikrostruktura · Metody', 'Microstructure · Methods'));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-12 min-w-0 flex flex-col gap-4">
        <BookMechanicsPanel />
        <LiquidityByHourPanel />
      </div>
      <div className="lg:col-span-8 min-w-0">
        <LiquidityMicrostructureLab quant={quant} shaakuni={shaakuni} currentPrice={feed.currentPrice} />
      </div>
      <div className="lg:col-span-4 min-w-0 flex flex-col gap-4">
        <QuantRegimePanel quant={quant} currentPrice={feed.currentPrice} timeframeSec={feed.timeframeSec} onPrefillPlan={onPrefill} />
        <QuantMetricTiles quant={quant} className="grid-cols-2 md:grid-cols-3 lg:grid-cols-2" />
      </div>
      <div className="lg:col-span-8 min-w-0">
        <MicrostructureMethods quant={quant} shaakuni={shaakuni} currentPrice={feed.currentPrice} onPrefillPlan={onMethod} />
      </div>
      <div className="lg:col-span-4 min-w-0">
        <PositionSizer atr14={shaakuni.atr14} currentPrice={feed.currentPrice} />
      </div>
    </div>
  );
};
export default MicroView;
