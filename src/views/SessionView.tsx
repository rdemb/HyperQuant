import React, { Suspense, lazy, useState, useSyncExternalStore } from 'react';
import type { PhaseId } from '../charts/pro/chart/stations';
import { subscribeHash } from '../state/route';
import { useLiqMap } from '../state/useLiqMap';
import { HOME_MARKET } from '../utils/marketCaps';
import { FirstContact } from './session/FirstContact';

type Market = string;

// Wykres i panele pod nim to osobne pakiety: karta pierwszego kontaktu (element LCP) maluje się przed modułami wykresu
const ChartsView = lazy(() => import('./ChartsView'));
const CohortFlowPanel = lazy(() => import('./desk/CohortFlowPanel').then((m) => ({ default: m.CohortFlowPanel })));
const LiquidationTape = lazy(() => import('./desk/LiquidationTape').then((m) => ({ default: m.LiquidationTape })));

/** Link powtórki w adresie (#charts?replay=…): wykres pokazuje przeszłość (ten sam warunek co `parseReplayLink`). */
const inReplay = () => {
  const h = window.location.hash;
  if (!h.startsWith('#charts')) return false;
  const src = new URLSearchParams(h.split('?')[1] ?? '').get('replay');
  return src === 'history' || src === 'lessons';
};

/**
 * Ekran „W sesji”: wykres z układami sesji (Kokpit domyślnie, od 1440 px z prawą kolumną DOM i taśmy, od 640 px
 * z tą kolumną jako szufladą nad wykresem), pod nim przepływ kohort i zrealizowane likwidacje BTC (na każdej
 * szerokości; na wykresie rynku bez skanera „—, bez skanera”). Na telefonie pięć liczb przepływu (Pulse) jest w karcie
 * „Liczby” paska wykresu, nie nad wykresem (karty Wykres, Taśma, DOM, Liczby są w pasku wykresu).
 * Nad wykresem pierwszy kontakt (dymki i przycisk powtórki 15 min, FirstContact).
 * W powtórce (link #charts?replay=…) sama powtórka: panele na żywo nie mieszają się z przeszłością.
 * `onPhase` — karta układu innej fazy (Alt+1…6, nowa karta) przenosi do ekranu tej fazy.
 */
const SessionView: React.FC<{ onPhase?: (phase: PhaseId) => void }> = ({ onPhase }) => {
  const replay = useSyncExternalStore(subscribeHash, inReplay);
  // Rynek pierwszego wykresu aktywnej karty (Pulse liczy drabinę i taśmę tego rynku)
  const [coin, setCoin] = useState<Market>(HOME_MARKET);
  return (
    <div className="flex flex-col gap-4">
      {!replay && <FirstContact coin={coin} />}
      <Suspense fallback={<div data-wykres-czeka className="min-h-[70dvh] rounded-xl border border-line bg-surface-1" />}>
        <ChartsView phase="session" onPhase={onPhase} onMarket={setCoin} />
      </Suspense>
      {!replay && (
        <Suspense fallback={null}>
          <CohortFlowPanel coin={coin} />
          <SessionLiquidations coin={coin} />
        </Suspense>
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
