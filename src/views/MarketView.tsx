import React from 'react';
import { FundingVenues } from './market/FundingVenues';
import { MacroProxies } from './market/MacroProxies';
import { MarketMap } from './market/MarketMap';
import { MacroCalendar } from './market/MacroCalendar';
import { NewsFeed } from './market/NewsFeed';
import { MacroTiles } from './market/MacroTiles';
import { ModelVsMarketPanel } from './market/ModelVsMarketPanel';

/** Widok „Rynek”: model vs rynek predykcyjny (HIP-4), funding między giełdami, proxy makro z HIP-3, mapa HL, kalendarz, wiadomości. */
const MarketView: React.FC = () => (
  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
    <div className="xl:col-span-7 flex flex-col gap-4 min-w-0">
      <ModelVsMarketPanel />
      <FundingVenues />
      <MacroProxies />
      <MarketMap />
    </div>
    <div className="xl:col-span-5 flex flex-col gap-4 min-w-0">
      <MacroCalendar />
      <MacroTiles />
      <NewsFeed />
    </div>
  </div>
);
export default MarketView;
