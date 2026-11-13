import React, { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Bot,
  ChartCandlestick,
  Database,
  FlaskConical,
  GraduationCap,
  History,
  ListChecks,
  MoreHorizontal,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Sunrise,
  Sunset,
  Table2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PhaseId } from '../charts/pro/chart/stations';
import { useDesk } from '../state/DeskContext';
import { PHASE_VIEW, subscribeHash } from '../state/route';
import { ViewId } from '../state/types';
import { awaitingBars } from '../state/viewNeeds';
import { AnimatedNumber, Badge, BadgeTone, EmptyState, Segmented, VIEW_TRANSITION, fmtCompact, fmtPrice, numLang, DASH, fmtNum } from '../ui';
import { InstallButton } from './InstallButton';
import { ConnectingState } from './ConnectingState';
import { Lang, lang, setLang, tr } from '../i18n';
import { levelStatusLabel } from '../utils/shaakuniEngine';
import { sessionNameAt } from '../utils/sessionNames';

// Widoki ładowane leniwie (mniejszy pierwszy bundle; wykresy faz w osobnym pakiecie)
const BeforeView = lazy(() => import('../views/BeforeView'));
const SessionView = lazy(() => import('../views/SessionView'));
const AfterView = lazy(() => import('../views/AfterView'));
const ResearchView = lazy(() => import('../views/ResearchView'));
const LessonsView = lazy(() => import('../views/LessonsView'));
const SourcesView = lazy(() => import('../views/SourcesView'));
const AgentsView = lazy(() => import('../views/agents/AgentsView'));
const MarketsView = lazy(() => import('../views/MarketsView'));

type NavItem = { id: ViewId; label: string; icon: React.ReactNode };

/** Pasek główny: trzy fazy dnia tradera (obok Blog jako osobne strony, Agenci AI i menu „Więcej”). */
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

/**
 * Agenci AI: na desktopie od 1440 px w pasku (po Blogu), węższy ekran i telefon — menu „Więcej” (dolny pasek zostaje:
 * trzy fazy i „Więcej”).
 */
const AGENTS: NavItem = { id: 'agents', label: tr('Agenci AI', 'AI agents'), icon: <Bot className="w-4 h-4" /> };

/** Rynki (tabela rynków z rejestru): na desktopie w pasku zaraz po fazach dnia, na telefonie w menu „Więcej”. */
const MARKETS: NavItem = { id: 'markets', label: tr('Rynki', 'Markets'), icon: <Table2 className="w-4 h-4" /> };

/** Stopka: Lekcje i Źródła (Blog i Agenci AI za nimi). */
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
// „Co nowego”: statyczna strona historii zmian w obu językach (co-nowego/, en/whats-new/)
const NEWS_LABEL = tr('Co nowego', 'What’s new');
// „Wyniki”: statyczna strona rozliczenia dziennika prognoz (wyniki/, en/results/)
const RESULTS_LABEL = tr('Wyniki', 'Results');

const TIMEFRAMES = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 14400, label: '4h' },
];

/** Liczby rynku z nagłówka: wartości i ich etykiety (pełne w podpowiedzi ceny, część w samym nagłówku). */
function useTicker() {
  const { feed, shaakuni } = useDesk();
  const t = feed.backendTelemetry;
  const first = feed.bars[0]?.open;
  const changePct = first && Number.isFinite(feed.currentPrice) ? ((feed.currentPrice - first) / first) * 100 : null;
  const windowH = (feed.bars.length * feed.timeframeSec) / 3600;
  const windowLabel = windowH > 48 ? `${Math.round(windowH / 24)}d` : `${Math.round(windowH)}h`;
  return {
    price: feed.currentPrice,
    changePct,
    windowLabel,
    // Wartości z ostatniej telemetrii przy nieświeżych danych są przygaszone (nie udają bieżących)
    fresh: feed.dataStatus === 'LIVE',
    funding: t ? `${t.fundingAnnualizedPct >= 0 ? '+' : ''}${fmtNum(t.fundingAnnualizedPct)}% APR` : DASH,
    oi: t ? fmtCompact(t.openInterestUsd, '$') : DASH,
    basis: t ? `${fmtNum(t.basisBps)} bps` : DASH,
    pdh: shaakuni.pdh ? fmtPrice(shaakuni.pdh, 0) : DASH,
    pdhStatus: shaakuni.pdh ? levelStatusLabel(shaakuni.pdhStatus) : '',
    pdl: shaakuni.pdl ? fmtPrice(shaakuni.pdl, 0) : DASH,
    pdlStatus: shaakuni.pdl ? levelStatusLabel(shaakuni.pdlStatus) : '',
    // Sesja dnia tradera (§7.11), te same granice co nagłówki W sesji i Po sesji; godzina NY bez zmian
    session: `${sessionNameAt(feed.nowTick)} · ${shaakuni.nyTimeFormatted}`,
  };
}

const STALE_TITLE = tr('Ostatnia znana wartość — dane nieświeże', 'Last known value, data is stale');

const Change: React.FC<{ pct: number | null; span: string }> = ({ pct, span }) =>
  pct === null ? null : (
    <span className={`whitespace-nowrap ${pct >= 0 ? 'text-buy-ink' : 'text-sell-ink'}`}>
      <span aria-hidden="true">{pct >= 0 ? '▲' : '▼'}</span> {numLang(Math.abs(pct).toFixed(2))}% <span className="text-ink-3">{span}</span>
    </span>
  );

/**
 * Cena z rozwinięciem: kliknięcie (dotknięcie) pokazuje wszystkie liczby rynku — także te, które na węższym ekranie nie
 * mieszczą się w nagłówku (basis, PDH, PDL z ich stanem, sesja).
 */
const PriceButton: React.FC<{ small?: boolean }> = ({ small = false }) => {
  const k = useTicker();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useMenuDismiss(open, setOpen, ref, btn);
  const rows: [string, string][] = [
    ['Funding HL', k.funding],
    ['OI', k.oi],
    ['Basis', k.basis],
    ['PDH', `${k.pdh}${k.pdhStatus ? ` · ${k.pdhStatus}` : ''}`],
    ['PDL', `${k.pdl}${k.pdlStatus ? ` · ${k.pdlStatus}` : ''}`],
    [tr('Sesja', 'Session'), k.session],
  ];
  return (
    <div ref={ref} className="relative min-w-0 shrink-0">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={tr('BTC-PERP: liczby rynku (funding, OI, basis, PDH, PDL, sesja)', 'BTC-PERP: market numbers (funding, OI, basis, PDH, PDL, session)')}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-baseline gap-2 min-w-0 rounded-lg px-1.5 -mx-1.5 ${small ? 'min-h-11 items-center' : 'py-1'} hover:bg-surface-2 transition-colors duration-150 text-xs`}
      >
        <span className={`text-ink-2 font-medium ${small ? 'hidden min-[400px]:inline' : ''}`}>BTC-PERP</span>
        <AnimatedNumber value={k.price} format={(v) => fmtPrice(v)} className={`${small ? 'text-base' : 'text-lg'} font-semibold text-ink-1`} />
        <Change pct={k.changePct} span={k.windowLabel} />
      </button>
      {open && (
        <div id={id} data-more-item="" tabIndex={-1} className="absolute left-0 top-full mt-2 z-40 w-72 max-w-[calc(100vw-24px)] bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl text-xs outline-none">
          <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 ${k.fresh ? '' : 'opacity-60'}`}>
            {rows.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-ink-3">{label}</dt>
                <dd className="font-mono tabular-nums text-ink-1">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
          {!k.fresh && <p className="mt-2 text-[11px] text-ink-3">{STALE_TITLE}</p>}
          <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
            {tr('Hyperliquid (REST + WebSocket); PDH i PDL z poprzedniego dnia UTC.', 'Hyperliquid (REST + WebSocket); PDH and PDL from the previous UTC day.')}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Liczby rynku w rzędzie nagłówka (komputer, od 1024 px): menu z lewej, liczby z prawej. Węższy ekran chowa najpierw
 * sesję i basis, potem PDH i PDL (wszystkie zostają w rozwinięciu ceny; stan PDH i PDL jest w podpowiedzi). Liczba, która
 * i tak nie mieści się w całości (wąski ekran, dłuższe etykiety po angielsku), znika cała razem z dalszymi, zamiast być
 * ucięta w pół słowa (`useWholeItems`).
 */
const TickerInline: React.FC = () => {
  const k = useTicker();
  const ref = useRef<HTMLDivElement>(null);
  useWholeItems(ref);
  return (
    <div ref={ref} data-header-ticker className="flex items-center gap-x-4 min-w-0 overflow-hidden whitespace-nowrap text-xs">
      <PriceButton />
      <span className={`flex items-baseline gap-x-4 ${k.fresh ? '' : 'opacity-50'}`} title={k.fresh ? undefined : STALE_TITLE}>
        <Item label="Funding" value={k.funding} title="Funding HL" />
        <Item label="OI" value={k.oi} />
        <Item label="Basis" value={k.basis} className="hidden min-[1680px]:flex" />
      </span>
      <Item label="PDH" value={k.pdh} title={k.pdhStatus} className="hidden min-[1400px]:flex" />
      <Item label="PDL" value={k.pdl} title={k.pdlStatus} className="hidden min-[1400px]:flex" />
      <Item label={tr('Sesja', 'Session')} value={k.session} className="hidden min-[1560px]:flex" />
    </div>
  );
};

/**
 * Pozycje `[data-ticker-item]` kontenera z `overflow-hidden`: pierwsza, która wystaje poza prawą krawędź, i wszystkie
 * za nią są niewidoczne (`visibility`, bez zmiany układu, więc bez pętli pomiaru). Liczone przy każdej zmianie rozmiaru
 * kontenera i pozycji (nowa wartość liczby zmienia jej szerokość).
 */
function useWholeItems(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const right = box.getBoundingClientRect().right + 0.5;
      let cut = false;
      for (const el of box.querySelectorAll<HTMLElement>('[data-ticker-item]')) {
        if (el.offsetParent === null) continue;
        cut ||= el.getBoundingClientRect().right > right;
        el.style.visibility = cut ? 'hidden' : '';
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    box.querySelectorAll('[data-ticker-item]').forEach((el) => ro.observe(el));
    fit();
    return () => ro.disconnect();
  }, [ref]);
}

/** Pasek ceny i kontekstu w osobnym rzędzie (tablet, 640–1023 px). */
const TickerStrip: React.FC = () => {
  const k = useTicker();
  return (
    <div className="flex items-center gap-x-5 gap-y-1 overflow-x-auto hq-scroll-cue [--cue-bg:color-mix(in_oklab,var(--color-surface-1)_60%,var(--color-page))] whitespace-nowrap px-4 lg:px-6 py-2 border-b border-line bg-surface-1/60 text-xs">
      <PriceButton />
      <span className={`flex items-baseline gap-x-5 ${k.fresh ? '' : 'opacity-50'}`} title={k.fresh ? undefined : STALE_TITLE}>
        <Item label="Funding HL" value={k.funding} />
        <Item label="OI" value={k.oi} />
        <Item label="Basis" value={k.basis} />
      </span>
      <Item label="PDH" value={`${k.pdh}${k.pdhStatus ? ` · ${k.pdhStatus}` : ''}`} />
      <Item label="PDL" value={`${k.pdl}${k.pdlStatus ? ` · ${k.pdlStatus}` : ''}`} />
      <Item label={tr('Sesja', 'Session')} value={k.session} />
    </div>
  );
};

/** Powtórka w W sesji (#charts?replay=history|lessons…) pokazuje przeszłość — wtedy bez paska ceny na żywo (jak parseReplayLink). */
const inReplay = () => {
  const h = window.location.hash;
  const src = h.startsWith('#charts') ? new URLSearchParams(h.split('?')[1] ?? '').get('replay') : null;
  return src === 'history' || src === 'lessons';
};

const Item: React.FC<{ label: string; value: string; title?: string; className?: string }> = ({ label, value, title, className = 'flex' }) => (
  <span data-ticker-item className={`${className} items-baseline gap-1.5`} title={title || undefined}>
    <span className="text-ink-3">{label}</span>
    <span className="font-mono tabular-nums text-ink-1">{value}</span>
  </span>
);

const ViewFallback = () => <EmptyState title={tr('Ładowanie widoku…', 'Loading view…')} />;

// Bez globalnego przełącznika interwału: widoki z własnymi interwałami (wykresy faz dnia, Lekcje) i bez wykresów (Agenci AI)
const OWN_INTERVALS: ViewId[] = ['before', 'charts', 'after', 'lessons', 'agents', 'markets'];

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

// Węższe pozycje poniżej 1440 px: z Rynkami pasek mieści się także po angielsku, z widokiem z menu i najszerszym
// stanem danych (PAUSED); od 1440 px odstępy jak wcześniej i Agenci AI w pasku
const navLink = (active: boolean) =>
  `relative px-1.5 xl:px-2 min-[1440px]:px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-150 ${active ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1'}`;

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
      <header ref={headerRef} data-app-header className="pt-safe sticky top-0 z-30 bg-page/95 backdrop-blur border-b border-line">
        <div className="flex items-center justify-between gap-3 xl:gap-4 px-4 lg:px-6 h-14">
          <ViewLink id="charts" go={go} className="flex items-baseline gap-2 shrink-0">
            <span className="font-display text-lg font-bold tracking-tight">HyperQuant</span>
            <span className="hidden sm:inline lg:hidden 2xl:inline text-[11px] text-ink-3">BTC · Hyperliquid</span>
          </ViewLink>

          {/* Telefon: jeden rząd — logo, cena i zmiana (pozostałe liczby rynku po dotknięciu ceny) */}
          {!(replay && view === 'charts') && (
            <div className="sm:hidden flex-1 min-w-0 flex justify-end">
              <PriceButton small />
            </div>
          )}

          <nav aria-label={tr('Główna', 'Main')} className="hidden lg:flex items-center gap-0.5 xl:gap-1">
            {PHASES.map((n) => (
              <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} className={navLink(view === n.id)}>
                {view === n.id && <ActivePill />}
                <span className="relative">{n.label}</span>
              </ViewLink>
            ))}
            <ViewLink id={MARKETS.id} go={go} current={view === MARKETS.id} className={navLink(view === MARKETS.id)}>
              {view === MARKETS.id && <ActivePill />}
              <span className="relative">{MARKETS.label}</span>
            </ViewLink>
            {/* Blog to osobne statyczne strony (SEO, podgląd linków), nie widok aplikacji */}
            <a href="./blog/" className={navLink(false)}>
              {BLOG_LABEL}
            </a>
            {/* Wyniki i Co nowego w pasku od xl (1280 px); węższy ekran: menu „Więcej”, żeby nie ucinać ceny w nagłówku */}
            <a href={tr('./wyniki/', './en/results/')} className={`${navLink(false)} hidden xl:inline`}>
              {RESULTS_LABEL}
            </a>
            <a href={tr('./co-nowego/', './en/whats-new/')} className={`${navLink(false)} hidden xl:inline`}>
              {NEWS_LABEL}
            </a>
            {/* Agenci AI w pasku od 1440 px; węższy ekran: menu „Więcej” (miejsce na Rynki bez ucinania ceny w nagłówku) */}
            <ViewLink id={AGENTS.id} go={go} current={view === AGENTS.id} className={`${navLink(view === AGENTS.id)} hidden min-[1440px]:inline`}>
              {view === AGENTS.id && <ActivePill />}
              <span className="relative">{AGENTS.label}</span>
            </ViewLink>
            <div ref={topMoreRef} className="relative">
              <button
                ref={topMoreBtn}
                type="button"
                aria-expanded={topMore}
                // Menu jest w dokumencie tylko otwarte
                aria-controls={topMore ? topMoreId : undefined}
                onClick={() => setTopMore((o) => !o)}
                className={`${navLink(!!moreView)} inline-flex items-center gap-1.5`}
              >
                {moreView && <ActivePill />}
                {/* Widok z menu na ekranie: jego nazwa przy „Więcej”; poniżej 1440 px sama nazwa (miejsce na Agentów AI), „Więcej ·” dla czytnika ekranu */}
                <span className="relative">
                  {moreView ? (
                    <>
                      <span className="sr-only min-[1440px]:not-sr-only">{tr('Więcej', 'More')} · </span>
                      {moreView.label}
                    </>
                  ) : view === AGENTS.id ? (
                    // Agenci AI poniżej 1440 px są w menu: nazwa widoku przy „Więcej”, od 1440 px sama „Więcej” (Agenci w pasku)
                    <>
                      <span className="min-[1440px]:hidden">
                        <span className="sr-only">{tr('Więcej', 'More')} · </span>
                        {AGENTS.label}
                      </span>
                      <span className="hidden min-[1440px]:inline">{tr('Więcej', 'More')}</span>
                    </>
                  ) : (
                    tr('Więcej', 'More')
                  )}
                </span>
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
                    {/* Poniżej xl Wyniki i Co nowego są tutaj zamiast w pasku */}
                    <a href={tr('./wyniki/', './en/results/')} className={`${MENU_ITEM} xl:hidden`}>
                      <ListChecks className="w-4 h-4" />
                      {RESULTS_LABEL}
                    </a>
                    <a href={tr('./co-nowego/', './en/whats-new/')} className={`${MENU_ITEM} xl:hidden`}>
                      <History className="w-4 h-4" />
                      {NEWS_LABEL}
                    </a>
                    {/* Poniżej 1440 px Agenci AI są tutaj zamiast w pasku */}
                    <ViewLink id={AGENTS.id} go={go} current={view === AGENTS.id} more className={`${MENU_ITEM} min-[1440px]:hidden`}>
                      {AGENTS.icon}
                      {AGENTS.label}
                    </ViewLink>
                    {/* Rzadko używane przełączniki nagłówka: język, synchronizacja, dźwięk taśmy (nagłówek ma miejsce na liczby rynku) */}
                    <div role="separator" className="my-1 border-t border-line" />
                    <ShellToggles audioEnabled={audioEnabled} setAudioEnabled={setAudioEnabled} onSync={feed.syncNow} onDone={() => setTopMore(false)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </nav>

          {/* Liczby rynku w tym samym rzędzie co menu (komputer); w powtórce bez ceny na żywo */}
          {!(replay && view === 'charts') && (
            <div className="hidden lg:flex flex-1 min-w-0 justify-end">
              <TickerInline />
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block lg:hidden">
              <Segmented<Lang> ariaLabel={tr('Język', 'Language')} size="xs" value={lang} onChange={setLang} options={LANGS} />
            </div>
            <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
              {feed.dataStatus}
            </Badge>
            {/* Wykresy faz dnia i Lekcje mają własne interwały — globalny przełącznik dotyczy pozostałych widoków */}
            {!OWN_INTERVALS.includes(view) && (
              <div className="hidden md:block lg:hidden xl:block">
                <Segmented<number> ariaLabel={tr('Interwał', 'Timeframe')} value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
              </div>
            )}
            <IconBtn label={feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')} onClick={() => feed.setIsStreaming(!feed.isStreaming)} className="hidden sm:inline-flex">
              {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </IconBtn>
            <IconBtn label={tr('Synchronizuj teraz', 'Sync now')} onClick={feed.syncNow} className="hidden sm:inline-flex lg:hidden">
              <RefreshCw className="w-4 h-4" />
            </IconBtn>
            <IconBtn label={audioEnabled ? tr('Wycisz dźwięk taśmy', 'Mute tape sound') : tr('Włącz dźwięk taśmy', 'Unmute tape sound')} onClick={() => setAudioEnabled(!audioEnabled)} className="hidden sm:inline-flex lg:hidden">
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </IconBtn>
            <div className="hidden sm:contents">
              <InstallButton compact />
            </div>
          </div>
        </div>
        {!(replay && view === 'charts') && (
          <div className="hidden sm:block lg:hidden">
            <TickerStrip />
          </div>
        )}
        {!OWN_INTERVALS.includes(view) && (
          <div className="md:hidden lg:block xl:hidden px-4 py-2 border-b border-line overflow-x-auto">
            <Segmented<number> ariaLabel={tr('Interwał', 'Timeframe')} value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 pt-4 pb-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} data-view-root {...transition}>
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
                  {view === 'agents' && <AgentsView />}
                  {view === 'markets' && <MarketsView />}
                </>
              )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Stopka: Lekcje, Źródła, Blog i Agenci AI; na telefonie nad dolnym paskiem */}
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
          {/* Statyczna strona rozliczenia dziennika prognoz (scripts/blog/results.mjs) */}
          <a href={tr('./wyniki/', './en/results/')} className="inline-flex items-center min-h-11 hover:text-ink-1 transition-colors duration-150">
            {tr('Wyniki prognoz', 'Forecast results')}
          </a>
          {/* Statyczna strona historii zmian z CHANGELOG.md (scripts/blog/whatsnew.mjs) */}
          <a href={tr('./co-nowego/', './en/whats-new/')} className="inline-flex items-center min-h-11 hover:text-ink-1 transition-colors duration-150">
            {tr('Co nowego', "What's new")}
          </a>
          <ViewLink id={AGENTS.id} go={go} current={view === AGENTS.id} className="inline-flex items-center min-h-11 hover:text-ink-1 transition-colors duration-150">
            {AGENTS.label}
          </ViewLink>
          {/* Źródło danych, silnik wykresów (link wymagany licencją Lightweight Charts™) i strefa czasu wykresów */}
          <span className="inline-flex flex-wrap items-center gap-x-1.5 min-h-11 sm:ml-auto">
            {tr('Dane', 'Data')}: Hyperliquid · {tr('Wykresy', 'Charts')}:{' '}
            <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-ink-1">
              TradingView Lightweight Charts™
            </a>
            <span>· {tr('czas lokalny', 'local time')} {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          </span>
        </nav>
      </footer>

      {/* Dolna nawigacja (telefon): trzy fazy dnia i „Więcej” */}
      <nav data-app-nav aria-label={tr('Główna (telefon)', 'Main (phone)')} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-1/95 backdrop-blur border-t border-line pb-safe">
        <div ref={phoneMoreRef}>
          <div className="grid grid-cols-4">
            {PHASES.map((n) => (
              <TabBtn key={n.id} active={view === n.id} label={n.label} icon={n.icon} onClick={() => go(n.id)} />
            ))}
            <TabBtn
              btnRef={phoneMoreBtn}
              // Na telefonie Rynki i Agenci AI są w menu „Więcej”
              active={!!moreView || view === AGENTS.id || view === MARKETS.id}
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
                <ViewLink id={MARKETS.id} go={go} current={view === MARKETS.id} more className={MENU_ITEM}>
                  {MARKETS.icon}
                  {MARKETS.label}
                </ViewLink>
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
                <a href={tr('./wyniki/', './en/results/')} className={MENU_ITEM}>
                  <ListChecks className="w-4 h-4" />
                  {RESULTS_LABEL}
                </a>
                <a href={tr('./co-nowego/', './en/whats-new/')} className={MENU_ITEM}>
                  <History className="w-4 h-4" />
                  {NEWS_LABEL}
                </a>
                <ViewLink id={AGENTS.id} go={go} current={view === AGENTS.id} more className={MENU_ITEM}>
                  {AGENTS.icon}
                  {AGENTS.label}
                </ViewLink>
                {/* Telefon: przełączniki z nagłówka (nagłówek ma jeden rząd: logo, cena, zmiana) */}
                <div role="separator" className="my-1 border-t border-line" />
                <button type="button" onClick={() => feed.setIsStreaming(!feed.isStreaming)} className={MENU_ITEM}>
                  {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')}
                </button>
                <ShellToggles audioEnabled={audioEnabled} setAudioEnabled={setAudioEnabled} onSync={feed.syncNow} onDone={() => setPhoneMore(false)} />
                <div className="sm:hidden px-1.5">
                  <InstallButton />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>
    </div>
  );
};

/** Pozycje menu „Więcej”: język (PL / EN), synchronizacja teraz i dźwięk taśmy. */
const ShellToggles: React.FC<{ audioEnabled: boolean; setAudioEnabled: (v: boolean) => void; onSync: () => void; onDone: () => void }> = ({
  audioEnabled,
  setAudioEnabled,
  onSync,
  onDone,
}) => (
  <>
    <div role="group" aria-label={tr('Język', 'Language')} className="flex gap-1 px-1.5 py-1">
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          aria-pressed={lang === l.value}
          title={l.title}
          onClick={() => setLang(l.value)}
          className={`flex-1 min-h-11 rounded-lg text-sm font-medium ${lang === l.value ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'}`}
        >
          {l.value === 'pl' ? 'PL · Polski' : 'EN · English'}
        </button>
      ))}
    </div>
    <button
      type="button"
      onClick={() => {
        onSync();
        onDone();
      }}
      className={MENU_ITEM}
    >
      <RefreshCw className="w-4 h-4" />
      {tr('Synchronizuj teraz', 'Sync now')}
    </button>
    <button type="button" aria-pressed={audioEnabled} onClick={() => setAudioEnabled(!audioEnabled)} className={MENU_ITEM}>
      {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      {audioEnabled ? tr('Wycisz dźwięk taśmy', 'Mute tape sound') : tr('Włącz dźwięk taśmy', 'Unmute tape sound')}
    </button>
  </>
);

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

/** Przycisk dolnego paska telefonu; z `expanded` — przycisk menu (bez aria-current, z aria-expanded, aria-controls tylko otwarte). */
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
    aria-controls={expanded ? controls : undefined}
    className={`min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent' : 'text-ink-3'}`}
  >
    {icon}
    {label}
  </button>
);
