import React, { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChartCandlestick,
  Database,
  FlaskConical,
  GraduationCap,
  MoreHorizontal,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Sunrise,
  Sunset,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PhaseId } from '../charts/pro/chart/stations';
import { useDesk } from '../state/DeskContext';
import { PHASE_VIEW } from '../state/route';
import { ViewId } from '../state/types';
import { awaitingBars } from '../state/viewNeeds';
import { AnimatedNumber, Badge, BadgeTone, EmptyState, Segmented, VIEW_TRANSITION, fmtCompact, fmtPrice, numLang, DASH, fmtNum } from '../ui';
import { InstallButton } from './InstallButton';
import { ConnectingState } from './ConnectingState';
import { Lang, lang, setLang, tr } from '../i18n';
import { levelStatusLabel, sessionLabel } from '../utils/shaakuniEngine';

// Widoki ładowane leniwie (mniejszy pierwszy bundle; wykresy faz w osobnym pakiecie)
const BeforeView = lazy(() => import('../views/BeforeView'));
const SessionView = lazy(() => import('../views/SessionView'));
const AfterView = lazy(() => import('../views/AfterView'));
const ResearchView = lazy(() => import('../views/ResearchView'));
const LessonsView = lazy(() => import('../views/LessonsView'));
const SourcesView = lazy(() => import('../views/SourcesView'));

type NavItem = { id: ViewId; label: string; icon: React.ReactNode };

/** Pasek główny: trzy fazy dnia tradera (obok Blog jako osobne strony i menu „Więcej”). */
const PHASES: NavItem[] = [
  { id: 'before', label: tr('Przed sesją', 'Pre-session'), icon: <Sunrise className="w-4 h-4" /> },
  { id: 'charts', label: tr('W sesji', 'In session'), icon: <ChartCandlestick className="w-4 h-4" /> },
  { id: 'after', label: tr('Po sesji', 'Post-session'), icon: <Sunset className="w-4 h-4" /> },
];

/** Menu „Więcej”: widoki poza tokiem dnia (Lekcje i Źródła także w stopce). */
const MORE: NavItem[] = [
  { id: 'lessons', label: tr('Lekcje', 'Lessons'), icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'research', label: tr('Badania', 'Research'), icon: <FlaskConical className="w-4 h-4" /> },
  { id: 'sources', label: tr('Źródła', 'Sources'), icon: <Database className="w-4 h-4" /> },
];

/** Stopka: Lekcje i Źródła (Blog obok jako osobne strony). */
const FOOTER = MORE.filter((n) => n.id !== 'research');

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
    <div className="flex items-center gap-x-5 gap-y-1 overflow-x-auto hq-scroll-cue [--cue-bg:color-mix(in_oklab,var(--color-surface-1)_60%,var(--color-page))] whitespace-nowrap px-4 lg:px-6 py-2 border-b border-line bg-surface-1/60 text-xs">
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
      <Item label="PDH" value={shaakuni.pdh ? `${fmtPrice(shaakuni.pdh, 0)} · ${levelStatusLabel(shaakuni.pdhStatus)}` : DASH} />
      <Item label="PDL" value={shaakuni.pdl ? `${fmtPrice(shaakuni.pdl, 0)} · ${levelStatusLabel(shaakuni.pdlStatus)}` : DASH} />
      <Item label={tr('Sesja', 'Session')} value={`${sessionLabel(shaakuni.nySession)} · ${shaakuni.nyTimeFormatted}`} />
    </div>
  );
};

const subscribeHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};
/** Powtórka w W sesji (#charts?replay=history|lessons…) pokazuje przeszłość — wtedy bez paska ceny na żywo (jak parseReplayLink). */
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

// Widoki z własnymi interwałami (wykresy faz dnia, Lekcje): bez globalnego przełącznika interwału
const OWN_INTERVALS: ViewId[] = ['before', 'charts', 'after', 'lessons'];

/** Zmienna CSS z wysokością przypiętego nagłówka aplikacji (px); widoki używają jej w klasie `top-[var(--hq-header-h,0px)]`. */
const HEADER_H_VAR = '--hq-header-h';

/**
 * Zamykanie menu „Więcej”: Escape (fokus wraca na przycisk) i kliknięcie poza `ref`; po otwarciu fokus na pierwszej
 * pozycji.
 */
function useMenuDismiss(
  open: boolean,
  setOpen: (v: boolean) => void,
  ref: React.RefObject<HTMLElement | null>,
  button: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    ref.current?.querySelector<HTMLElement>('[data-more-item]')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, setOpen, ref, button]);
}

/** Link do widoku aplikacji (#id): zwykłe kliknięcie przełącza widok bez przeładowania, z klawiszem albo środkowe otwiera nową kartę. */
const ViewLink: React.FC<{ id: ViewId; go: (v: ViewId) => void; current?: boolean; more?: boolean; className: string; children: React.ReactNode }> = ({
  id,
  go,
  current,
  more,
  className,
  children,
}) => (
  <a
    href={`#${id}`}
    aria-current={current ? 'page' : undefined}
    data-more-item={more ? '' : undefined}
    onClick={(e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(id);
    }}
    className={className}
  >
    {children}
  </a>
);

const MENU_ITEM = 'w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3';
const MENU_PANEL = 'w-56 bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl';
const MENU_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const navLink = (active: boolean) =>
  `relative px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-150 ${active ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1'}`;

/** Tło aktywnej pozycji paska (przesuwa się między pozycjami). */
const ActivePill = () => (
  <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-surface-2 border border-line" transition={{ type: 'spring', stiffness: 260, damping: 26 }} />
);

/** Powłoka aplikacji: nawigacja (górna na desktopie, dolna na telefonie), status danych, przejścia widoków, stopka. */
export const AppShell: React.FC = () => {
  const { view, setView, feed, audioEnabled, setAudioEnabled } = useDesk();
  const reduce = useReducedMotion();
  const [topMore, setTopMore] = useState(false);
  const [phoneMore, setPhoneMore] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const topMoreRef = useRef<HTMLDivElement>(null);
  const topMoreBtn = useRef<HTMLButtonElement>(null);
  const phoneMoreRef = useRef<HTMLDivElement>(null);
  const phoneMoreBtn = useRef<HTMLButtonElement>(null);
  const topMoreId = useId();
  const phoneMoreId = useId();
  const transition = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : VIEW_TRANSITION;
  // Badania do pierwszych świec pokazują stan „łączenie” (viewNeeds.ts); pas kontekstu Przed sesją czeka w BeforeView
  const awaitingData = awaitingBars(view, feed.bars.length);
  const replay = useSyncExternalStore(subscribeHash, inReplay);
  const moreView = MORE.find((n) => n.id === view);
  // Karta układu innej fazy w Wykresach (Alt+1…6, nowa karta) przenosi do ekranu tej fazy
  const onPhase = useCallback((p: PhaseId) => setView(PHASE_VIEW[p]), [setView]);
  /** Przejście do widoku z paska albo menu (menu się zamyka). */
  const go = useCallback(
    (v: ViewId) => {
      setView(v);
      setTopMore(false);
      setPhoneMore(false);
    },
    [setView]
  );

  useMenuDismiss(topMore, setTopMore, topMoreRef, topMoreBtn);
  useMenuDismiss(phoneMore, setPhoneMore, phoneMoreRef, phoneMoreBtn);

  // Wysokość przypiętego nagłówka (pasek, ceny, bezpieczna strefa) jako zmienna CSS: elementy przypinane w widokach
  // (pasek Pulse na telefonie) stają pod nim, nie pod nim schowane
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty(HEADER_H_VAR, `${el.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => {
      ro.disconnect();
      root.style.removeProperty(HEADER_H_VAR);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-page text-ink-1 flex flex-col">
      <header ref={headerRef} className="pt-safe sticky top-0 z-30 bg-page/95 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between gap-3 xl:gap-4 px-4 lg:px-6 h-14">
          <ViewLink id="charts" go={go} className="flex items-baseline gap-2 shrink-0">
            <span className="font-display text-lg font-bold tracking-tight">HyperQuant</span>
            <span className="hidden sm:inline lg:hidden 2xl:inline text-[11px] text-ink-3">BTC · Hyperliquid</span>
          </ViewLink>

          <nav aria-label={tr('Główna', 'Main')} className="hidden lg:flex items-center gap-1">
            {PHASES.map((n) => (
              <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} className={navLink(view === n.id)}>
                {view === n.id && <ActivePill />}
                <span className="relative">{n.label}</span>
              </ViewLink>
            ))}
            {/* Blog to osobne statyczne strony (SEO, podgląd linków), nie widok aplikacji */}
            <a href="./blog/" className={navLink(false)}>
              {BLOG_LABEL}
            </a>
            <div ref={topMoreRef} className="relative">
              <button
                ref={topMoreBtn}
                type="button"
                aria-expanded={topMore}
                aria-controls={topMoreId}
                onClick={() => setTopMore((o) => !o)}
                className={`${navLink(!!moreView)} inline-flex items-center gap-1.5`}
              >
                {moreView && <ActivePill />}
                {/* Widok z menu na ekranie: jego nazwa przy „Więcej” */}
                <span className="relative">{moreView ? `${tr('Więcej', 'More')} · ${moreView.label}` : tr('Więcej', 'More')}</span>
                <MoreHorizontal className="relative w-4 h-4" aria-hidden="true" />
              </button>
              <AnimatePresence>
                {topMore && (
                  <motion.div id={topMoreId} {...MENU_MOTION} className={`absolute top-full right-0 mt-2 z-40 ${MENU_PANEL}`}>
                    {MORE.map((n) => (
                      <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} more className={MENU_ITEM}>
                        {n.icon}
                        {n.label}
                      </ViewLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Segmented<Lang> ariaLabel={tr('Język', 'Language')} size="xs" value={lang} onChange={setLang} options={LANGS} />
            <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
              {feed.dataStatus}
            </Badge>
            {/* Wykresy faz dnia i Lekcje mają własne interwały — globalny przełącznik dotyczy pozostałych widoków */}
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

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 pt-4 pb-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} {...transition}>
            <Suspense fallback={<ViewFallback />}>
              {awaitingData ? (
                <ConnectingState onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />
              ) : (
                <>
                  {view === 'before' && <BeforeView onPhase={onPhase} />}
                  {view === 'charts' && <SessionView onPhase={onPhase} />}
                  {view === 'after' && <AfterView onPhase={onPhase} />}
                  {view === 'research' && <ResearchView />}
                  {view === 'lessons' && <LessonsView />}
                  {view === 'sources' && <SourcesView />}
                </>
              )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Stopka: Lekcje, Źródła i Blog; na telefonie nad dolnym paskiem */}
      <footer className="w-full max-w-[1920px] mx-auto px-4 lg:px-6 pb-28 lg:pb-6">
        <nav aria-label={tr('Stopka', 'Footer')} className="flex flex-wrap items-center gap-x-5 pt-2 border-t border-line text-xs text-ink-3">
          {FOOTER.map((n) => (
            <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} className="inline-flex items-center min-h-11 hover:text-ink-1 transition-colors duration-150">
              {n.label}
            </ViewLink>
          ))}
          <a href="./blog/" className="inline-flex items-center min-h-11 hover:text-ink-1 transition-colors duration-150">
            {BLOG_LABEL}
          </a>
        </nav>
      </footer>

      {/* Dolna nawigacja (telefon): trzy fazy dnia i „Więcej” */}
      <nav aria-label={tr('Główna (telefon)', 'Main (phone)')} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-1/95 backdrop-blur border-t border-line pb-safe">
        <div ref={phoneMoreRef}>
          <div className="grid grid-cols-4">
            {PHASES.map((n) => (
              <TabBtn key={n.id} active={view === n.id} label={n.label} icon={n.icon} onClick={() => go(n.id)} />
            ))}
            <TabBtn
              btnRef={phoneMoreBtn}
              active={!!moreView}
              label={tr('Więcej', 'More')}
              icon={<MoreHorizontal className="w-4 h-4" />}
              onClick={() => setPhoneMore((o) => !o)}
              expanded={phoneMore}
              controls={phoneMoreId}
            />
          </div>
          <AnimatePresence>
            {phoneMore && (
              <motion.div id={phoneMoreId} {...MENU_MOTION} className={`absolute bottom-full right-3 mb-2 ${MENU_PANEL}`}>
                {MORE.map((n) => (
                  <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} more className={MENU_ITEM}>
                    {n.icon}
                    {n.label}
                  </ViewLink>
                ))}
                <a href="./blog/" className={MENU_ITEM}>
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

// `className` niesie też sposób wyświetlania (domyślnie inline-flex): stałe inline-flex w klasie bazowej wygrywało z „hidden sm:inline-flex”,
// więc na telefonie przyciski miały być ukryte, a były widoczne i z przyciskiem instalacji nagłówek wychodził poza ekran
const IconBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className = 'inline-flex' }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`items-center justify-center w-9 h-9 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-line transition-colors duration-150 ${className}`}
  >
    {children}
  </button>
);

/** Przycisk dolnego paska telefonu; z `expanded` — przycisk menu (bez aria-current, z aria-expanded). */
const TabBtn: React.FC<{
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
  btnRef?: React.Ref<HTMLButtonElement>;
}> = ({ active, label, icon, onClick, expanded, controls, btnRef }) => (
  <button
    ref={btnRef}
    type="button"
    onClick={onClick}
    aria-current={active && expanded === undefined ? 'page' : undefined}
    aria-expanded={expanded}
    aria-controls={expanded === undefined ? undefined : controls}
    className={`min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent' : 'text-ink-3'}`}
  >
    {icon}
    {label}
  </button>
);
