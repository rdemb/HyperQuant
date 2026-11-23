import React, { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Bot,
  ChartCandlestick,
  Database,
  FlaskConical,
  GraduationCap,
  History,
  House,
  ListChecks,
  PanelsTopLeft,
  PanelLeftClose,
  ChevronRight,
  Moon,
  MoreHorizontal,
  Newspaper,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  Sunrise,
  Sunset,
  Table2,
  Rows3,
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
import { type Theme, setTheme, useTheme } from '../theme';
import { HOME_MARKET } from '../utils/marketCaps';
import { levelStatusLabel } from '../utils/shaakuniEngine';
import { NOWE_WIDOKI } from '../nowy/widoki';
import { PasekDnia } from './PasekDnia';
import { KartaModeluHost } from './KartaModeluHost';
import { dayPhase, useNow } from './dzien';
import type { Akcja } from './polecenia';
import { sessionNameAt } from '../utils/sessionNames';
import { useRules, usePaused } from './wyspa/magazyn';
import { useStraznicy } from './wyspa/useStraznicy';
import { Dok, useZaloga } from './wyspa/Dok';
import { Postac } from './wyspa/Postac';
import type { PersonaId } from './wyspa/persony';
import { deskLabels, marketLabel } from '../config/deskMarkets';
import { zainstalujSwiatloSzkla } from '../ui/swiatloSzkla';
import { zapiszNic } from './nic';

zainstalujSwiatloSzkla();

// Widoki ładowane leniwie (mniejszy pierwszy bundle; wykresy faz w osobnym pakiecie)
const DzisView = lazy(() => import('../views/DzisView'));
const BeforeView = lazy(() => import('../views/BeforeView'));
const SessionView = lazy(() => import('../views/SessionView'));
const AfterView = lazy(() => import('../views/AfterView'));
const ResearchView = lazy(() => import('../views/ResearchView'));
const LessonsView = lazy(() => import('../views/LessonsView'));
const SourcesView = lazy(() => import('../views/SourcesView'));
const AgentsView = lazy(() => import('../views/agents/AgentsView'));
const MarketsView = lazy(() => import('../views/MarketsView'));
const OrderFlowView = lazy(() => import('../views/flow/OrderFlowView'));

/** Pozycja nawigacji: widok aplikacji; `short` — krótsza nazwa w dolnym pasku telefonu. */
export type NavItem = { id: ViewId; label: string; icon: React.ReactNode; short?: string };

/** Dziś: pierwszy ekran aplikacji (doba, rynki teraz, trzy czasy dnia). */
export const DZIS: NavItem = { id: 'dzis', label: tr('Dziś', 'Today'), icon: <House className="w-4 h-4" /> };

/** Pasek główny: trzy fazy dnia tradera (obok Blog jako osobne strony, Agenci AI i menu „Więcej”). */
export const PHASES: NavItem[] = [
  { id: 'before', label: tr('Przed sesją', 'Pre-session'), icon: <Sunrise className="w-4 h-4" /> },
  { id: 'charts', label: tr('W sesji', 'In session'), icon: <ChartCandlestick className="w-4 h-4" /> },
  { id: 'after', label: tr('Po sesji', 'Post-session'), icon: <Sunset className="w-4 h-4" /> },
];

/** Menu „Więcej”: widoki poza tokiem dnia (Lekcje i Źródła także w stopce). */
export const MORE: NavItem[] = [
  { id: 'lessons', label: tr('Lekcje', 'Lessons'), icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'research', label: tr('Badania', 'Research'), icon: <FlaskConical className="w-4 h-4" /> },
  { id: 'sources', label: tr('Źródła', 'Sources'), icon: <Database className="w-4 h-4" /> },
];

/**
 * Agenci AI: na desktopie od 1440 px w pasku (po Blogu), węższy ekran i telefon — menu „Więcej” (dolny pasek zostaje:
 * trzy fazy i „Więcej”).
 */
export const AGENTS: NavItem = { id: 'agents', label: tr('Agenci AI', 'AI agents'), icon: <Bot className="w-4 h-4" /> };

/** Rynki (tabela rynków z rejestru): na desktopie w pasku zaraz po fazach dnia, na telefonie w menu „Więcej”. */
export const MARKETS: NavItem = { id: 'markets', label: tr('Rynki', 'Markets'), icon: <Table2 className="w-4 h-4" /> };
const ORDER_FLOW: NavItem = { id: 'orderflow', label: 'Order Flow', icon: <Rows3 className="w-4 h-4" /> };

export const STATUS_TONE: Record<string, BadgeTone> = { LIVE: 'live', STALE: 'stale', SYNTH: 'stale', PAUSED: 'neutral' };
export const STATUS_TITLE: Record<string, string> = {
  LIVE: tr('Realne dane Hyperliquid (REST + WebSocket)', 'Real Hyperliquid data (REST + WebSocket)'),
  STALE: tr('Dane nieświeże: brak synchronizacji > 30 s lub rozłączony WebSocket', 'Stale data: no sync for > 30 s or WebSocket disconnected'),
  SYNTH: tr('Świece zastępcze — czekam na pierwszą synchronizację z API', 'Placeholder candles, waiting for the first API sync'),
  PAUSED: tr('Strumień wstrzymany', 'Stream paused'),
};

export const LANGS: { value: Lang; label: string; title: string }[] = [
  { value: 'pl', label: 'PL', title: 'Polski' },
  { value: 'en', label: 'EN', title: 'English' },
];

// Blog jest tylko po polsku — w wersji angielskiej mówimy o tym w etykiecie
export const BLOG_LABEL = 'Blog';
// „Co nowego”: statyczna strona historii zmian w obu językach (co-nowego/, en/whats-new/)
export const NEWS_LABEL = tr('Co nowego', 'What’s new');
// „Wyniki”: statyczna strona rozliczenia dziennika prognoz (wyniki/, en/results/)
export const RESULTS_LABEL = tr('Wyniki', 'Results');

export const TIMEFRAMES = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 14400, label: '4h' },
];

/** Liczby rynku z nagłówka: wartości i ich etykiety (pełne w podpowiedzi ceny, część w samym nagłówku). */
export function useTicker() {
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
export const PriceButton: React.FC = () => {
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
        className="flex items-baseline gap-2 min-w-0 min-h-10 py-2 rounded-lg px-1.5 -mx-1.5 hover:bg-surface-2 transition-colors duration-150 text-xs"
      >
        <span className="self-center text-ink-2 font-medium">
          <span className="min-[420px]:hidden">BTC</span>
          <span className="hidden min-[420px]:inline-flex items-center h-7 px-2.5 rounded-full border border-line text-[11px] font-semibold tracking-wide">BTC-PERP</span>
        </span>
        <AnimatedNumber value={k.price} format={(v) => fmtPrice(v)} className="font-display text-[19px] sm:text-[22px] font-semibold leading-none tracking-tight tabular-nums [font-stretch:92%] text-ink-1" />
        <span className="hidden min-[480px]:inline font-mono text-[11px]"><Change pct={k.changePct} span={k.windowLabel} /></span>
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
    <div ref={ref} data-header-ticker className="flex items-center gap-x-5 min-w-0 overflow-hidden whitespace-nowrap text-xs">
      <PriceButton />
      <span className={`flex items-center gap-x-5 ${k.fresh ? '' : 'opacity-50'}`} title={k.fresh ? undefined : STALE_TITLE}>
        <Item label="Funding" value={k.funding} title="Funding HL" className="hidden md:flex" />
        <Item label="OI" value={k.oi} className="hidden md:flex" />
        <Item label="Basis" value={k.basis} className="hidden md:flex" />
      </span>
      <Item label="PDH" value={k.pdh} title={k.pdhStatus} className="hidden md:flex" />
      <Item label="PDL" value={k.pdl} title={k.pdlStatus} className="hidden md:flex" />
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

/** Powtórka w W sesji (#charts?replay=history|lessons…) pokazuje przeszłość — wtedy bez paska ceny na żywo (jak parseReplayLink). */
export const inReplay = () => {
  const h = window.location.hash;
  const src = h.startsWith('#charts') ? new URLSearchParams(h.split('?')[1] ?? '').get('replay') : null;
  return src === 'history' || src === 'lessons';
};

function activeChartMarket() {
  const [view, query] = window.location.hash.split('?');
  if (view !== '#charts' && view !== '#before' && view !== '#after') return undefined;
  return new URLSearchParams(query).get('m');
}

/** Liczba rynku w nagłówku: drobny podpis nad wartością (jak w projekcie terminala). */
const Item: React.FC<{ label: string; value: string; title?: string; className?: string }> = ({ label, value, title, className = 'flex' }) => (
  <span data-ticker-item className={`${className} flex-col justify-center gap-1`} title={title || undefined}>
    <span className="font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-ink-3">{label}</span>
    <span className="font-mono text-[12.5px] leading-none tabular-nums text-ink-1">{value}</span>
  </span>
);

/**
 * Zastępnik leniwego widoku: zajmuje wysokość ekranu pod nagłówkiem, żeby stopka nie stała na ekranie przed widokiem
 * i nie skakała w dół, gdy widok się wczyta (przesunięcie układu, CLS, na wolnym łączu).
 */
const ViewFallback = () => (
  <div data-view-fallback className="min-h-[calc(100dvh-var(--hq-header-h,6rem))]">
    <EmptyState title={tr('Ładowanie widoku…', 'Loading view…')} />
  </div>
);

// Bez globalnego przełącznika interwału: widoki z własnymi interwałami (wykresy faz dnia, Lekcje) i bez wykresów (Agenci AI)
export const OWN_INTERVALS: ViewId[] = ['before', 'charts', 'after', 'lessons', 'agents', 'markets', 'orderflow'];

/** Zmienna CSS z wysokością przypiętego nagłówka aplikacji (px); widoki używają jej w klasie `top-[var(--hq-header-h,0px)]`. */
export const HEADER_H_VAR = '--hq-header-h';

/**
 * Zamykanie menu „Więcej”: Escape (fokus wraca na przycisk) i kliknięcie poza `ref`; po otwarciu fokus na pierwszej
 * pozycji.
 */
export function useMenuDismiss(
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
export const ViewLink: React.FC<{ id: ViewId; go: (v: ViewId) => void; current?: boolean; more?: boolean; className: string; children: React.ReactNode }> = ({
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

/**
 * Bieżący widok aplikacji (leniwie ładowany) albo stan „łączenie” do pierwszych świec. Wspólny dla obu powłok (stara
 * i nowy wygląd za przełącznikiem `?ui=`), żeby lista widoków i warunki danych były w jednym miejscu.
 */
export const ViewOutlet: React.FC<{ startedAt: number; onChartMarket?: (coin: string) => void }> = ({ startedAt, onChartMarket }) => {
  const { view, setView, feed } = useDesk();
  // Karta układu innej fazy w Wykresach (Alt+1…6, nowa karta) przenosi do ekranu tej fazy
  const onPhase = useCallback((p: PhaseId) => setView(PHASE_VIEW[p]), [setView]);
  // Badania do pierwszych świec pokazują stan „łączenie” (viewNeeds.ts); pas kontekstu Przed sesją czeka w BeforeView
  const awaitingData = awaitingBars(view, feed.bars.length);
  return (
    <Suspense fallback={<ViewFallback />}>
      {awaitingData ? (
        <ConnectingState onRetry={feed.syncNow} startedAt={startedAt} now={feed.nowTick} />
      ) : (
        <>
          {view === 'dzis' && <DzisView />}
          {view === 'before' && <BeforeView onPhase={onPhase} onMarket={onChartMarket} />}
          {view === 'charts' && <SessionView onPhase={onPhase} onMarket={onChartMarket} />}
          {view === 'after' && <AfterView onPhase={onPhase} onMarket={onChartMarket} />}
          {view === 'research' && <ResearchView />}
          {view === 'lessons' && <LessonsView />}
          {view === 'sources' && <SourcesView />}
          {view === 'agents' && <AgentsView />}
          {view === 'markets' && <MarketsView />}
          {view === 'orderflow' && <OrderFlowView />}
        </>
      )}
    </Suspense>
  );
};

const MENU_ITEM = 'w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3';
const MENU_PANEL = 'w-64 max-h-[75dvh] overflow-y-auto bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl';
const MENU_MOTION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Znak HyperQuant: tarcza ze wskazówką i kropką „lume” (czas sesji jako oś produktu). */
/**
 * Znak HyperQuant „Chronograf H” (ten sam rysunek co ikona aplikacji, scripts/icons/ikona.mjs): pierścień doby z sesjami
 * Azji, Londynu i Nowego Jorku, „H” z dwóch świec i znak „teraz” w kolorze lume. Kolory z tokenów (oba motywy).
 */
const LogoMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="40 40 432 432" aria-hidden="true" className="shrink-0 text-ink-1">
    <g fill="none" strokeLinecap="round" strokeWidth="30">
      <path d="M270.9 78.6A178 178 0 0 1 417.1 331.8" stroke="var(--color-line-strong)" />
      <path d="M402.2 357.6A178 178 0 0 1 201.9 425.6" stroke="var(--color-ink-3)" />
      <path d="M174.4 414.2A178 178 0 0 1 241.1 78.6" stroke="currentColor" />
    </g>
    <g fill="currentColor">
      <rect x="183" y="150" width="14" height="212" rx="7" />
      <rect x="160" y="184" width="60" height="132" rx="14" />
      <rect x="315" y="138" width="14" height="196" rx="7" />
      <rect x="292" y="166" width="60" height="122" rx="14" />
      <rect x="214" y="238" width="84" height="26" rx="13" />
    </g>
    <circle cx="187.9" cy="420.5" r="34" fill="var(--color-lume)" stroke="var(--color-page)" strokeWidth="12" />
  </svg>
);

/** Strona statyczna serwisu w nawigacji (Blog, Wyniki, Co nowego): zwykły link, nie widok aplikacji. */
export type PageLink = { href: string; label: string; icon: React.ReactNode };

/**
 * Nawigacja aplikacji jako dane (jedno źródło dla szyny, dolnego paska, menu „Więcej” i palety ⌘K): dzień tradera
 * (Dziś i trzy fazy), rynek, wiedza, strony serwisu. Kolejność grup i pozycji jest kolejnością na ekranie. Strona
 * startowa (Przekrój pod `/`) to logo, nie zakładka.
 */
export const NAV_DZIEN: NavItem[] = [DZIS, ...PHASES];
export const NAV_RYNEK: NavItem[] = [MARKETS, ORDER_FLOW];
export const NAV_WIEDZA: NavItem[] = [...MORE, AGENTS];
export const NAV_STRONY: PageLink[] = [
  { href: './blog/', label: BLOG_LABEL, icon: <Newspaper className="w-4 h-4" /> },
  { href: tr('./wyniki/', './en/results/'), label: RESULTS_LABEL, icon: <ListChecks className="w-4 h-4" /> },
  { href: tr('./co-nowego/', './en/whats-new/'), label: NEWS_LABEL, icon: <History className="w-4 h-4" /> },
];
/** Strona startowa (Przekrój pod `/`, ten sam dokument co dawne `/nowy/`): logo w szynie i nagłówku, pozycja palety. */
export const START_HREF = `${import.meta.env.BASE_URL}?lang=${lang}`;
/** Stanowisko (osobna strona pracowni): pozycja szyny, menu „Więcej” i palety. */
export const STANOWISKO: PageLink = {
  href: `${import.meta.env.BASE_URL}stanowisko/?lang=${lang}`,
  label: tr('Stanowisko', 'Workbench'),
  icon: <PanelsTopLeft className="w-4 h-4" aria-hidden="true" />,
};
/** Dolny pasek telefonu (decyzja R3): Dziś, Sesja, Order Flow, Rynki; piąte miejsce to „Więcej”. */
export const NAV_TELEFON: NavItem[] = [DZIS, { ...PHASES[1], short: tr('Sesja', 'Session') }, ORDER_FLOW, MARKETS];
export const NAV_TELEFON_WIECEJ: NavItem[] = [...NAV_DZIEN, ...NAV_RYNEK, ...NAV_WIEDZA].filter((n) => !NAV_TELEFON.some((t) => t.id === n.id));
/** Fazy dnia: „Sesja” w dolnym pasku świeci przy każdej z nich. */
const FAZY_IDS: ViewId[] = ['before', 'charts', 'after'];
/**
 * Przełącznik faz nad widokiem na telefonie tylko w Przed i Po sesji: W sesji wykres zaczyna się od razu pod
 * nagłówkiem (pomiar ui:check panelu ceny i brak nachodzenia dolnego paska na świece); Przed i Po są też w „Więcej”.
 */
const FAZY_Z_PRZELACZNIKIEM: ViewId[] = ['before', 'after'];

// Paleta poleceń ładowana przy pierwszym otwarciu (⌘K, przycisk „Szukaj”): pierwszy pakiet bez niej
const Wyspa = lazy(() => import('./wyspa/Wyspa').then((m) => ({ default: m.Wyspa })));
const PaletaPolecen = lazy(() => import('./PaletaPolecen').then((m) => ({ default: m.PaletaPolecen })));

/**
 * Szyna boczna (komputer, od 1024 px): marka, dzień tradera ze znakiem „teraz” przy fazie bieżącej sesji, rynki
 * i wiedza, strony serwisu. 1024–1599 px: ikona z krótką nazwą pod nią (każda zakładka podpisana), od 1600 px nazwy w rzędzie
 * (wąska szyna oddaje miejsce wykresowi i kolumnie DOM przy 1440 px).
 */
/** Stan szyny na tym urządzeniu: widoczna albo schowana (tryb skupienia nad wykresem). */
export const SZYNA_KLUCZ = 'hq.szyna';
const czytajSzyne = () => {
  try {
    return localStorage.getItem(SZYNA_KLUCZ) === 'ukryta';
  } catch {
    return false;
  }
};

const Szyna: React.FC<{ go: (v: ViewId) => void }> = ({ go }) => {
  const { view, feed } = useDesk();
  const { phase } = dayPhase(useNow(60_000));
  const [ukryta, setUkryta] = useState(czytajSzyne);
  // Poświata oddycha z rynkiem: każda zmiana ceny dodaje światła, które powoli wygasa (bez renderów Reacta)
  const poswiata = useRef<HTMLDivElement>(null);
  const aktywnosc = useRef(0);
  const cenaWczesniej = useRef<number | null>(null);
  useEffect(() => {
    const c = feed.currentPrice;
    if (!Number.isFinite(c)) return;
    if (cenaWczesniej.current !== null && cenaWczesniej.current !== c) aktywnosc.current = Math.min(1, aktywnosc.current * 0.8 + 0.3);
    cenaWczesniej.current = c;
  }, [feed.currentPrice]);
  useEffect(() => {
    const id = window.setInterval(() => {
      aktywnosc.current *= 0.82;
      poswiata.current?.style.setProperty('--aktywnosc', aktywnosc.current.toFixed(3));
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  const pierwszy = useRef(true);
  const przycisk = useRef<HTMLButtonElement>(null);
  const uchwyt = useRef<HTMLButtonElement>(null);
  const [serwis, setSerwis] = useState(false);
  const serwisBtn = useRef<HTMLButtonElement>(null);
  const serwisRef = useRef<HTMLDivElement>(null);
  const serwisId = useId();
  const [serwisPoz, setSerwisPoz] = useState({ left: 112, bottom: 80 });
  useMenuDismiss(serwis, setSerwis, serwisRef, serwisBtn);
  useEffect(() => {
    if (!serwis || !serwisBtn.current) return;
    const r = serwisBtn.current.getBoundingClientRect();
    setSerwisPoz({ left: Math.round(r.right + 12), bottom: Math.max(12, Math.round(window.innerHeight - r.bottom)) });
  }, [serwis]);
  useEffect(() => {
    try {
      localStorage.setItem(SZYNA_KLUCZ, ukryta ? 'ukryta' : 'widoczna');
    } catch {
      /* pamięć zablokowana */
    }
    // Wykresy mierzą kontener przy zmianie rozmiaru okna
    window.dispatchEvent(new Event('resize'));
    if (pierwszy.current) {
      pierwszy.current = false;
      return;
    }
    (ukryta ? uchwyt : przycisk).current?.focus({ preventScroll: true });
  }, [ukryta]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey) return;
      const cel = e.target as HTMLElement | null;
      if (cel?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setUkryta((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (ukryta) {
    return (
      <button
        ref={uchwyt}
        type="button"
        data-szyna-uchwyt
        onClick={() => setUkryta(false)}
        aria-label={tr('Pokaż menu boczne', 'Show side menu')}
        title={`${tr('Pokaż menu boczne', 'Show side menu')} (\\)`}
        aria-keyshortcuts={'\\'}
        className="hidden lg:grid fixed left-0 top-1/2 -translate-y-1/2 z-40 w-[22px] h-[88px] hover:w-[30px] focus-visible:w-[30px] place-items-center rounded-r-2xl border border-l-0 border-line-strong bg-surface-1/70 backdrop-blur-xl text-ink-1 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.7)] transition-[width] duration-200 motion-reduce:transition-none"
      >
        <span aria-hidden="true" className="absolute left-1.5 top-[22px] bottom-[22px] w-0.5 rounded-full bg-lume shadow-[0_0_10px_var(--color-lume)]" />
        <ChevronRight className="w-3.5 h-3.5 ml-1.5" aria-hidden="true" />
      </button>
    );
  }
  const pozycja = (aktywna: boolean) =>
    `group relative flex flex-col items-center justify-center gap-1 min-h-[52px] px-1 rounded-xl text-[10.5px] leading-tight text-center font-medium transition-colors duration-150 min-[1600px]:flex-row min-[1600px]:justify-start min-[1600px]:gap-3 min-[1600px]:min-h-10 min-[1600px]:px-3 min-[1600px]:text-sm min-[1600px]:text-left ${
      aktywna ? 'text-ink-1' : 'text-ink-3 hover:text-ink-1 hover:bg-[color-mix(in_oklab,var(--color-ink-1)_5%,transparent)]'
    }`;
  const grupa = (tytul: string, items: NavItem[]) => (
    <div>
      <p className="hq-szyna-grupa mb-1 px-1 text-center font-mono font-semibold uppercase text-ink-3 min-[1600px]:px-3 min-[1600px]:text-left">{tytul}</p>
      <ul className="space-y-0.5">
        {items.map((n) => {
          const aktywna = view === n.id;
          const teraz = n.id === phase;
          return (
            <li key={n.id}>
              <ViewLink id={n.id} go={go} current={aktywna} className={pozycja(aktywna)}>
                {aktywna && (
                  <motion.span layoutId="szyna-aktywna" className="hq-szyna-pigulka absolute inset-0 rounded-xl" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />
                )}
                {aktywna && <span aria-hidden="true" className="absolute -left-2 top-3 bottom-3 w-[3px] rounded-r-full bg-lume shadow-[0_0_10px_var(--color-lume)]" />}
                <span className="relative shrink-0" title={n.label}>
                  {n.icon}
                  {teraz && <span aria-hidden="true" className="absolute -right-1 -top-1 w-1.5 h-1.5 rounded-full bg-lume shadow-[0_0_6px_var(--color-lume)]" />}
                </span>
                <span className="relative max-w-full min-[1600px]:flex-1 min-[1600px]:truncate">{n.label}</span>
                {teraz && <span className="relative hidden min-[1600px]:inline font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-3">{tr('teraz', 'now')}</span>}
                {teraz && <span className="sr-only min-[1600px]:hidden"> · {tr('teraz', 'now')}</span>}
              </ViewLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <>
    <div ref={poswiata} aria-hidden="true" className="hq-szyna-poswiata hidden lg:block pointer-events-none fixed left-0 top-0 h-dvh w-[100px] min-[1600px]:w-[252px]" />
    <aside data-szyna aria-label={tr('Nawigacja', 'Navigation')} className="hq-szyna-szklo hq-spot hidden lg:flex sticky top-2.5 z-10 my-2.5 ml-2.5 h-[calc(100dvh-20px)] w-[88px] min-[1600px]:w-60 shrink-0 flex-col gap-4 rounded-[22px] px-2 min-[1600px]:px-3 py-4 overflow-y-auto overflow-x-hidden">
      <a
        href={START_HREF}
        data-szyna-start
        aria-label={tr('HyperQuant: strona startowa', 'HyperQuant: home page')}
        title={tr('Strona startowa (Przekrój)', 'Home page (Cross-section)')}
        className="flex items-center justify-center min-[1600px]:justify-start gap-2.5 h-11 px-1.5 rounded-xl hover:bg-surface-2/70 transition-colors duration-150"
      >
        <LogoMark size={28} />
        <span aria-hidden="true" className="hidden min-[1600px]:block">
          <span data-marka className="block font-display text-[17px] font-bold leading-none tracking-tight [font-stretch:85%] text-ink-1">
            HyperQuant
          </span>
          <span className="block mt-1 font-mono text-[10px] leading-none text-ink-3">{`${deskLabels()} · Hyperliquid`}</span>
        </span>
      </a>
      <nav aria-label={tr('Główna', 'Main')} className="flex flex-col gap-4">
        {grupa(tr('Dzień', 'Day'), NAV_DZIEN)}
        {grupa(tr('Rynek', 'Market'), NAV_RYNEK)}
        {grupa(tr('Wiedza', 'Knowledge'), NAV_WIEDZA)}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <a href={STANOWISKO.href} data-szyna-stanowisko className={pozycja(false)}>
          <span className="relative shrink-0" title={STANOWISKO.label}>
            {STANOWISKO.icon}
          </span>
          <span className="relative max-w-full min-[1600px]:flex-1 min-[1600px]:truncate">{STANOWISKO.label}</span>
        </a>
        <button
          ref={serwisBtn}
          type="button"
          data-szyna-serwis
          onPointerDown={(e) => e.stopPropagation()}
          aria-expanded={serwis}
          aria-controls={serwis ? serwisId : undefined}
          onClick={() => setSerwis((o) => !o)}
          className={pozycja(serwis)}
        >
          <span className="relative shrink-0" title={tr('Serwis: blog, wyniki, co nowego', 'Site: blog, results, what’s new')}>
            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
          </span>
          <span className="relative max-w-full min-[1600px]:flex-1 min-[1600px]:truncate">{tr('Serwis', 'Site')}</span>
        </button>
        <button
          ref={przycisk}
          type="button"
          data-szyna-chowaj
          onClick={() => setUkryta(true)}
          aria-label={tr('Ukryj menu boczne', 'Hide side menu')}
          title={`${tr('Ukryj menu boczne', 'Hide side menu')} (\\)`}
          aria-keyshortcuts={'\\'}
          aria-expanded="true"
          className="mt-2 w-full flex items-center justify-center gap-2 min-h-11 rounded-xl border border-dashed border-line-strong text-ink-3 hover:text-ink-1 hover:border-solid transition-colors duration-150 min-[1600px]:justify-start min-[1600px]:px-3 min-[1600px]:text-[13px]"
        >
          <PanelLeftClose className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="sr-only min-[1600px]:not-sr-only">{tr('Ukryj menu', 'Hide menu')}</span>
        </button>
      </div>
    </aside>
    {/* Menu „Serwis” poza szkłem szyny (szkło z backdrop-filter przycina i zakotwicza elementy fixed) */}
    <div ref={serwisRef} className="hidden lg:block">
      <AnimatePresence>
        {serwis && (
          <motion.div
            id={serwisId}
            {...MENU_MOTION}
            style={{ left: serwisPoz.left, bottom: serwisPoz.bottom }}
            className={`fixed z-50 ${MENU_PANEL}`}
          >
            {NAV_STRONY.map((l) => (
              <a key={l.href} href={l.href} data-more-item="" className={MENU_ITEM}>
                {l.icon}
                {l.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
};

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'dark', label: 'Zorza', icon: <Moon className="w-4 h-4" aria-hidden="true" /> },
  { value: 'light', label: 'Opal', icon: <Sun className="w-4 h-4" aria-hidden="true" /> },
];

/** Ustawienia (menu nagłówka i „Więcej” na telefonie): język, motyw, strumień, synchronizacja, dźwięk taśmy. */
const ShellToggles: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { feed, audioEnabled, setAudioEnabled } = useDesk();
  const theme = useTheme();
  const seg = (on: boolean) =>
    `flex-1 min-h-11 inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium ${on ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'}`;
  return (
    <>
      <div role="group" aria-label={tr('Język', 'Language')} className="flex gap-1 px-1.5 py-1">
        {LANGS.map((l) => (
          <button key={l.value} type="button" data-more-item="" aria-pressed={lang === l.value} title={l.title} onClick={() => setLang(l.value)} className={seg(lang === l.value)}>
            {l.value === 'pl' ? 'PL · Polski' : 'EN · English'}
          </button>
        ))}
      </div>
      <div role="group" aria-label={tr('Motyw', 'Theme')} className="flex gap-1 px-1.5 py-1">
        {THEMES.map((th) => (
          <button key={th.value} type="button" aria-pressed={theme === th.value} onClick={() => setTheme(th.value)} className={seg(theme === th.value)}>
            {th.icon}
            {th.label}
          </button>
        ))}
      </div>
      <div role="separator" className="my-1 border-t border-line" />
      <button type="button" onClick={() => feed.setIsStreaming(!feed.isStreaming)} className={MENU_ITEM}>
        {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')}
      </button>
      <button
        type="button"
        onClick={() => {
          feed.syncNow();
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
      <div className="px-1.5 pt-1">
        <InstallButton />
      </div>
    </>
  );
};

/** Szybka zmiana motywu w nagłówku (Zorza ↔ Opal); nowy motyw rozlewa się kołem od przycisku (theme.ts). */
const MotywPrzelacznik: React.FC = () => {
  const theme = useTheme();
  const nastepny: Theme = theme === 'dark' ? 'light' : 'dark';
  const etykieta = nastepny === 'light' ? tr('Motyw Opal (jasny)', 'Opal theme (light)') : tr('Motyw Zorza (ciemny)', 'Zorza theme (dark)');
  return (
    <button
      type="button"
      data-motyw-przelacznik
      aria-label={etykieta}
      title={etykieta}
      onClick={() => setTheme(nastepny)}
      className="hidden sm:inline-flex items-center justify-center w-10 h-10 rounded-xl border border-line bg-surface-1 text-ink-2 hover:text-ink-1 hover:border-line-strong transition-colors duration-150"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
    </button>
  );
};

/** Telefon i tablet: trzy fazy dnia jako przełącznik nad widokiem fazy (dolny pasek ma Dziś, Sesję, Order Flow, Rynki). */
const FazyTelefon: React.FC<{ view: ViewId; go: (v: ViewId) => void }> = ({ view, go }) => {
  const { phase } = dayPhase(useNow(60_000));
  if (!FAZY_Z_PRZELACZNIKIEM.includes(view)) return null;
  return (
    <nav data-fazy-telefon aria-label={tr('Fazy dnia', 'Day phases')} className="hq-fazy-tel lg:hidden mb-3 grid grid-cols-3 gap-1 rounded-2xl p-1">
      {PHASES.map((n) => (
        <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} className="relative flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-ink-3 transition-colors duration-150">
          {n.label}
          {n.id === phase && (
            <>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-lume shadow-[0_0_6px_var(--color-lume)]" />
              <span className="sr-only"> · {tr('teraz', 'now')}</span>
            </>
          )}
        </ViewLink>
      ))}
    </nav>
  );
};

const IconBtn = React.forwardRef<HTMLButtonElement, { label: string; onClick: () => void; children: React.ReactNode; className?: string; expanded?: boolean; controls?: string }>(
  ({ label, onClick, children, className = 'inline-flex', expanded, controls }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onClick}
      className={`items-center justify-center w-10 h-10 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-line transition-colors duration-150 ${className}`}
    >
      {children}
    </button>
  )
);
IconBtn.displayName = 'IconBtn';

/**
 * Powłoka aplikacji (jedna nawigacja): szyna po lewej na komputerze, dolny pasek na telefonie i tablecie. Nagłówek:
 * cena i liczby rynku, wyszukiwanie ⌘K, stan danych, ustawienia; pod nim pasek dnia (doba z sesjami i „teraz”).
 */
export const AppShell: React.FC = () => {
  const { view, setView, feed } = useDesk();
  const systemReduce = useReducedMotion();
  const reduce = systemReduce || document.documentElement.dataset.motion === 'reduced';
  const [ustawienia, setUstawienia] = useState(false);
  const [wiecej, setWiecej] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [paletaGotowa, setPaletaGotowa] = useState(false);
  const [wyspa, setWyspa] = useState(false);
  const [wyspaGotowa, setWyspaGotowa] = useState(false);
  const wyspaBtn = useRef<HTMLButtonElement>(null);
  // Kotwica panelu: przycisk nagłówka albo dok (panel staje przy tym, z czego go otwarto)
  const wyspaKotwica = useRef<HTMLElement | null>(null);
  const [wyspaPostac, setWyspaPostac] = useState<PersonaId | undefined>(undefined);
  const straz = useStraznicy();
  const dismissFlash = straz.dismiss;
  const reguly = useRules();
  const pauza = usePaused();
  const aktywni = pauza ? 0 : reguly.filter((r) => r.on).length;
  const [startedAt] = useState(() => Date.now());
  const ustawieniaRef = useRef<HTMLDivElement>(null);
  const ustawieniaBtn = useRef<HTMLButtonElement>(null);
  const wiecejRef = useRef<HTMLDivElement>(null);
  const wiecejBtn = useRef<HTMLButtonElement>(null);
  const ustawieniaId = useId();
  const wiecejId = useId();
  const transition = reduce ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } } : VIEW_TRANSITION;
  const replay = useSyncExternalStore(subscribeHash, inReplay) && view === 'charts';
  const orderFlow = view === 'orderflow';
  const linkedMarket = useSyncExternalStore(subscribeHash, activeChartMarket);
  // Nić kontekstu: pełny adres ostatniego widoku pracy (rynek, interwał, nagranie, obserwacja) do powrotu z Dziś
  const adres = useSyncExternalStore(subscribeHash, () => window.location.hash);
  useEffect(() => {
    zapiszNic(adres, Date.now());
  }, [adres]);
  const [chartMarket, setChartMarket] = useState<{ view: ViewId; coin: string } | null>(null);
  const onChartMarket = useCallback((coin: string) => setChartMarket({ view, coin }), [view]);
  const activeCoin = chartMarket?.view === view ? chartMarket.coin : linkedMarket;
  const otherChartMarket = activeCoin && activeCoin !== HOME_MARKET ? marketLabel(activeCoin) : null;
  const NowyWidok = NOWE_WIDOKI[view];
  // Dolny pasek: „Sesja” prowadzi do W sesji i świeci przy każdej fazie dnia (przełącznik faz jest nad widokiem)
  const naTelefonie = (id: ViewId) => view === id || (id === 'charts' && FAZY_IDS.includes(view));

  const go = useCallback(
    (v: ViewId) => {
      setView(v);
      setUstawienia(false);
      setWiecej(false);
    },
    [setView]
  );
  useMenuDismiss(ustawienia, setUstawienia, ustawieniaRef, ustawieniaBtn);
  useMenuDismiss(wiecej, setWiecej, wiecejRef, wiecejBtn);

  const otworzWyspe = useCallback(() => {
    wyspaKotwica.current = wyspaBtn.current;
    setWyspaPostac(undefined);
    setWyspaGotowa(true);
    setWyspa((o) => !o);
    dismissFlash();
  }, [dismissFlash]);
  // Z doku: panel przy doku, na karcie klikniętej postaci
  const otworzZDoku = useCallback(
    (p?: PersonaId) => {
      wyspaKotwica.current = document.querySelector<HTMLElement>('[data-dok]');
      setWyspaPostac(p);
      setWyspaGotowa(true);
      setWyspa(true);
      dismissFlash();
    },
    [dismissFlash]
  );
  const zaloga = useZaloga(straz.flash);
  const zamknijWyspe = useCallback(() => setWyspa(false), []);

  const otworzPalete = useCallback(() => {
    setPaletaGotowa(true);
    setPaleta(true);
  }, []);
  // ⌘K / Ctrl+K: paleta poleceń (widoki, wykres dowolnego rynku, strony, język)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletaGotowa(true);
        setPaleta((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wysokość przypiętego nagłówka (rząd, pasek dnia, bezpieczna strefa) jako zmienna CSS: elementy przypinane w widokach
  // stają pod nim, nie pod nim schowane
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

  const wykonaj = useCallback(
    (a: Akcja) => {
      if (a.typ === 'widok') go(a.id);
      else if (a.typ === 'rynek') window.location.hash = `#charts?m=${encodeURIComponent(a.coin)}`;
      else if (a.typ === 'link') window.location.href = a.href;
      else if (a.typ === 'jezyk') setLang(a.lang);
      else if (a.co === 'strumien') feed.setIsStreaming(!feed.isStreaming);
      else if (a.co === 'synchronizuj') feed.syncNow();
    },
    [go, feed]
  );

  return (
    <div data-app-shell data-shell-view={view} className="min-h-dvh flex bg-page text-ink-1">
      <Szyna go={go} />
      <KartaModeluHost />
      <div className="flex-1 min-w-0 flex flex-col">
        <header ref={headerRef} data-app-header className="pt-safe sticky top-0 z-30 bg-page/90 backdrop-blur-xl border-b border-line">
          <div className="flex items-center gap-2 sm:gap-3 px-4 lg:px-6 h-14">
            {/* Telefon i tablet: znak marki (od 1024 px marka jest w szynie) */}
            <a href={START_HREF} data-naglowek-start title={tr('Strona startowa (Przekrój)', 'Home page (Cross-section)')} className="lg:hidden shrink-0 inline-flex items-center justify-center w-10 h-10 -ml-1.5 rounded-lg hover:bg-surface-2">
              <LogoMark />
              <span data-marka className="sr-only font-display">
                {tr('HyperQuant: strona startowa', 'HyperQuant: home page')}
              </span>
            </a>
            {/* Cena i liczby rynku; w powtórce W sesji bez ceny na żywo */}
            <div className="flex-1 min-w-0">
              {!replay && !orderFlow && (otherChartMarket ? (
                <span data-header-chart-market className="block truncate text-sm font-semibold" title={otherChartMarket}>
                  {otherChartMarket}
                </span>
              ) : <TickerInline />)}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={otworzPalete}
                aria-label={tr('Otwórz paletę poleceń', 'Open command palette')}
                className="inline-flex items-center gap-2 h-10 px-3 rounded-xl border border-line bg-surface-1 text-xs text-ink-2 hover:text-ink-1 hover:border-line-strong transition-colors duration-150"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
                <span className="hidden xl:inline">{tr('Szukaj rynku lub widoku', 'Search market or view')}</span>
                <kbd className="hidden md:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-ink-2">⌘K</kbd>
              </button>
              <button
                ref={wyspaBtn}
                type="button"
                data-wyspa-btn
                onClick={otworzWyspe}
                aria-expanded={wyspa}
                aria-haspopup="dialog"
                aria-label={tr(`Załoga: strażnicy i Sufler (aktywne reguły: ${aktywni})`, `Crew: guards and the Prompter (active rules: ${aktywni})`)}
                title={tr('Załoga: strażnicy i Sufler', 'Crew: guards and the Prompter')}
                className={`relative hidden min-[380px]:inline-flex items-center justify-center gap-2 h-10 min-w-10 px-2 sm:px-2.5 rounded-lg border text-xs transition-colors duration-150 ${wyspa ? 'border-line-strong bg-surface-2 text-ink-1' : 'border-line bg-surface-1 text-ink-2 hover:text-ink-1 hover:border-line-strong'}`}
              >
                <Postac id={zaloga.lead.p.id} state={zaloga.lead.state} size={26} className="-my-1" />
                <span className="hidden 2xl:inline">{tr('Załoga', 'Crew')}</span>
                {aktywni > 0 && (
                  <span aria-hidden="true" className="absolute top-1.5 right-1.5 sm:static font-mono tabular-nums text-[11px] leading-none text-ink-1 inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="hidden sm:inline">{aktywni}</span>
                  </span>
                )}
              </button>
              <a href={STANOWISKO.href}
                aria-label={STANOWISKO.label} title={STANOWISKO.label}
                className="hidden sm:inline-flex lg:hidden items-center justify-center gap-1.5 min-h-10 min-w-10 px-2 rounded-xl border border-line text-xs font-medium text-ink-1 hover:bg-surface-2">
                <PanelsTopLeft size={16} aria-hidden="true" /><span className="hidden md:inline">{STANOWISKO.label}</span>
              </a>
              {!orderFlow && !otherChartMarket && !replay && <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
                {feed.dataStatus}
              </Badge>}
              {/* Globalny interwał tylko w widokach bez własnego (wykresy faz dnia, Lekcje, Rynki i Agenci mają swój albo żaden) */}
              {!OWN_INTERVALS.includes(view) && (
                <div className="hidden 2xl:block">
                  <Segmented<number> ariaLabel={tr('Interwał', 'Timeframe')} size="xs" value={feed.timeframeSec} onChange={feed.setTimeframeSec} options={TIMEFRAMES} />
                </div>
              )}
              <MotywPrzelacznik />
              <div ref={ustawieniaRef} className="relative hidden sm:block">
                <IconBtn ref={ustawieniaBtn} label={tr('Ustawienia', 'Settings')} onClick={() => setUstawienia((o) => !o)} expanded={ustawienia} controls={ustawieniaId}>
                  <SlidersHorizontal className="w-4 h-4" />
                </IconBtn>
                <AnimatePresence>
                  {ustawienia && (
                    <motion.div id={ustawieniaId} {...MENU_MOTION} className={`absolute top-full right-0 mt-2 z-40 ${MENU_PANEL}`}>
                      <ShellToggles onDone={() => setUstawienia(false)} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
          <PasekDnia />
        </header>

        <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 pt-4 pb-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} data-view-root data-view={view} {...transition}>
              <FazyTelefon view={view} go={go} />
              {NowyWidok ? (
                <Suspense fallback={<ViewFallback />}>
                  <NowyWidok />
                </Suspense>
              ) : (
                <ViewOutlet startedAt={startedAt} onChartMarket={onChartMarket} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Stopka: zastrzeżenie, źródło danych, silnik wykresów (link wymagany licencją Lightweight Charts™), strefa czasu */}
        <footer className="w-full max-w-[1920px] mx-auto px-4 lg:px-6 pb-28 lg:pb-6">
          <div className="flex flex-col gap-1 pt-3 border-t border-line text-xs text-ink-3">
            <p className="font-medium text-ink-2">{tr('Opis rynku, nie porada inwestycyjna.', 'Market description, not investment advice.')}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 min-h-11">
              {tr('Dane', 'Data')}: Hyperliquid · {tr('Wykresy', 'Charts')}:{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-ink-1">
                TradingView Lightweight Charts™
              </a>
              <span>
                · {tr('czas lokalny', 'local time')} {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
              <span>
                ·{' '}
                <a href={tr('./prywatnosc/', './en/privacy/')} className="underline decoration-line-strong hover:text-ink-1">
                  {tr('Prywatność', 'Privacy')}
                </a>
              </span>
            </p>
          </div>
        </footer>
      </div>

      {/* Telefon i tablet: dolny pasek (Dziś, Sesja, Order Flow, Rynki, „Więcej”) */}
      <nav data-app-nav data-chart-navigation={view === 'charts' || undefined} aria-label={tr('Główna (telefon)', 'Main (phone)')} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-1/95 backdrop-blur-xl border-t border-line pb-safe">
        <div ref={wiecejRef}>
          <div className="grid grid-cols-5">
            {NAV_TELEFON.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => go(n.id)}
                aria-current={naTelefonie(n.id) ? 'page' : undefined}
                className={`relative min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 ${naTelefonie(n.id) ? 'text-ink-1' : 'text-ink-3'}`}
              >
                {naTelefonie(n.id) && <motion.span layoutId="dolny-aktywny" className="absolute top-0 inset-x-5 h-0.5 rounded-full bg-lume" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                {n.icon}
                <span className="max-w-full px-1 truncate">{n.short ?? n.label}</span>
              </button>
            ))}
            <button
              ref={wiecejBtn}
              type="button"
              onClick={() => setWiecej((o) => !o)}
              aria-expanded={wiecej}
              aria-controls={wiecej ? wiecejId : undefined}
              className={`min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${!FAZY_IDS.includes(view) && NAV_TELEFON_WIECEJ.some((n) => n.id === view) ? 'text-ink-1' : 'text-ink-3'}`}
            >
              <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              {tr('Więcej', 'More')}
            </button>
          </div>
          <AnimatePresence>
            {wiecej && (
              <motion.div id={wiecejId} {...MENU_MOTION} className={`absolute bottom-full right-3 mb-2 ${MENU_PANEL}`}>
                {NAV_TELEFON_WIECEJ.map((n) => (
                  <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} more className={MENU_ITEM}>
                    {n.icon}
                    {n.label}
                  </ViewLink>
                ))}
                <div role="separator" className="my-1 border-t border-line" />
                {[STANOWISKO, ...NAV_STRONY].map((l) => (
                  <a key={l.href} href={l.href} className={MENU_ITEM}>
                    {l.icon}
                    {l.label}
                  </a>
                ))}
                <a href={START_HREF} className={MENU_ITEM}>
                  <LogoMark size={16} />
                  {tr('Strona startowa', 'Home page')}
                </a>
                <button
                  type="button"
                  data-more-wyspa
                  onClick={() => {
                    setWiecej(false);
                    wyspaKotwica.current = wyspaBtn.current;
                    setWyspaPostac(undefined);
                    setWyspaGotowa(true);
                    setWyspa(true);
                    dismissFlash();
                  }}
                  className={MENU_ITEM}
                >
                  <Radar className="w-4 h-4" aria-hidden="true" />
                  {tr('Załoga: strażnicy i Sufler', 'Crew: guards and the Prompter')}
                  {aktywni > 0 && <span className="ml-auto font-mono tabular-nums text-xs text-ink-3">{aktywni}</span>}
                </button>
                <div role="separator" className="my-1 border-t border-line" />
                <ShellToggles onDone={() => setWiecej(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Dok załogi: pływająca wyspa z postaciami; zdarzenie strażnika jako dymek nad dokiem */}
      <Dok flash={straz.flash} onDismissFlash={dismissFlash} onOpen={otworzZDoku} open={wyspa} />
      <div role="status" aria-live="polite" className="sr-only">
        {straz.flash ? tr(`Strażnik: ${straz.flash.text}`, `Guard: ${straz.flash.text}`) : ''}
      </div>

      {wyspaGotowa && (
        <Suspense fallback={null}>
          <Wyspa open={wyspa} onClose={zamknijWyspe} go={go} anchor={wyspaKotwica} persona={wyspaPostac} flash={straz.flash} />
        </Suspense>
      )}

      {paletaGotowa && (
        <Suspense fallback={null}>
          <PaletaPolecen
            open={paleta}
            onClose={() => setPaleta(false)}
            onAkcja={wykonaj}
            widoki={[...NAV_DZIEN, ...NAV_RYNEK, ...NAV_WIEDZA]}
            zewnetrzne={[{ href: START_HREF, label: tr('Strona startowa (Przekrój)', 'Home page (Cross-section)') }, STANOWISKO, ...NAV_STRONY]}
            przelaczniki={[
              { co: 'strumien', etykieta: feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream') },
              { co: 'synchronizuj', etykieta: tr('Synchronizuj teraz', 'Sync now') },
            ]}
          />
        </Suspense>
      )}
    </div>
  );
};
