import React, { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  LayoutDashboard,
  ChartCandlestick,
  Target,
  Globe2,
  Box,
  Activity,
  Database,
  GraduationCap,
  MoreHorizontal,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useDesk } from '../state/DeskContext';
import { ViewId } from '../state/types';
import { AnimatedNumber, Badge, BadgeTone, EmptyState, Segmented, VIEW_TRANSITION, fmtCompact, fmtPrice, numLang, DASH, fmtNum } from '../ui';
import { InstallButton } from './InstallButton';
import { ConnectingState } from './ConnectingState';
import DeskView from '../views/DeskView';
import { Lang, lang, setLang, tr } from '../i18n';

// Widoki poza ekranem głównym ładowane leniwie (mniejszy pierwszy bundle)
const ChartsView = lazy(() => import('../views/ChartsView'));
const PlanView = lazy(() => import('../views/PlanView'));
const MarketView = lazy(() => import('../views/MarketView'));
const LabView = lazy(() => import('../views/LabView'));
const MicroView = lazy(() => import('../views/MicroView'));
const LessonsView = lazy(() => import('../views/LessonsView'));
const SourcesView = lazy(() => import('../views/SourcesView'));

const NAV: { id: ViewId; label: string; short: string; icon: React.ReactNode }[] = [
  { id: 'desk', label: 'Desk', short: 'Desk', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'charts', label: tr('Wykresy', 'Charts'), short: tr('Wykresy', 'Charts'), icon: <ChartCandlestick className="w-4 h-4" /> },
  { id: 'plan', label: tr('Analizator planu', 'Plan Analyzer'), short: 'Plan', icon: <Target className="w-4 h-4" /> },
  { id: 'market', label: tr('Rynek', 'Market'), short: tr('Rynek', 'Market'), icon: <Globe2 className="w-4 h-4" /> },
  { id: 'lab', label: 'Lab 3D', short: 'Lab', icon: <Box className="w-4 h-4" /> },
  { id: 'micro', label: tr('Mikrostruktura', 'Microstructure'), short: tr('Mikro', 'Micro'), icon: <Activity className="w-4 h-4" /> },
  { id: 'lessons', label: tr('Lekcje', 'Lessons'), short: tr('Lekcje', 'Lessons'), icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'sources', label: tr('Źródła', 'Sources'), short: tr('Źródła', 'Sources'), icon: <Database className="w-4 h-4" /> },
];

const STATUS_TONE: Record<string, BadgeTone> = { LIVE: 'live', STALE: 'stale', SYNTH: 'stale', PAUSED: 'neutral' };
const STATUS_TITLE: Record<string, string> = {
  LIVE: tr('Realne dane Hyperliquid (REST + WebSocket)', 'Real Hyperliquid data (REST + WebSocket)'),
  STALE: tr('Dane nieświeże: brak synchronizacji > 30 s lub rozłączony WebSocket', 'Stale data: no sync for > 30 s or WebSocket disconnected'),
  SYNTH: tr('Świece zastępcze — czekam na pierwszą synchronizację z API', 'Placeholder candles, waiting for the first API sync'),
  PAUSED: tr('Strumień wstrzymany', 'Stream paused'),
};

const LANGS: { value: Lang; label: string; title: string }[] = [
  { value: 'pl', label: 'PL', title: 'Polski' },
  { value: 'en', label: 'EN', title: 'English' },
];

// Blog jest tylko po polsku — w wersji angielskiej mówimy o tym w etykiecie
const BLOG_LABEL = tr('Blog', 'Blog (PL)');

const TIMEFRAMES = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 14400, label: '4h' },
];

/** Pasek ceny i kontekstu (desktop i telefon). */
const TickerStrip: React.FC = () => {
  const { feed, shaakuni } = useDesk();
  const t = feed.backendTelemetry;
  const first = feed.bars[0]?.open;
  const changePct = first && Number.isFinite(feed.currentPrice) ? ((feed.currentPrice - first) / first) * 100 : null;
  const windowH = (feed.bars.length * feed.timeframeSec) / 3600;
  const windowLabel = windowH > 48 ? `${Math.round(windowH / 24)}d` : `${Math.round(windowH)}h`;
  // Wartości z ostatniej telemetrii przy nieświeżych danych są przygaszone (nie udają bieżących)
  const fresh = feed.dataStatus === 'LIVE';

  return (
    <div className="flex items-center gap-x-5 gap-y-1 overflow-x-auto whitespace-nowrap px-4 lg:px-6 py-2 border-b border-line bg-surface-1/60 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="text-ink-2 font-medium">BTC-PERP</span>
        <AnimatedNumber value={feed.currentPrice} format={(v) => fmtPrice(v)} className="text-lg font-semibold text-ink-1 px-1" />
        {changePct !== null && (
          <span className={changePct >= 0 ? 'text-buy-ink' : 'text-sell-ink'}>
            <span aria-hidden="true">{changePct >= 0 ? '▲' : '▼'}</span> {numLang(Math.abs(changePct).toFixed(2))}%{' '}
            <span className="text-ink-3">{windowLabel}</span>
          </span>
        )}
      </div>
      <span className={`flex items-baseline gap-x-5 ${fresh ? '' : 'opacity-50'}`} title={fresh ? undefined : tr('Ostatnia znana wartość — dane nieświeże', 'Last known value, data is stale')}>
        <Item label="Funding HL" value={t ? `${t.fundingAnnualizedPct >= 0 ? '+' : ''}${fmtNum(t.fundingAnnualizedPct)}% APR` : DASH} />
        <Item label="OI" value={t ? fmtCompact(t.openInterestUsd, '$') : DASH} />
        <Item label="Basis" value={t ? `${fmtNum(t.basisBps)} bps` : DASH} />
      </span>
      <Item label="PDH" value={shaakuni.pdh ? `${fmtPrice(shaakuni.pdh, 0)} · ${shaakuni.pdhStatus}` : DASH} />
      <Item label="PDL" value={shaakuni.pdl ? `${fmtPrice(shaakuni.pdl, 0)} · ${shaakuni.pdlStatus}` : DASH} />
      <Item label={tr('Sesja', 'Session')} value={`${shaakuni.nySession} · ${shaakuni.nyTimeFormatted}`} />
    </div>
  );
};

const subscribeHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};
/** Powtórka w Wykresach (#charts?replay=history|lessons…) pokazuje przeszłość — wtedy bez paska ceny na żywo (jak parseReplayLink). */
const inReplay = () => {
  const h = window.location.hash;
  const src = h.startsWith('#charts') ? new URLSearchParams(h.split('?')[1] ?? '').get('replay') : null;
  return src === 'history' || src === 'lessons';
};

const Item: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-ink-3">{label}</span>
    <span className="font-mono tabular-nums text-ink-1">{value}</span>
  </span>
);

const ViewFallback = () => <EmptyState title={tr('Ładowanie widoku…', 'Loading view…')} />;

// Desk sam czeka na dane pod powitaniem (powitanie i mapa strony nie zależą od danych)
const NEEDS_BARS: ViewId[] = ['plan', 'lab', 'micro'];
const OWN_INTERVALS: ViewId[] = ['charts', 'lessons'];

/** Powłoka aplikacji: nawigacja (górna na desktopie, dolna na telefonie), status danych, przejścia widoków. */
export const AppShell: React.FC = () => {
  const { view, setView, feed, audioEnabled, setAudioEnabled } = useDesk();
  const reduce = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const moreRef = useRef<HTMLDivElement>(null);
  const transition = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : VIEW_TRANSITION;
  const awaitingData = feed.bars.length === 0 && NEEDS_BARS.includes(view);
  const replay = useSyncExternalStore(subscribeHash, inReplay);

  // Menu „Więcej”: zamykanie Escape i kliknięciem poza menu, fokus na pierwszej pozycji
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    moreRef.current?.querySelector<HTMLButtonElement>('[data-more-item]')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [moreOpen]);

  return (
    <div className="min-h-dvh bg-page text-ink-1 flex flex-col">
      <header className="pt-safe sticky top-0 z-30 bg-page/95 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between gap-3 xl:gap-4 px-4 lg:px-6 h-14">
          <a
            href="#desk"
            onClick={(e) => {
              e.preventDefault();
              setView('desk');
            }}
            className="flex items-baseline gap-2 shrink-0"
          >
            <span className="font-display text-lg font-bold tracking-tight">HyperQuant</span>
            <span className="hidden sm:inline lg:hidden 2xl:inline text-[11px] text-ink-3">BTC · Hyperliquid</span>
          </a>

          <nav aria-label={tr('Główna', 'Main')} className="hidden lg:flex items-center gap-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                aria-current={view === n.id ? 'page' : undefined}
                title={n.label}
                onClick={(e) => {
                  e.preventDefault();
                  setView(n.id);
                }}
                className={`relative px-2 xl:px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
                  view === n.id ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1'
                }`}
              >
                {view === n.id && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg bg-surface-2 border border-line"
                    transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  />
                )}
                {/* Poniżej 1680 px krótkie nazwy (jak w dolnym pasku telefonu), żeby menu mieściło się w jednym wierszu w obu językach */}
                <span className="relative min-[1680px]:hidden">{n.short}</span>
                <span className="relative hidden min-[1680px]:inline">{n.label}</span>
              </a>
            ))}
            {/* Blog to osobne statyczne strony (SEO, podgląd linków), nie widok aplikacji */}
            <a href="./blog/" title={BLOG_LABEL} className="px-2 xl:px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-ink-3 hover:text-ink-1 transition-colors duration-150">
              <span className="min-[1680px]:hidden">Blog</span>
              <span className="hidden min-[1680px]:inline">{BLOG_LABEL}</span>
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Segmented<Lang> ariaLabel={tr('Język', 'Language')} size="xs" value={lang} onChange={setLang} options={LANGS} />
            <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
              {feed.dataStatus}
            </Badge>
            {/* Wykresy i Lekcje mają własne interwały — globalny przełącznik dotyczy pozostałych widoków */}
            {!OWN_INTERVALS.includes(view) && (
              <div className="hidden md:block lg:hidden xl:block">
                <Segmented<number> ariaLabel={tr('Interwał', 'Timeframe')} value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
              </div>
            )}
            <IconBtn label={feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')} onClick={() => feed.setIsStreaming(!feed.isStreaming)}>
              {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </IconBtn>
            <IconBtn label={tr('Synchronizuj teraz', 'Sync now')} onClick={feed.syncNow} className="hidden sm:inline-flex">
              <RefreshCw className="w-4 h-4" />
            </IconBtn>
            <IconBtn label={audioEnabled ? tr('Wycisz dźwięk taśmy', 'Mute tape sound') : tr('Włącz dźwięk taśmy', 'Unmute tape sound')} onClick={() => setAudioEnabled(!audioEnabled)} className="hidden sm:inline-flex">
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </IconBtn>
            <InstallButton compact />
          </div>
        </div>
        {!(replay && view === 'charts') && <TickerStrip />}
        {!OWN_INTERVALS.includes(view) && (
          <div className="md:hidden lg:block xl:hidden px-4 py-2 border-b border-line overflow-x-auto">
            <Segmented<number> ariaLabel={tr('Interwał', 'Timeframe')} value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 py-4 pb-28 lg:pb-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} {...transition}>
            <Suspense fallback={<ViewFallback />}>
              {awaitingData && <ConnectingState onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />}
              {!awaitingData && view === 'desk' && <DeskView />}
              {view === 'charts' && <ChartsView />}
              {!awaitingData && view === 'plan' && <PlanView />}
              {view === 'market' && <MarketView />}
              {!awaitingData && view === 'lab' && <LabView />}
              {!awaitingData && view === 'micro' && <MicroView />}
              {view === 'lessons' && <LessonsView />}
              {view === 'sources' && <SourcesView />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Dolna nawigacja (telefon) */}
      <nav aria-label={tr('Główna (telefon)', 'Main (phone)')} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-1/95 backdrop-blur border-t border-line pb-safe">
        <div ref={moreRef}>
        <div className="grid grid-cols-5">
          {NAV.slice(0, 4).map((n) => (
            <TabBtn key={n.id} active={view === n.id} label={n.short} icon={n.icon} onClick={() => setView(n.id)} />
          ))}
          <TabBtn
            active={NAV.slice(4).some((n) => n.id === view)}
            label={tr('Więcej', 'More')}
            icon={<MoreHorizontal className="w-4 h-4" />}
            onClick={() => setMoreOpen((o) => !o)}
            expanded={moreOpen}
          />
        </div>
        <AnimatePresence>
          {moreOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.16 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="absolute bottom-full right-3 mb-2 w-56 bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl"
            >
              {NAV.slice(4).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-more-item
                  onClick={() => {
                    setView(n.id);
                    setMoreOpen(false);
                  }}
                  className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3"
                >
                  {n.icon}
                  {n.label}
                </button>
              ))}
              <a href="./blog/" className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3">
                <Newspaper className="w-4 h-4" />
                {BLOG_LABEL}
              </a>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </nav>
    </div>
  );
};

const IconBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className = '' }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-line transition-colors duration-150 ${className}`}
  >
    {children}
  </button>
);

const TabBtn: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void; expanded?: boolean }> = ({
  active,
  label,
  icon,
  onClick,
  expanded,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    aria-expanded={expanded}
    className={`min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent' : 'text-ink-3'}`}
  >
    {icon}
    {label}
  </button>
);
