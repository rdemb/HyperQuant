import { lazy, Suspense, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, ChevronLeft, Crosshair, Maximize2, Minimize2, SlidersHorizontal, X } from 'lucide-react';
import { storeFor, type ProStore } from '../../charts/pro/store/proStore';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { deskMarketOf } from '../../config/deskMarkets';
import { lang, locale, tr } from '../../i18n';
import { useNow } from '../../shell/dzien';
import { subscribeHash } from '../../state/route';
import { SectionHeading } from '../../ui';
import { DASH, fmtCompact, fmtFixed } from '../../ui/format';
import { Chronograph, type TapeExcerpt } from './Chronograph';
import type { ChronographDemo } from './chronographHistory';
import { conflictRepairHash, linkConflictText, questionLinkConflict, type QuestionLinkConflict } from './questionLink';
import { CHRONOGRAPH_REPLAY_MARKET } from './chronographModel';
import { DeltaMomentCard } from './DeltaMomentCard';
import { LevelReading } from './LevelReading';
import { LiquidityHeatmap } from './LiquidityHeatmap';
import { capsOf } from '../../state/markets';
import { LocalBoundary } from '../../ui/LocalBoundary';
import { savedLadderSettings, WorkspaceSave } from './WorkspaceSave';
import type { DomMode } from './DomWorkspace';
import { MomentLens } from './MomentLens';
import { readDeltaMoment, type DeltaMoment } from './deltaMoment';
import { useOrderFlowFullscreen } from './useOrderFlowFullscreen';
import {
  BOOK_HIDE_AFTER_MS, FLOW_WINDOW_MS, MAX_BOOK_AGE_MS, ORDER_FLOW_MARKETS, PIN_MIN_MS, PIN_TAPE_LIMIT,
  captureLevel, deskMarketFromHash, referenceBook,
  type BookSide, type PinnedLevel,
} from './orderFlowDesk';
import './orderFlowView.css';

type Workspace = 'live' | 'memory' | ChronographDemo | 'archive';

const ChronographReplay = lazy(() => import('./ChronographReplay'));
const ArchiveHourView = lazy(() => import('./ArchiveHourView'));
const VenueBasket = lazy(() => import('./VenueBasket'));
const DeltaBoundsExample = lazy(() => import('./DeltaBoundsExample'));
// Przepływ kohort skanera (wieloryby, market makerzy, statystycznie poinformowani, reszta) — ten sam panel co W sesji
const CohortFlowPanel = lazy(() => import('../desk/CohortFlowPanel').then((m) => ({ default: m.CohortFlowPanel })));
const readHash = () => deskMarketFromHash(window.location.hash);

function workspaceFromHash(hash: string, coin: string): Workspace {
  if (coin !== CHRONOGRAPH_REPLAY_MARKET || questionLinkConflict(hash)) return 'live';
  const w = new URLSearchParams(hash.split('?', 2)[1]).get('w');
  return w === 'level' || w === 'flip' || w === 'archive' ? w : 'live';
}
const dollars = (v: number | null | undefined) => v == null ? DASH : `${fmtCompact(v)} USD`;

const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const timeLabel = (time: number) => Number.isFinite(time) ? clock.format(time) : DASH;
const exactTime = (time: number | null) => time === null ? DASH : `${timeLabel(time)}${tr(',', '.')}${String(time % 1000).padStart(3, '0')}`;
function PinnedRead({ focus, store, clearFocus, refresh, actions, reading }: {
  focus: PinnedLevel; store: ProStore; clearFocus: () => void; refresh: () => void; actions: ReactNode; reading?: ReactNode;
}) {
  const max = Math.max(1, focus.before ?? 0, focus.after ?? 0);
  const depth = (usd: number | null, time: number | null) => usd !== null ? dollars(usd)
    : time === null ? DASH : tr('Poza zasięgiem', 'Outside book range');
  const executionLabel = focus.side === 'ask' ? tr('Kupiono', 'Bought') : tr('Sprzedano', 'Sold');
  return (
    <div className="of-focus">
      <div className="of-focus-title">
        <Crosshair size={16} />
        <span>{focus.side === 'ask' ? 'Ask' : 'Bid'} <strong data-of-focus>{store.fmtPx(focus.price)}</strong></span>
        <button type="button" className="of-focus-refresh" onClick={refresh}>{tr('Odśwież', 'Refresh')}</button>
        <button type="button" onClick={clearFocus} aria-label={tr('Zwolnij przypiętą cenę', 'Unpin price')}><X size={18} /></button>
      </div>
      <dl className="of-focus-values">
        <div><dt>{tr('Było', 'Before')}</dt><dd>{depth(focus.before, focus.from)}</dd></div>
        <div><dt>{executionLabel}</dt><dd>{focus.executions ? dollars(focus.executions.usd) : DASH}</dd></div>
        <div><dt>{tr('Na końcu', 'After')}</dt><dd>{depth(focus.after, focus.through)}</dd></div>
      </dl>
      {reading}
      {focus.before !== null && focus.after !== null && (
        <div className="of-depth-compare" aria-hidden="true">
          <span style={{ width: `${100 * focus.after / max}%` }} />
          <i style={{ left: `calc(${100 * focus.before / max}% - 1px)` }} />
        </div>
      )}
      <div className="of-focus-time">
        <span>{exactTime(focus.from)} → {exactTime(focus.through)}</span>
        {focus.through !== null && focus.from !== null && <span>{fmtFixed((focus.through - focus.from) / 1000, 3)} s</span>}
      </div>
      {focus.from === null ? <p>{tr('Czekam na porównywalną parę migawek', 'Waiting for a comparable pair of snapshots')}</p>
        : !focus.executions ? <p>{tr('Niepełne pokrycie taśmy w tym odcinku', 'Incomplete tape coverage in this interval')}</p>
          : <p>{tr(`${focus.executions.count} wykonań`, `${focus.executions.count} trades`)}
            {focus.executions.count > PIN_TAPE_LIMIT && tr(` · poniżej ostatnie ${PIN_TAPE_LIMIT}`, ` · latest ${PIN_TAPE_LIMIT} below`)}</p>}
      {actions}
    </div>
  );
}

function FlowMarket({ coin, pro, momentOpen, closeMoment, mode, setMode }: {
  coin: string; pro: boolean; momentOpen: boolean; closeMoment: () => void; mode: DomMode; setMode: (mode: DomMode) => void;
}) {
  const store = storeFor(coin);
  useEffect(() => store.start(), [store]);
  useStoreVersion(store, 300);
  useNow(1_000);
  const now = Date.now();
  const through = Math.floor(now / 1_000) * 1_000 + 1;
  const market = deskMarketOf(coin);
  const sizeDecimals = store.szDecimals ?? market?.szDecimals ?? 0;
  // Link do powtórki (#orderflow?m=BTC&w=level…): otwiera ten sam widok po przeładowaniu; bez parametru jak dotąd „live”
  // Adres z kotwicą pytania: rynek i widok porównane z kotwicą przed normalizacją rynku i przed wyborem danych.
  // Przy konflikcie: jawny powód, żadnego wyniku i żadnej cichej naprawy adresu (bez replaceState).
  const [conflict, setConflict] = useState<QuestionLinkConflict | null>(() => questionLinkConflict(window.location.hash));
  const [workspace, setWorkspace] = useState(() => workspaceFromHash(window.location.hash, coin));
  // Zmiana adresu bez przeładowania (wpisany albo wklejony odsyłacz): przełącz widok i otwórz pytanie z nowej kotwicy.
  // Własne zapisy stanu robimy przez replaceState, które nie wywołuje hashchange — brak pętli.
  const [linkKey, setLinkKey] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('a') ?? '');
  useEffect(() => {
    const onHash = () => {
      const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
      setConflict(questionLinkConflict(window.location.hash));
      setWorkspace(workspaceFromHash(window.location.hash, coin));
      setLinkKey(q.get('a') ?? '');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [coin]);
  const [mountedMemory, setMountedMemory] = useState(false);
  const [ladder, setLadder] = useState(() => savedLadderSettings(coin));
  const [focus, setFocus] = useState<(PinnedLevel & { frame: typeof frame; fresh: boolean }) | null>(null);
  const [showPinnedTrades, setShowPinnedTrades] = useState(false);
  const pinnedTradesButton = useRef<HTMLButtonElement>(null);
  const [pin, setPin] = useState<{ to: number; sizeDecimals: number } | null>(null);
  const [capture, setCapture] = useState<{ pin: NonNullable<typeof pin>; result: DeltaMoment } | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const isLive = store.status === 'open' && store.coverage.isOpen;
  const history = store.exactBook();
  const latest = history?.latest() ?? null;
  const bookAge = latest ? store.liveBookAge(latest, now) : null;
  const bookFresh = store.status === 'open' && bookAge !== null && bookAge <= MAX_BOOK_AGE_MS;
  const frame = bookAge !== null && bookAge <= BOOK_HIDE_AFTER_MS ? latest : null;
  const previous = history && frame ? referenceBook(history, frame.t, FLOW_WINDOW_MS, store.bookCoverage) : null;
  useEffect(() => {
    if (!pro) { setPin(null); setCapture(null); return; }
    if (!pin) return;
    const abort = new AbortController();
    void readDeltaMoment(store.tape, store.coverage, pin.to, pin.sizeDecimals, abort.signal).then(result => {
      if (result && !abort.signal.aborted) setCapture({ pin, result });
    });
    return () => abort.abort();
  }, [pin, pro, store]);
  const pinned = pro ? pin : null;
  const refreshDelta = () => {
    setCapture(null);
    setPin({ to: through - 1, sizeDecimals });
  };
  const closeDelta = () => { setPin(null); setCapture(null); compareButton.current?.focus(); };
  const readLevel = (price: number, side: BookSide) => {
    const anchor = frame && bookFresh ? frame.t - PIN_MIN_MS : null;
    const earlier = anchor === null ? null : history?.range(anchor, anchor + 1).at(-1) ?? null;
    return {
      ...captureLevel({ price, side, current: frame, previous: earlier, bookCoverage: store.bookCoverage, tape: store.tape, tapeCoverage: store.coverage }),
      frame, fresh: bookFresh,
    };
  };
  const excerpt: TapeExcerpt | undefined = useMemo(() => pro && showPinnedTrades && focus?.executions ? {
    rows: focus.executions.rows,
    firstBelow: null,
    label: tr('Przypięty odcinek', 'Pinned interval') + ' · ' + exactTime(focus.from) + ' – ' + exactTime(focus.through),
    close: () => {
      setShowPinnedTrades(false);
      pinnedTradesButton.current?.focus({ preventScroll: true });
    },
  } : undefined, [focus, pro, showPinnedTrades]);
  const status = (
    <div className="of-status">
      <span className={isLive && bookFresh ? 'of-status-live' : undefined} data-of-status>
        <span className="of-status-dot" aria-hidden="true" />
        <strong>{market?.label ?? coin}</strong>{' · '}
        {isLive && bookFresh ? 'Hyperliquid · LIVE'
          : frame && bookAge !== null
            ? tr(`Ostatnia migawka arkusza · ${Math.floor(bookAge / 1000)} s temu`, `Last book snapshot · ${Math.floor(bookAge / 1000)} s ago`)
            : tr('Brak świeżego arkusza L2', 'Fresh L2 unavailable')}
      </span>
      <span>
        <span className="of-buy">Bid {frame && frame.nBids ? store.fmtPx(frame.px[0]) : DASH}</span>{' · '}
        <span className="of-sell">Ask {frame && frame.nBids < frame.px.length ? store.fmtPx(frame.px[frame.nBids]) : DASH}</span>{' · '}
        {tr('Ostatnie', 'Last')} <strong>{Number.isFinite(store.tape.lastPx) ? store.fmtPx(store.tape.lastPx) : DASH}</strong>
      </span>
      {(!isLive || !bookFresh) && <span>{isLive ? tr('Taśma · LIVE', 'Tape · LIVE') : tr('Taśma bez połączenia', 'Tape disconnected')}</span>}
    </div>
  );
  const choices: Array<[Workspace, string]> = [
    ['live', tr('Drabinka cen', 'Price ladder')],
    ['memory', tr('Pamięć i ślad', 'Memory & trace')],
  ];
  if (coin === CHRONOGRAPH_REPLAY_MARKET) choices.push(
    ['flip', tr('Powtórka zmiany delty', 'Delta flip replay')],
    ['level', tr('Próba poziomu', 'Level test')],
    ['archive', tr('Nagranie 08 UTC', '08 UTC recording')],
  );
  if (conflict) {
    const repair = conflictRepairHash(window.location.hash, conflict);
    return <div data-of-market={coin}>
      <section className="oc-link-conflict" role="alert" aria-labelledby="oc-link-conflict-h" data-oc-link-conflict={conflict.reason}>
        <h3 id="oc-link-conflict-h">{tr('Link do pytania nie pasuje do adresu', 'The question link does not match the address')}</h3>
        <p>{linkConflictText(conflict)}</p>
        <div className="oc-link-conflict-actions">
          {repair && <a className="oc-question-trade" href={repair}>{tr('Otwórz pytanie na rynku z linku (BTC)', 'Open the question on the linked market (BTC)')}</a>}
          <a href={`#orderflow?m=${encodeURIComponent(coin)}`}>{tr(`Order Flow ${market?.label ?? coin} na żywo, bez pytania`, `Live Order Flow ${market?.label ?? coin}, without the question`)}</a>
        </div>
      </section>
    </div>;
  }
  return (
    <div data-of-market={coin}>
      <div className="oc-switch" role="group" aria-label={tr('Widok Order Flow', 'Order Flow workspace')}>
        {choices.map(([value, label]) => <button type="button" key={value} data-oc-workspace={value}
          aria-pressed={workspace === value} onClick={() => {
            if (value === 'memory') setMountedMemory(true);
            setWorkspace(value);
            const next = `#orderflow?m=${encodeURIComponent(coin)}` + (value === 'flip' || value === 'level' || value === 'archive' ? `&w=${value}` : '');
            if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next);
          }}>{label}</button>)}
      </div>
      <div hidden={workspace !== 'live'}>
        {status}
        {workspace === 'live' && <LiquidityHeatmap store={store} />}
        <WorkspaceSave coin={coin} settings={ladder} apply={setLadder} />
        <Chronograph ladderSettings={ladder}
          onMinimumChange={value => setLadder(prev => ({ ...prev, tapeMinimumUsd: value }))}
          onDepthChange={value => setLadder(prev => ({ ...prev, bookDepth: value }))}
          source={{ tape: store.tape, coverage: store.coverage, through, book: frame, previous, bookCoverage: store.bookCoverage,
          bookAge, bookFresh, unit: coin.split(':').at(-1) ?? coin, fmtPx: px => store.fmtPx(px), sizeDecimals }}
          onPickBook={(px, side) => {
            if (pro) {
              setFocus(side ? readLevel(px, side) : null);
              setShowPinnedTrades(false);
            }
          }}
          excerpt={excerpt}
          compare={pro && <button ref={compareButton} type="button" aria-expanded={!!pinned}
            aria-controls={pinned ? 'of-delta-moment' : undefined} onClick={pinned ? closeDelta : refreshDelta}>
            {tr('Sprawdź deltę 30 s', 'Inspect 30 s delta')}
          </button>}
          trial={pro && focus && <PinnedRead focus={focus} store={store} clearFocus={() => { setFocus(null); setShowPinnedTrades(false); }}
            refresh={() => setFocus(readLevel(focus.price, focus.side))}
            reading={<LevelReading frame={focus.frame} side={focus.side} price={focus.price} unit={coin.split(':').at(-1) ?? coin}
              sizeDecimals={sizeDecimals} fresh={focus.fresh} fmtPx={px => store.fmtPx(px)} />}
            actions={focus.executions && <button ref={pinnedTradesButton} type="button" aria-pressed={!!excerpt}
              onClick={() => setShowPinnedTrades(value => !value)}>{tr('Zobacz przypięte wykonania', 'View pinned trades')}</button>} />} />
        {pinned && <DeltaMomentCard to={pinned.to} readout={capture?.pin === pinned ? capture.result : null} store={store}
          refresh={refreshDelta} close={closeDelta} />}
        {workspace === 'live' && capsOf(coin).scanner && <Suspense fallback={null}>
          <LocalBoundary what={tr('Przepływ kohort', 'Cohort flow')}>
            <CohortFlowPanel coin={coin} />
          </LocalBoundary>
        </Suspense>}
      </div>
      {mountedMemory && <div hidden={workspace !== 'memory'}>
        <MomentLens store={store} close={closeMoment} expanded={false} status={status} mode={mode} setMode={setMode} />
      </div>}
      {(workspace === 'flip' || workspace === 'level') && <Suspense fallback={<p className="of-empty">{tr('Wczytuję nagranie…', 'Loading recording…')}</p>}>
        <ChronographReplay key={`${workspace}:${linkKey}`} kind={workspace} />
      </Suspense>}
      {workspace === 'archive' && <Suspense fallback={<p className="of-empty">{tr('Wczytuję nagranie…', 'Loading recording…')}</p>}>
        <ArchiveHourView />
        <VenueBasket />
        <DeltaBoundsExample />
      </Suspense>}
      {momentOpen && <MomentLens store={store} close={closeMoment} expanded status={status} mode={mode} setMode={setMode} />}
    </div>
  );
}

export default function OrderFlowView() {
  const coin = useSyncExternalStore(subscribeHash, readHash);
  const [pro, setPro] = useState(false);
  const [mode, setMode] = useState<DomMode>('memory');
  const [momentOpen, setMomentOpen] = useState(false);
  const momentButton = useRef<HTMLButtonElement>(null);
  const fullscreen = useOrderFlowFullscreen();
  const momentScroll = useRef<number | null>(null);
  const fullscreenLabel = fullscreen.mode ? tr('Zamknij pełny ekran Order Flow', 'Exit Order Flow full screen')
    : tr('Pełny ekran Order Flow', 'Order Flow full screen');
  const FullscreenIcon = fullscreen.mode ? Minimize2 : Maximize2;
  const openMoment = () => {
    if (fullscreen.mode) momentScroll.current = fullscreen.sectionRef.current?.scrollTop ?? 0;
    setMomentOpen(true);
  };
  const closeMoment = () => {
    setMomentOpen(false);
    momentButton.current?.focus({ preventScroll: fullscreen.mode !== null });
  };
  useLayoutEffect(() => {
    if (momentOpen || momentScroll.current === null) return;
    fullscreen.sectionRef.current?.scrollTo({ top: momentScroll.current, behavior: 'instant' });
    momentScroll.current = null;
  }, [momentOpen, fullscreen.sectionRef]);
  return (
    <section ref={fullscreen.sectionRef} className="of-desk" data-order-flow data-of-maximized={fullscreen.mode ?? undefined}
      aria-labelledby="orderflow-title">
      <div className="of-page-heading">
        <SectionHeading id="orderflow-title" level={1} title="Order Flow" />
        <a href={`#charts?m=${encodeURIComponent(coin)}`} className="of-chart-link"><ChevronLeft size={16} aria-hidden="true" />{tr('Wykres', 'Chart')}</a>
        <button ref={fullscreen.buttonRef} type="button" className="of-mode of-fullscreen-toggle" data-of-fullscreen-toggle
          aria-keyshortcuts="F" aria-label={fullscreenLabel} title={fullscreenLabel + ' (F)'} onClick={fullscreen.toggle}>
          <FullscreenIcon size={17} aria-hidden="true" />
          <span>{fullscreen.mode ? tr('Wyjdź', 'Exit') : tr('Pełny ekran', 'Full screen')}</span>
        </button>
        <div className="of-controls">
          <nav aria-label={tr('Rynki order flow', 'Order flow markets')}>
            {ORDER_FLOW_MARKETS.map(market => (
              <a key={market.coin} href={`#orderflow?m=${encodeURIComponent(market.coin)}`} aria-current={market.coin === coin ? 'page' : undefined}>{market.label}</a>
            ))}
          </nav>
          <button type="button" className="of-mode" aria-pressed={pro} onClick={() => setPro(value => !value)}><SlidersHorizontal size={15} aria-hidden="true" />Pro</button>
          <button type="button" className="of-mode of-moment-launch" ref={momentButton} aria-haspopup="dialog" aria-expanded={momentOpen} onClick={openMoment}><Crosshair size={15} aria-hidden="true" />{tr('Przekrój chwili', 'Moment lens')}</button>
        </div>
      </div>
      <FlowMarket key={coin} coin={coin} pro={pro} momentOpen={momentOpen} closeMoment={closeMoment} mode={mode} setMode={setMode} />
      <a className="of-link" href={`./orderflow/replay/?m=${deskMarketOf(coin)?.slug.toUpperCase() ?? 'BTC'}&lang=${lang}`}>
        {tr('Odtwórz nagranie z 20.11.2026', 'Replay the 20 Nov 2026 recording')}
      </a>
      <a className="of-link" href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions" target="_blank" rel="noreferrer">
        {tr('Źródło danych Hyperliquid', 'Hyperliquid data source')}<ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
