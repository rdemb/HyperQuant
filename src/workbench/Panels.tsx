import { lazy, Suspense, useEffect, useMemo } from 'react';
import { storeFor } from '../charts/pro/store/proStore';
import { useStoreVersion } from '../charts/pro/store/useStoreVersion';
import { deskMarketOf } from '../config/deskMarkets';
import { lang, tr } from '../i18n';
import { useNow } from '../shell/dzien';
import sampleMasks from '../data/deltaBoundsExample.v1.json';
import { VENUE_BASKET_SAMPLE } from '../views/flow/venueBasketSample';
import { fmtFixed } from '../ui/format';
import { Chronograph, chronoTime } from '../views/flow/Chronograph';
import { CHRONOGRAPH_CLIP_REVISION, resolveChronographAnchor, type ChronographAnchor } from '../views/flow/chronographAnchor';
import { CHRONOGRAPH_REPLAY_MARKET } from '../views/flow/chronographModel';
import { openChronographClip } from '../views/flow/chronographHistory';
import { BOOK_HIDE_AFTER_MS, MAX_BOOK_AGE_MS } from '../views/flow/orderFlowDesk';
import { anchorReasonText, questionHash } from '../views/flow/questionLink';
import { compareTradeToDrop } from '../views/flow/snapshotOrder';
import type { WorkspaceComposition } from './composition';
import { ChartPanel } from './ChartPanel';

const Archive = lazy(() => import('../views/flow/ArchiveHourView'));
const Basket = lazy(() => import('../views/flow/VenueBasket'));
const Delta = lazy(() => import('../views/flow/DeltaBoundsExample'));

export const BEFORE_B = 1795159794009;
export const AFTER_B = BEFORE_B + 1;
const anchor: ChronographAnchor = {
  v: 1, source: 'hyperliquid/BTC-perp', clip: 'level', revision: CHRONOGRAPH_CLIP_REVISION, through: AFTER_B,
  trade: { t: 1795159782058, tid: '978', px: 61_611, sz: 0.00681, side: -1 },
  book: { side: 'bid', a: 1795159781528, b: BEFORE_B },
};
const returnKey = 'hq.workbench.return';
export function rememberReturn(slot: string, panelId: string) {
  try { sessionStorage.setItem(returnKey, JSON.stringify({ slot, panelId })); } catch { /* navigation remains available */ }
}
export function consumeReturn(): { slot: string; panelId: string } | null {
  try {
    const raw = sessionStorage.getItem(returnKey);
    sessionStorage.removeItem(returnKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export type Panel = WorkspaceComposition['panels'][number];
const orderFlow = (query: string) => `../?lang=${lang}#orderflow?${query}`;

function FlowPanel({ panel, change }: { panel: Panel; change: (update: Partial<Panel>) => void }) {
  const store = storeFor(panel.market);
  useEffect(() => { store.start(); }, [store]);
  useStoreVersion(store, 500);
  const now = useNow(1_000);
  const latest = store.exactBook()?.latest() ?? null;
  const age = latest ? store.liveBookAge(latest, now) : null;
  const fresh = store.status === 'open' && age !== null && age <= MAX_BOOK_AGE_MS;
  const book = age !== null && age <= BOOK_HIDE_AFTER_MS ? latest : null;
  return <>
    <p className="wb-source mono">{fresh && latest
      ? <>LIVE · L2 {chronoTime(latest.t)} UTC</>
      : book && latest ? <>STALE · L2 {chronoTime(latest.t)} UTC</> : tr('— · Czekam na świeżą migawkę L2', '— · Waiting for a fresh L2 snapshot')}</p>
    <Chronograph source={{
      tape: store.tape, coverage: store.coverage, through: now + 1,
      book, previous: null, bookCoverage: store.bookCoverage, bookAge: age,
      bookFresh: fresh, fmtPx: px => store.fmtPx(px), unit: panel.market.split(':').at(-1) ?? panel.market,
      sizeDecimals: store.szDecimals ?? deskMarketOf(panel.market)?.szDecimals ?? 0,
    }} ladderSettings={{ tapeMinimumUsd: panel.settings?.tapeMinimumUsd ?? 0, bookDepth: panel.settings?.bookDepth ?? 10 }}
      onMinimumChange={tapeMinimumUsd => change({ settings: { ...panel.settings, tapeMinimumUsd } })}
      onDepthChange={bookDepth => change({ settings: { ...panel.settings, bookDepth } })} />
  </>;
}

function Observation({ panel, slot }: { panel: Panel; slot: string }) {
  const through = panel.clock.kind === 'replay' ? panel.clock.cursorMs : null;
  const valid = panel.market === CHRONOGRAPH_REPLAY_MARKET && panel.clock.kind === 'replay' && panel.clock.analysisId === 'level-978' && (through === BEFORE_B || through === AFTER_B);
  const saved = { ...anchor, through: through ?? AFTER_B };
  const read = useMemo(() => valid ? resolveChronographAnchor(saved) : null, [valid, through]);
  const clip = useMemo(() => read?.kind === 'resolved' ? openChronographClip('level', saved.through, false) : null, [read]);
  const result = read?.kind === 'resolved' && read.drop && clip
    ? compareTradeToDrop(read.drop, read.trade, clip.coverage, { tape: 'exchange', book: 'exchange' }) : null;
  const timeline = [
    { title: 'A', time: anchor.book!.a },
    { title: tr('Wykonanie', 'Trade'), time: anchor.trade.t },
    { title: 'B', time: anchor.book!.b },
  ];
  return <div className="wb-observation" data-observation={read?.kind ?? 'unavailable'}>
    <p className="wb-source mono">{tr('NAGRANIE', 'RECORDING')} · Hyperliquid BTC perp · 20.11.2026 · {valid ? `${chronoTime(saved.through)} UTC` : '—'}</p>
    <h3>{result?.kind === 'undetermined'
      ? tr('Kolejność nieustalona', 'Order undetermined')
      : tr('Co było pierwsze?', 'Which came first?')}</h3>
    {read?.kind === 'resolved' ? <>
      <p>{tr('Sprzedaż', 'Sell')} <strong className="mono">{fmtFixed(read.trade.sz, 5)} BTC</strong> {tr('po', 'at')}{' '}
        <strong className="mono">{fmtFixed(read.trade.px, 0)} USD</strong></p>
      <ol className="wb-evidence">
        {timeline.map(({ title, time }, index) => <li key={time}>
          <span className="wb-evidence-dot" data-print={index === 1 || undefined} />
          <strong>{title}</strong><time className="mono">{chronoTime(time)} UTC</time>
          <span className="mono">
            {index === 1 ? tr('Sprzedaż', 'Sell') : read.drop ? `${fmtFixed(index === 0 ? read.drop.before.size : read.drop.after.size, 5)} BTC BID` : '—'}
          </span>
        </li>)}
      </ol>
      <p className="wb-muted">{tr('Czas giełdy. Ciągłość transportu niezweryfikowana.', 'Exchange time. Transport continuity is unverified.')}</p>
    </> : <p role="status">{read?.kind === 'unavailable' ? anchorReasonText(read.reason) : tr('— · Brak obsługiwanej kotwicy obserwacji.', '— · No supported observation anchor.')}</p>}
    {valid && <a className="wb-button wb-primary" href={`../?lang=${lang}${questionHash(CHRONOGRAPH_REPLAY_MARKET, 'level', saved)}`}
      onClick={() => rememberReturn(slot, panel.id)}>{tr('Otwórz obserwację', 'Open observation')} ↗</a>}
  </div>;
}

export function PanelContent({ panel, change, slot, changeCursor, changeMarket }: {
  panel: Panel; change: (update: Partial<Panel>) => void; slot: string; changeCursor: (value: number) => void; changeMarket: (market: string) => void;
}) {
  if (panel.kind === 'chart') return panel.clock.kind === 'live'
    ? <ChartPanel key={panel.market} panel={panel} change={change} onMarket={changeMarket} />
    : <p role="status">{tr('— · Wykres pokazuje tylko dane na żywo; kursora nagrania nie obsługuje. Nagranie otworzysz w panelu „Godzina z archiwum”.', '— · The chart shows live data only and does not support a recording cursor. Open recordings in the “Archive hour” panel.')}</p>;
  if (panel.kind === 'observation') return <Observation panel={panel} slot={slot} />;
  if (panel.kind === 'flow') return panel.clock.kind === 'live'
    ? <FlowPanel key={panel.market} panel={panel} change={change} />
    : <p role="status">{tr('— · Ten panel obsługuje zegar na żywo.', '— · This panel supports the live clock.')}</p>;
  if (panel.market !== CHRONOGRAPH_REPLAY_MARKET || panel.clock.kind !== 'replay') {
    return <p role="status">{tr('— · Ten panel wymaga nagrania BTC.', '— · This panel requires a BTC recording.')}</p>;
  }
  const cursor = panel.clock.cursorMs;
  const source = panel.clock.analysisId;
  const matches = panel.kind === 'archive' ? source === 'btc-08' && (cursor === 1795163407089 || cursor === 1795163416997)
    : panel.kind === 'basket' ? source === 'btc-venues' && VENUE_BASKET_SAMPLE.minutes.some(minute => minute.from === cursor)
      : source === 'btc-delta' && sampleMasks.masks.some(mask => mask.gap[0] === cursor);
  if (!matches || cursor === null) {
    return <p role="status">{tr('— · To nagranie lub chwila są niedostępne w tej kopii.', '— · This recording or moment is unavailable in this build.')}</p>;
  }
  const cursorProps = { cursorMs: cursor, onCursorChange: changeCursor };
  return <Suspense fallback={<p role="status">{tr('Wczytuję nagranie…', 'Loading recording…')}</p>}>
    {panel.kind === 'archive' ? <><Archive {...cursorProps} /><a className="wb-button" href={orderFlow('m=BTC&w=archive')}>{tr('Otwórz pełne nagranie', 'Open full recording')} ↗</a></>
      : panel.kind === 'basket' ? <Basket {...cursorProps} /> : <Delta {...cursorProps} />}
  </Suspense>;
}
