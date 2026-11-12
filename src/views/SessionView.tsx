import React, { useState, useSyncExternalStore } from 'react';
import { subscribeNarrow } from '../charts/pro/ProChart';
import { isNarrow } from '../charts/pro/chart/settings';
import type { PhaseId } from '../charts/pro/chart/stations';
import { COIN, type Market } from '../charts/pro/store/proStore';
import { parseReplayLink } from '../charts/pro/replay/link';
import { subscribeHash } from '../state/route';
import { useLiqMap } from '../state/useLiqMap';
import ChartsView from './ChartsView';
import { CohortFlowPanel } from './desk/CohortFlowPanel';
import { LiquidationTape } from './desk/LiquidationTape';
import { FirstContact } from './session/FirstContact';

/** Link powtórki w adresie (#charts?replay=…): wykres pokazuje przeszłość. */
const inReplay = () => parseReplayLink(window.location.hash) !== null;

/**
 * Ekran „W sesji”: wykres z układami sesji (Kokpit domyślnie, od 1280 px z prawą kolumną DOM i taśmy, od 640 px
 * z tą kolumną jako szufladą nad wykresem), pod nim przepływ kohort i zrealizowane likwidacje BTC (na każdej
 * szerokości; na wykresie rynku bez skanera „—, bez skanera”). Na telefonie pięć liczb przepływu (Pulse) jest w karcie
 * „Liczby” paska wykresu, nie nad wykresem (karty Wykres, Taśma, DOM, Liczby są w pasku wykresu).
 * Nad wykresem pierwszy kontakt (dymki i przycisk powtórki 15 min, FirstContact).
 * W powtórce (link #charts?replay=…) sama powtórka: panele na żywo nie mieszają się z przeszłością.
 * `onPhase` — karta układu innej fazy (Alt+1…6, nowa karta) przenosi do ekranu tej fazy.
 */
const SessionView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const replay = useSyncExternalStore(subscribeHash, inReplay);
  // Rynek pierwszego wykresu aktywnej karty (Pulse liczy drabinę i taśmę tego rynku)
  const [coin, setCoin] = useState<Market>(COIN);
  return (
    <div className="flex flex-col gap-4">
      {!replay && <FirstContact coin={coin} />}
      <ChartsView phase="session" onPhase={onPhase} onMarket={setCoin} />
      {!replay && (
        <>
          <CohortFlowPanel coin={coin} />
          <SessionLiquidations coin={coin} />
        </>
      )}
    </div>
  );
};

/** Taśma zrealizowanych likwidacji BTC jako osobna karta, z pokryciem open interest z mapy likwidacji. */
const SessionLiquidations: React.FC<{ coin: Market }> = ({ coin }) => {
  const { status, map } = useLiqMap();
  return (
    <LiquidationTape
      coin={coin}
      coverage={map && (status === 'ready' || status === 'delayed') ? map.coverage.share : null}
      frame="rounded-xl border border-line bg-surface-1 p-4"
    />
  );
};

export default SessionView;
