import React, { useState } from 'react';
import type { PhaseId } from '../charts/pro/chart/stations';
import { COIN, type Market } from '../charts/pro/store/proStore';
import { ConnectingState } from '../shell/ConnectingState';
import { useDesk } from '../state/DeskContext';
import ChartsView from './ChartsView';
import { AuctionContextPanel } from './before/AuctionContextPanel';
import { FourCard } from './before/FourCard';
import { LiquidityByHourPanel } from './before/LiquidityByHourPanel';
import { DeskRail } from './desk/DeskRail';
import { LiquidationMapPanel } from './desk/LiquidationMapPanel';
import { FundingVenues } from './market/FundingVenues';
import { MacroCalendar } from './market/MacroCalendar';
import { MacroTiles } from './market/MacroTiles';
import { NewsFeed } from './market/NewsFeed';

/**
 * Ekran „Przed sesją”: na górze Czwórka (cztery liczby przed sesją dla rynku wykresu), pod nią wykres z układami
 * przygotowania (1–2), pas kontekstu (DeskRail z funduszowaniem i najbliższym wydarzeniem), kalendarz makro, funding
 * między giełdami, kontekst aukcji, mapa likwidacji z kaskadą, płynność wg godzin, kafle makro i wiadomości. Na telefonie
 * jedna kolumna w tej samej kolejności.
 */
const BeforeView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => {
  // Rynek pierwszego wykresu aktywnej karty (Czwórka liczy jego świece)
  const [coin, setCoin] = useState<Market>(COIN);
  return (
    <div className="flex flex-col gap-4">
      <FourCard coin={coin} />
      <ChartsView phase="before" onPhase={onPhase} onMarket={setCoin} />
      <ContextRail />
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
};

/**
 * Pas kontekstu dopiero po pierwszych świecach desku: wcześniej jego metryki (OU, VPIN, głębokość) liczyłyby się z pustych
 * danych, więc w jego miejscu krótki stan „łączenie” z ponowieniem (wykres i panele obok mają własne dane).
 */
const ContextRail: React.FC = () => {
  const { feed } = useDesk();
  const [startedAt] = useState(() => Date.now());
  if (feed.bars.length > 0) return <DeskRail />;
  return <ConnectingState compact onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />;
};

export default BeforeView;
