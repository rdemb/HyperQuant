import React, { useState, useSyncExternalStore } from 'react';
import { subscribeNarrow } from '../charts/pro/ProChart';
import { isNarrow } from '../charts/pro/chart/settings';
import type { PhaseId } from '../charts/pro/chart/stations';
import { COIN, type Market } from '../charts/pro/store/proStore';
import { parseReplayLink } from '../charts/pro/replay/link';
import { useLiqMap } from '../state/useLiqMap';
import ChartsView from './ChartsView';
import { CohortFlowPanel } from './desk/CohortFlowPanel';
import { LiquidationTape } from './desk/LiquidationTape';
import { FlowColumn } from './flow/FlowColumn';

const subscribeHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};
/** Link powtórki w adresie (#charts?replay=…): wykres pokazuje przeszłość. */
const inReplay = () => parseReplayLink(window.location.hash) !== null;

/**
 * Ekran „W sesji”: wykres z układami sesji (Kokpit domyślnie, od 1280 px z prawą kolumną DOM i taśmy), pod nim
 * przepływ kohort i zrealizowane likwidacje (na każdej szerokości). Na telefonie zamiast kolumny pasek Pulse rynku
 * wykresu, przypięty pod nagłówkiem aplikacji także przy przewijaniu (karty Wykres, DOM, Taśma są w pasku wykresu).
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
      {narrow && !replay && (
        // Pod przypiętym nagłówkiem (z-30, wysokość w --hq-header-h z AppShell), pod menu i arkuszami (z-40, z-50)
        <div className="sticky top-[var(--hq-header-h,0px)] z-20 -mx-4 px-4 py-1.5 bg-page/95 backdrop-blur border-b border-line">
          <FlowColumn coin={coin} narrow variant="pulse" />
        </div>
      )}
      <ChartsView phase="session" onPhase={onPhase} onMarket={setCoin} />
      {!replay && (
        <>
          <CohortFlowPanel />
          <SessionLiquidations />
        </>
      )}
    </div>
  );
};

/** Taśma zrealizowanych likwidacji jako osobna karta, z pokryciem open interest z mapy likwidacji. */
const SessionLiquidations: React.FC = () => {
  const { status, map } = useLiqMap();
  return (
    <LiquidationTape
      coverage={map && (status === 'ready' || status === 'delayed') ? map.coverage.share : null}
      frame="rounded-xl border border-line bg-surface-1 p-4"
    />
  );
};

export default SessionView;
