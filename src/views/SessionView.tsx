import React, { Suspense, lazy, useCallback, useState, useSyncExternalStore } from 'react';
import type { PhaseId } from '../charts/pro/chart/stations';
import { capsOf, subscribeMarkets } from '../state/markets';
import { type PublishedHistory, usePublishedHistory } from '../state/historyAvailability';
import { subscribeHash } from '../state/route';
import { deskMarketOf, marketLabel } from '../config/deskMarkets';
import { tr } from '../i18n';
import { useLiqMap } from '../state/useLiqMap';
import { LocalBoundary } from '../ui/LocalBoundary';
import { HOME_MARKET } from '../utils/marketCaps';
import { FirstContact } from './session/FirstContact';

type Market = string;

// Wykres i panele pod nim to osobne pakiety: karta pierwszego kontaktu (element LCP) maluje się przed modułami wykresu
const ChartsView = lazy(() => import('./ChartsView'));
const CohortFlowPanel = lazy(() => import('./desk/CohortFlowPanel').then((m) => ({ default: m.CohortFlowPanel })));
const LiquidationTape = lazy(() => import('./desk/LiquidationTape').then((m) => ({ default: m.LiquidationTape })));
const NearestLevelsPanel = lazy(() => import('./desk/NearestLevelsPanel').then((m) => ({ default: m.NearestLevelsPanel })));

/** Link powtórki w adresie (#charts?replay=…): wykres pokazuje przeszłość (ten sam warunek co `parseReplayLink`). */
const inReplay = () => {
  const h = window.location.hash;
  if (!h.startsWith('#charts')) return false;
  const src = new URLSearchParams(h.split('?')[1] ?? '').get('replay');
  return src === 'history' || src === 'lessons';
};

/**
 * Ekran „W sesji”: wykres z układami sesji (Kokpit domyślnie, od 1440 px z prawą kolumną DOM i taśmy, od 640 px
 * z tą kolumną jako szufladą nad wykresem), pod nim najbliższe poziomy, przepływ kohort i zrealizowane likwidacje BTC (na każdej
 * szerokości; na wykresie rynku bez skanera „—, bez skanera”). Na telefonie pięć liczb przepływu (Pulse) jest w karcie
 * „Liczby” paska wykresu, nie nad wykresem (karty Wykres, Taśma, DOM, Liczby są w pasku wykresu).
 * Nad wykresem pierwszy kontakt (dymki i przycisk powtórki 15 min, FirstContact).
 * W powtórce (link #charts?replay=…) sama powtórka: panele na żywo nie mieszają się z przeszłością.
 * `onPhase` — karta układu innej fazy (Alt+1…6, nowa karta) przenosi do ekranu tej fazy.
 */
const SessionView: React.FC<{ onPhase?: (phase: PhaseId) => void; onMarket?: (coin: string) => void }> = ({ onPhase, onMarket }) => {
  const replay = useSyncExternalStore(subscribeHash, inReplay);
  // Rynek pierwszego wykresu aktywnej karty (Pulse liczy drabinę i taśmę tego rynku)
  const [coin, setCoin] = useState<Market>(HOME_MARKET);
  const selectMarket = useCallback((coin: Market) => {
    setCoin(coin);
    onMarket?.(coin);
  }, [onMarket]);
  const scanner = useSyncExternalStore(subscribeMarkets, () => capsOf(coin).scanner);
  const archive = usePublishedHistory(coin);
  return (
    <div className="flex flex-col gap-4">
      {!replay && <FirstContact coin={coin} />}
      <Suspense fallback={<div data-wykres-czeka className="min-h-[70dvh] rounded-xl border border-line bg-surface-1" />}>
        <ChartsView phase="session" onPhase={onPhase} onMarket={selectMarket} />
      </Suspense>
      {/* Najbliższe poziomy na każdym rynku: na rynku bez skanera klastry, Uwięzieni i paliwo z „—” i powodem */}
      {!replay && (
        <Suspense fallback={null}>
          <LocalBoundary what={tr('Najbliższe poziomy', 'Nearest levels')}>
            <NearestLevelsPanel coin={coin} />
          </LocalBoundary>
        </Suspense>
      )}
      {!replay && scanner && (
        <Suspense fallback={null}>
          <CohortFlowPanel coin={coin} />
          <SessionLiquidations coin={coin} />
        </Suspense>
      )}
      {!replay && !scanner && <NoScannerNote coin={coin} archive={archive} />}
    </div>
  );
};

/**
 * Rynek bez skanera kont (rynki HIP-3): zamiast dwóch pustych kart BTC („—, bez skanera”) jedno zdanie, co tu jest
 * na żywo, a czego nie ma i dlaczego.
 */
export const NoScannerNote: React.FC<{ coin: Market; archive: PublishedHistory }> = ({ coin, archive }) => {
  const m = deskMarketOf(coin);
  const pl = m ? m.name.pl.gen : marketLabel(coin);
  const en = m ? m.name.en : marketLabel(coin);
  return (
    <p data-bez-skanera data-history={archive.kind} className="rounded-xl border border-line bg-surface-1 p-4 text-sm leading-relaxed text-ink-2">
      {tr(
        `Skaner kont Hyperliquid obsługuje tylko BTC i dostarcza przepływ kohort oraz zrealizowane likwidacje. Dla ${pl} masz na żywo taśmę, arkusz, footprint, deltę i CVD.`,
        `The Hyperliquid account scanner covers BTC only and supplies cohort flow and realised liquidations. For ${en} you get live trades, the order book, footprint, delta and CVD.`
      )}
      {' '}
      {archive.kind === 'listed'
        ? tr('Nagrania taśmy i arkusza są dostępne w zakresie podanym w karcie Rynek.', 'Tape and book recordings are available for the range shown in the Market tab.')
        : archive.kind === 'unlisted'
          ? tr('Indeks nie zawiera nagrań tego rynku.', 'The index contains no recordings for this market.')
          : tr('Dostępność nagrań jest jeszcze nieustalona.', 'Recording availability is undetermined.')}
    </p>
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
