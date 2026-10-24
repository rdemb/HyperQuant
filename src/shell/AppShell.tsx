import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  LayoutDashboard,
  Target,
  Globe2,
  Box,
  Activity,
  Database,
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
import { AnimatedNumber, Badge, BadgeTone, EmptyState, Segmented, VIEW_TRANSITION, fmtCompact, fmtPrice, DASH } from '../ui';
import { InstallButton } from './InstallButton';
import DeskView from '../views/DeskView';

// Widoki poza ekranem głównym ładowane leniwie (mniejszy pierwszy bundle)
const PlanView = lazy(() => import('../views/PlanView'));
const MarketView = lazy(() => import('../views/MarketView'));
const LabView = lazy(() => import('../views/LabView'));
const MicroView = lazy(() => import('../views/MicroView'));
const SourcesView = lazy(() => import('../views/SourcesView'));

const NAV: { id: ViewId; label: string; short: string; icon: React.ReactNode }[] = [
  { id: 'desk', label: 'Desk', short: 'Desk', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'plan', label: 'Analizator planu', short: 'Plan', icon: <Target className="w-4 h-4" /> },
  { id: 'market', label: 'Rynek', short: 'Rynek', icon: <Globe2 className="w-4 h-4" /> },
  { id: 'lab', label: 'Lab 3D', short: 'Lab', icon: <Box className="w-4 h-4" /> },
  { id: 'micro', label: 'Mikrostruktura', short: 'Mikro', icon: <Activity className="w-4 h-4" /> },
  { id: 'sources', label: 'Źródła', short: 'Źródła', icon: <Database className="w-4 h-4" /> },
];

const STATUS_TONE: Record<string, BadgeTone> = { LIVE: 'live', STALE: 'stale', SYNTH: 'stale', PAUSED: 'neutral' };
const STATUS_TITLE: Record<string, string> = {
  LIVE: 'Realne dane Hyperliquid (REST + WebSocket)',
  STALE: 'Dane nieświeże: brak synchronizacji > 30 s lub rozłączony WebSocket',
  SYNTH: 'Świece zastępcze — czekam na pierwszą synchronizację z API',
  PAUSED: 'Strumień wstrzymany',
};

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
            <span aria-hidden="true">{changePct >= 0 ? '▲' : '▼'}</span> {Math.abs(changePct).toFixed(2)}%{' '}
            <span className="text-ink-3">{windowLabel}</span>
          </span>
        )}
      </div>
      <span className={`flex items-baseline gap-x-5 ${fresh ? '' : 'opacity-50'}`} title={fresh ? undefined : 'Ostatnia znana wartość — dane nieświeże'}>
        <Item label="Funding HL" value={t ? `${t.fundingAnnualizedPct >= 0 ? '+' : ''}${t.fundingAnnualizedPct}% APR` : DASH} />
        <Item label="OI" value={t ? fmtCompact(t.openInterestUsd, '$') : DASH} />
        <Item label="Basis" value={t ? `${t.basisBps} bps` : DASH} />
      </span>
      <Item label="PDH" value={shaakuni.pdh ? `${fmtPrice(shaakuni.pdh, 0)} · ${shaakuni.pdhStatus}` : DASH} />
      <Item label="PDL" value={shaakuni.pdl ? `${fmtPrice(shaakuni.pdl, 0)} · ${shaakuni.pdlStatus}` : DASH} />
      <Item label="Sesja" value={`${shaakuni.nySession} · ${shaakuni.nyTimeFormatted}`} />
    </div>
  );
};

const Item: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-ink-3">{label}</span>
    <span className="font-mono tabular-nums text-ink-1">{value}</span>
  </span>
);

const ViewFallback = () => <EmptyState title="Ładowanie widoku…" />;

/** Uczciwy stan startowy: zanim przyjdą realne świece, widoki zależne od danych nic nie liczą. */
const ConnectingState: React.FC<{ onRetry: () => void; startedAt: number; now: number }> = ({ onRetry, startedAt, now }) => {
  const slow = now - startedAt > 15000;
  return (
    <div className="max-w-xl mx-auto mt-10 bg-surface-1 border border-line rounded-xl p-6 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Hyperliquid</div>
      <h2 className="font-display text-lg font-semibold">Łączenie z danymi rynkowymi…</h2>
      <p className="text-sm text-ink-2 leading-relaxed">
        Desk nie pokazuje danych zastępczych — wykres, metryki i Analizator planu pojawią się po pierwszej udanej synchronizacji z publicznym API Hyperliquid.
      </p>
      {slow && (
        <p className="text-sm text-warn leading-relaxed">
          To trwa dłużej niż zwykle. Sprawdź połączenie lub rozszerzenia blokujące żądania do api.hyperliquid.xyz.
        </p>
      )}
      <div>
        <button type="button" onClick={onRetry} className="min-h-11 px-4 rounded-lg bg-surface-3 border border-line-strong text-sm font-medium hover:bg-surface-2">
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
};

const NEEDS_BARS: ViewId[] = ['desk', 'plan', 'lab', 'micro'];

/** Powłoka aplikacji: nawigacja (górna na desktopie, dolna na telefonie), status danych, przejścia widoków. */
export const AppShell: React.FC = () => {
  const { view, setView, feed, audioEnabled, setAudioEnabled } = useDesk();
  const reduce = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const moreRef = useRef<HTMLDivElement>(null);
  const transition = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : VIEW_TRANSITION;
  const awaitingData = feed.bars.length === 0 && NEEDS_BARS.includes(view);

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
        <div className="flex items-center justify-between gap-4 px-4 lg:px-6 h-14">
          <a
            href="#desk"
            onClick={(e) => {
              e.preventDefault();
              setView('desk');
            }}
            className="flex items-baseline gap-2 shrink-0"
          >
            <span className="font-display text-lg font-bold tracking-tight">HyperQuant</span>
            <span className="hidden sm:inline text-[11px] text-ink-3">BTC · Hyperliquid</span>
          </a>

          <nav aria-label="Główna" className="hidden lg:flex items-center gap-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                aria-current={view === n.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setView(n.id);
                }}
                className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
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
                <span className="relative">{n.label}</span>
              </a>
            ))}
            {/* Blog to osobne statyczne strony (SEO, podgląd linków), nie widok aplikacji */}
            <a href="./blog/" className="px-3 py-2 rounded-lg text-sm font-medium text-ink-3 hover:text-ink-1 transition-colors duration-150">
              Blog
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
              {feed.dataStatus}
            </Badge>
            <div className="hidden md:block">
              <Segmented<number> ariaLabel="Interwał" value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
            </div>
            <IconBtn label={feed.isStreaming ? 'Wstrzymaj strumień' : 'Wznów strumień'} onClick={() => feed.setIsStreaming(!feed.isStreaming)}>
              {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </IconBtn>
            <IconBtn label="Synchronizuj teraz" onClick={feed.syncNow} className="hidden sm:inline-flex">
              <RefreshCw className="w-4 h-4" />
            </IconBtn>
            <IconBtn label={audioEnabled ? 'Wycisz dźwięk taśmy' : 'Włącz dźwięk taśmy'} onClick={() => setAudioEnabled(!audioEnabled)} className="hidden sm:inline-flex">
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </IconBtn>
            <InstallButton compact />
          </div>
        </div>
        <TickerStrip />
        <div className="md:hidden px-4 py-2 border-b border-line overflow-x-auto">
          <Segmented<number> ariaLabel="Interwał" value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 py-4 pb-28 lg:pb-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} {...transition}>
            <Suspense fallback={<ViewFallback />}>
              {awaitingData && <ConnectingState onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />}
              {!awaitingData && view === 'desk' && <DeskView />}
              {!awaitingData && view === 'plan' && <PlanView />}
              {view === 'market' && <MarketView />}
              {!awaitingData && view === 'lab' && <LabView />}
              {!awaitingData && view === 'micro' && <MicroView />}
              {view === 'sources' && <SourcesView />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Dolna nawigacja (telefon) */}
      <nav aria-label="Główna (telefon)" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-1/95 backdrop-blur border-t border-line pb-safe">
        <div ref={moreRef}>
        <div className="grid grid-cols-5">
          {NAV.slice(0, 4).map((n) => (
            <TabBtn key={n.id} active={view === n.id} label={n.short} icon={n.icon} onClick={() => setView(n.id)} />
          ))}
          <TabBtn
            active={view === 'micro' || view === 'sources'}
            label="Więcej"
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
                Blog
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
