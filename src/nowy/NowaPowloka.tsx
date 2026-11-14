import React, { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Command, History, ListChecks, MoreHorizontal, Newspaper, Pause, Play, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { useDesk } from '../state/DeskContext';
import { useMarkets } from '../state/markets';
import { subscribeHash } from '../state/route';
import type { ViewId } from '../state/types';
import { bareName } from '../utils/marketsTable';
import { Lang, lang, setLang, tr } from '../i18n';
import { Badge, VIEW_TRANSITION } from '../ui';
import {
  AGENTS,
  BLOG_LABEL,
  HEADER_H_VAR,
  LANGS,
  MARKETS,
  MORE,
  NEWS_LABEL,
  PHASES,
  PriceButton,
  RESULTS_LABEL,
  STATUS_TITLE,
  STATUS_TONE,
  ViewLink,
  ViewOutlet,
  inReplay,
  useMenuDismiss,
  useTicker,
  type NavItem,
} from '../shell/AppShell';
import { InstallButton } from '../shell/InstallButton';
import { PaletaPolecen } from './PaletaPolecen';
import type { Akcja } from './polecenia';

/**
 * Nowy wygląd (za przełącznikiem `?ui=nowy`): jedna nawigacja — szyna boczna na komputerze (od 1024 px), dolny pasek
 * na telefonie; nagłówek z ceną BTC-PERP i liczbami rynku (te same dane co stara powłoka), wybór wykresu rynku z
 * rejestru, paleta poleceń ⌘K. Widoki są te same co w starej powłoce (`ViewOutlet`); wykresy bez zmian.
 */

/** Grupy szyny: dzień tradera (trzy fazy) oraz rynki i wiedza. */
const DZIEN: NavItem[] = PHASES;
const WIEDZA: NavItem[] = [MARKETS, ...MORE, AGENTS];
const ZEWNETRZNE = [
  { href: './blog/', label: BLOG_LABEL, icon: <Newspaper className="w-4 h-4" /> },
  { href: tr('./wyniki/', './en/results/'), label: RESULTS_LABEL, icon: <ListChecks className="w-4 h-4" /> },
  { href: tr('./co-nowego/', './en/whats-new/'), label: NEWS_LABEL, icon: <History className="w-4 h-4" /> },
];

/** Znak marki: trzy świece i linia VWAP (bez danych, dekoracja). */
const Znak: React.FC = () => (
  <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-gradient-to-br from-hq-elevated to-hq-surface border border-hq-cyan/35 flex items-center justify-center shrink-0">
    <svg viewBox="0 0 24 24" className="w-4 h-4 overflow-visible" fill="none">
      <rect x="4" y="11" width="3" height="7" rx="0.8" className="fill-hq-cyan" opacity="0.9" />
      <rect x="10.5" y="7" width="3" height="9" rx="0.8" className="fill-hq-amber" opacity="0.9" />
      <rect x="17" y="5" width="3" height="8" rx="0.8" className="fill-hq-cyan" />
      <path d="M3 16 Q12 12 21 6" className="stroke-hq-indigo" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </span>
);

const pozycjaSzyny = (aktywna: boolean) =>
  `relative w-full flex items-center gap-2.5 px-3 min-h-10 rounded-lg text-sm font-medium transition-colors duration-150 ${
    aktywna ? 'text-hq-ink-1' : 'text-hq-ink-2 hover:text-hq-ink-1 hover:bg-hq-elevated/60'
  }`;

const Pigulka: React.FC<{ id: string }> = ({ id }) => (
  <motion.span layoutId={id} className="absolute inset-0 rounded-lg bg-hq-elevated border border-hq-cyan/40" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
);

/** Szyna boczna (komputer): marka, dzień tradera, rynki i wiedza, strony statyczne, stan danych. */
const Szyna: React.FC<{ go: (v: ViewId) => void }> = ({ go }) => {
  const { view, feed } = useDesk();
  const grupa = (tytul: string, items: NavItem[]) => (
    <div>
      <p className="px-3 mb-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase text-hq-ink-3">{tytul}</p>
      <ul className="space-y-0.5">
        {items.map((n) => (
          <li key={n.id}>
            <ViewLink id={n.id} go={go} current={view === n.id} className={pozycjaSzyny(view === n.id)}>
              {view === n.id && <Pigulka id="nowy-szyna" />}
              <span className="relative flex items-center gap-2.5">
                {n.icon}
                {n.label}
              </span>
            </ViewLink>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <aside data-szyna aria-label={tr('Nawigacja', 'Navigation')} className="hidden lg:flex sticky top-0 h-dvh w-60 shrink-0 flex-col gap-6 border-r border-hq-line bg-hq-surface/70 px-3 py-4 overflow-y-auto">
      <ViewLink id="charts" go={go} className="flex items-center gap-2.5 px-2">
        <Znak />
        <span>
          <span className="block font-display font-bold text-sm leading-none tracking-tight text-hq-ink-1">HyperQuant</span>
          <span className="block font-mono text-[10px] tracking-wider text-hq-ink-3 mt-1">BTC · HYPERLIQUID</span>
        </span>
      </ViewLink>
      <nav aria-label={tr('Główna', 'Main')} className="flex flex-col gap-6">
        {grupa(tr('Dzień tradera', 'Trading day'), DZIEN)}
        {grupa(tr('Rynki i wiedza', 'Markets and knowledge'), WIEDZA)}
        <ul className="space-y-0.5">
          {ZEWNETRZNE.map((l) => (
            <li key={l.href}>
              <a href={l.href} className={pozycjaSzyny(false)}>
                {l.icon}
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto rounded-lg border border-hq-line bg-hq-obsidian/60 p-3 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold text-hq-ink-1">Hyperliquid</span>
          <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]}>
            {feed.dataStatus}
          </Badge>
        </div>
        <p className="leading-snug text-hq-ink-3">{tr('Opis rynku z danych giełdy, bez ocen kierunku ceny.', 'Market description from exchange data, no price direction calls.')}</p>
      </div>
    </aside>
  );
};

/** Wybór wykresu rynku z rejestru: otwiera W sesji na tym rynku (#charts?m=…); dane nagłówka zostają dla BTC-PERP. */
// `className` niesie sposób wyświetlania (domyślnie inline-flex): stałe inline-flex w klasie bazowej wygrywałoby z
// „hidden sm:inline-flex” i element byłby widoczny na telefonie
const WyborRynku: React.FC<{ className?: string }> = ({ className = 'inline-flex' }) => {
  const { markets } = useMarkets();
  const id = useId();
  return (
    <label htmlFor={id} className={`relative items-center gap-1.5 rounded-lg border border-hq-line bg-hq-surface px-2 min-h-9 text-xs ${className}`}>
      <span className="text-hq-ink-3 whitespace-nowrap">{tr('Wykres', 'Chart')}</span>
      <select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value) window.location.hash = `#charts?m=${encodeURIComponent(e.target.value)}`;
        }}
        aria-label={tr('Otwórz wykres rynku', 'Open market chart')}
        className="bg-transparent font-mono text-hq-ink-1 outline-none cursor-pointer max-w-[7.5rem]"
      >
        <option value="">{tr('rynek…', 'market…')}</option>
        {markets.map((m) => (
          <option key={m.coin} value={m.coin}>
            {bareName(m)}
            {m.dex ? ` · ${m.dex}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
};

/** Liczby rynku obok ceny (komputer): funding i OI; reszta w rozwinięciu ceny (PriceButton). */
const Liczby: React.FC = () => {
  const k = useTicker();
  return (
    <div className={`hidden xl:flex items-baseline gap-4 text-xs whitespace-nowrap ${k.fresh ? '' : 'opacity-50'}`}>
      {[
        ['Funding', k.funding],
        ['OI', k.oi],
        [tr('Sesja', 'Session'), k.session],
      ].map(([l, v]) => (
        <span key={l} className="flex items-baseline gap-1.5">
          <span className="text-hq-ink-3">{l}</span>
          <span className="font-mono tabular-nums text-hq-ink-1">{v}</span>
        </span>
      ))}
    </div>
  );
};

const Przycisk: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className = 'inline-flex' }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`${className} items-center justify-center w-9 h-9 rounded-lg border border-hq-line text-hq-ink-2 hover:text-hq-ink-1 hover:bg-hq-elevated transition-colors duration-150`}
  >
    {children}
  </button>
);

/** Przyciski języka (PL/EN; zmiana przeładowuje stronę, jak w starej powłoce). */
const Jezyk: React.FC<{ className?: string }> = ({ className = 'inline-flex' }) => (
  <div role="group" aria-label={tr('Język', 'Language')} className={`rounded-lg border border-hq-line bg-hq-surface p-0.5 text-[11px] font-mono ${className}`}>
    {LANGS.map((l) => (
      <button
        key={l.value}
        type="button"
        aria-pressed={lang === l.value}
        title={l.title}
        onClick={() => setLang(l.value as Lang)}
        className={`px-2 min-h-8 rounded-md ${lang === l.value ? 'bg-hq-cyan text-hq-obsidian font-semibold' : 'text-hq-ink-2 hover:text-hq-ink-1'}`}
      >
        {l.label}
      </button>
    ))}
  </div>
);

export default function NowaPowloka() {
  const { view, setView, feed, audioEnabled, setAudioEnabled } = useDesk();
  const reduce = useReducedMotion();
  const [startedAt] = useState(() => Date.now());
  const [paleta, setPaleta] = useState(false);
  const [wiecej, setWiecej] = useState(false);
  const wiecejRef = useRef<HTMLDivElement>(null);
  const wiecejBtn = useRef<HTMLButtonElement>(null);
  const wiecejId = useId();
  const transition = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : VIEW_TRANSITION;
  // Powtórka w W sesji pokazuje przeszłość: bez ceny na żywo w nagłówku (subskrypcja zmiany adresu, jak stara powłoka)
  const replay = useSyncExternalStore(subscribeHash, inReplay) && view === 'charts';

  const go = useCallback(
    (v: ViewId) => {
      setView(v);
      setWiecej(false);
    },
    [setView]
  );
  useMenuDismiss(wiecej, setWiecej, wiecejRef, wiecejBtn);

  // ⌘K / Ctrl+K: paleta poleceń
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaleta((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wysokość przypiętego nagłówka jako zmienna CSS (widoki przypinają pod nim swoje paski), jak w starej powłoce
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
      else setLang(a.lang);
    },
    [go]
  );

  const MENU = 'w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-hq-ink-1 hover:bg-hq-elevated';

  return (
    <div data-nowa-powloka className="min-h-dvh flex bg-hq-obsidian text-hq-ink-1">
      <Szyna go={go} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header ref={headerRef} data-app-header className="pt-safe sticky top-0 z-30 bg-hq-obsidian/90 backdrop-blur-xl border-b border-hq-line">
          <div className="flex items-center gap-3 px-3 sm:px-5 h-14">
            {/* Telefon i tablet: znak marki (szyna od 1024 px ma pełną markę) */}
            <ViewLink id="charts" go={go} className="lg:hidden shrink-0">
              <Znak />
              <span className="sr-only">HyperQuant</span>
            </ViewLink>
            {!replay && (
              <div className="min-w-0 flex items-center gap-4">
                <PriceButton small />
                <Liczby />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <WyborRynku className="hidden sm:inline-flex" />
              <button
                type="button"
                onClick={() => setPaleta(true)}
                aria-label={tr('Otwórz paletę poleceń', 'Open command palette')}
                className="inline-flex items-center gap-2 min-h-9 px-2.5 rounded-lg border border-hq-line bg-hq-surface text-xs text-hq-ink-2 hover:text-hq-ink-1"
              >
                <Command className="w-3.5 h-3.5 text-hq-cyan" aria-hidden="true" />
                <span className="hidden md:inline">{tr('Szukaj', 'Jump')}</span>
                <kbd className="hidden md:inline font-mono text-[10px] px-1 rounded bg-hq-elevated text-hq-ink-2">⌘K</kbd>
              </button>
              <Badge tone={STATUS_TONE[feed.dataStatus]} title={STATUS_TITLE[feed.dataStatus]} testId="data-status">
                {feed.dataStatus}
              </Badge>
              <Przycisk
                label={feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')}
                onClick={() => feed.setIsStreaming(!feed.isStreaming)}
                className="hidden sm:inline-flex"
              >
                {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Przycisk>
              <Jezyk className="hidden lg:inline-flex" />
              <div className="hidden lg:contents">
                <InstallButton compact />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1920px] mx-auto px-3 sm:px-5 pt-4 pb-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} data-view-root {...transition}>
              <ViewOutlet startedAt={startedAt} />
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="w-full max-w-[1920px] mx-auto px-3 sm:px-5 pb-28 lg:pb-6">
          <div className="flex flex-col gap-1 pt-3 border-t border-hq-line text-xs text-hq-ink-3">
            <p className="font-medium text-hq-ink-2">
              {tr('Opis rynku, nie porada inwestycyjna ani wezwanie do transakcji.', 'Market description, not investment advice nor a call to trade.')}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 min-h-11">
              {tr('Dane', 'Data')}: Hyperliquid · {tr('Wykresy', 'Charts')}:{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-hq-line-strong hover:text-hq-ink-1">
                TradingView Lightweight Charts™
              </a>
              <span>· {tr('czas lokalny', 'local time')} {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            </p>
          </div>
        </footer>
      </div>

      {/* Telefon i tablet: dolny pasek (trzy fazy dnia i „Więcej”) */}
      <nav data-app-nav aria-label={tr('Główna (telefon)', 'Main (phone)')} className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-hq-surface/95 backdrop-blur-xl border-t border-hq-line pb-safe">
        <div ref={wiecejRef}>
          <div className="grid grid-cols-4">
            {DZIEN.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => go(n.id)}
                aria-current={view === n.id ? 'page' : undefined}
                className={`relative min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${view === n.id ? 'text-hq-cyan' : 'text-hq-ink-3'}`}
              >
                {view === n.id && <motion.span layoutId="nowy-dolny" className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-hq-cyan" />}
                {n.icon}
                {n.label}
              </button>
            ))}
            <button
              ref={wiecejBtn}
              type="button"
              onClick={() => setWiecej((o) => !o)}
              aria-expanded={wiecej}
              aria-controls={wiecej ? wiecejId : undefined}
              className={`min-h-14 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${WIEDZA.some((n) => n.id === view) ? 'text-hq-cyan' : 'text-hq-ink-3'}`}
            >
              <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              {tr('Więcej', 'More')}
            </button>
          </div>
          <AnimatePresence>
            {wiecej && (
              <motion.div
                id={wiecejId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.16 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="absolute bottom-full right-3 mb-2 w-64 max-h-[70dvh] overflow-y-auto bg-hq-elevated border border-hq-line-strong rounded-xl p-1.5 shadow-2xl"
              >
                <WyborRynku className="flex w-full mb-1" />
                {WIEDZA.map((n) => (
                  <ViewLink key={n.id} id={n.id} go={go} current={view === n.id} more className={MENU}>
                    {n.icon}
                    {n.label}
                  </ViewLink>
                ))}
                {ZEWNETRZNE.map((l) => (
                  <a key={l.href} href={l.href} className={MENU}>
                    {l.icon}
                    {l.label}
                  </a>
                ))}
                <div role="separator" className="my-1 border-t border-hq-line" />
                <button type="button" onClick={() => feed.setIsStreaming(!feed.isStreaming)} className={MENU}>
                  {feed.isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {feed.isStreaming ? tr('Wstrzymaj strumień', 'Pause stream') : tr('Wznów strumień', 'Resume stream')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    feed.syncNow();
                    setWiecej(false);
                  }}
                  className={MENU}
                >
                  <RefreshCw className="w-4 h-4" />
                  {tr('Synchronizuj teraz', 'Sync now')}
                </button>
                <button type="button" aria-pressed={audioEnabled} onClick={() => setAudioEnabled(!audioEnabled)} className={MENU}>
                  {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  {audioEnabled ? tr('Wycisz dźwięk taśmy', 'Mute tape sound') : tr('Włącz dźwięk taśmy', 'Unmute tape sound')}
                </button>
                <div className="px-1.5 py-1">
                  <Jezyk className="flex w-full justify-center" />
                </div>
                <div className="px-1.5">
                  <InstallButton />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      <PaletaPolecen open={paleta} onClose={() => setPaleta(false)} onAkcja={wykonaj} widoki={[...DZIEN, ...WIEDZA]} zewnetrzne={ZEWNETRZNE} />
    </div>
  );
}
