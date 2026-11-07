import React from 'react';
import type { PhaseId } from '../charts/pro/chart/stations';
import ChartsView from './ChartsView';
import { AuctionContextPanel } from './before/AuctionContextPanel';
import { LiquidityByHourPanel } from './before/LiquidityByHourPanel';
import { DeskRail } from './desk/DeskRail';
import { LiquidationMapPanel } from './desk/LiquidationMapPanel';
import { FundingVenues } from './market/FundingVenues';
import { MacroCalendar } from './market/MacroCalendar';
import { MacroTiles } from './market/MacroTiles';
import { NewsFeed } from './market/NewsFeed';

/**
 * Ekran „Przed sesją”: wykres z układami przygotowania (1–2), pod nim pas kontekstu (DeskRail z funduszowaniem i
 * najbliższym wydarzeniem), kalendarz makro, funding między giełdami, kontekst aukcji, mapa likwidacji z kaskadą,
 * płynność wg godzin, kafle makro i wiadomości. Na telefonie jedna kolumna w tej samej kolejności.
 */
const BeforeView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => (
  <div className="flex flex-col gap-4">
    <ChartsView phase="before" onPhase={onPhase} />
    <DeskRail />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*]:min-w-0">
      <MacroCalendar />
      <FundingVenues />
      <AuctionContextPanel />
      <LiquidationMapPanel />
      <LiquidityByHourPanel />
      <MacroTiles />
      <NewsFeed />
    </div>
  </div>
);
export default BeforeView;
