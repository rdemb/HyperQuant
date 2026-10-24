import React from 'react';
import { Activity, ArrowDown, ArrowRight, Box, ChartCandlestick, Database, Globe2, GraduationCap, LayoutDashboard, Newspaper, Target } from 'lucide-react';
import { useDesk } from '../../state/DeskContext';
import { ViewId } from '../../state/types';
import { tr } from '../../i18n';

interface MapItem {
  /** Widok aplikacji albo zewnętrzna strona (blog to osobne strony statyczne). */
  target: ViewId | { href: string };
  name: string;
  icon: React.ReactNode;
  text: string;
}

// Kolejność jak w nawigacji, żeby mapa i menu mówiły to samo
const MAP: MapItem[] = [
  {
    target: 'desk',
    name: 'Desk',
    icon: <LayoutDashboard className="w-4 h-4" />,
    text: tr(
      'Na tej stronie: arkusz zleceń z taśmą, pas kontekstu rynku, mapa likwidacji, przepływ kohort i szybka ocena planu.',
      'On this page: order book with the tape, market context strip, liquidation map, cohort flow and a quick plan check.'
    ),
  },
  {
    target: 'charts',
    name: tr('Wykresy', 'Charts'),
    icon: <ChartCandlestick className="w-4 h-4" />,
    text: tr(
      'Orderflow BTC, ETH, SOL i HYPE na żywo: footprint, mapa płynności, bąble dużych zleceń, VWAP, profil, TPO i rysowanie.',
      'Live BTC, ETH, SOL and HYPE order flow: footprint, liquidity heatmap, large-order bubbles, VWAP, profile, TPO and drawing tools.'
    ),
  },
  {
    target: 'plan',
    name: tr('Analizator planu', 'Plan Analyzer'),
    icon: <Target className="w-4 h-4" />,
    text: tr(
      'Wpisz wejście, stop i cel: szansa celu przed stopem, poślizg, wynik po opłatach, zapas do likwidacji i dzienniki.',
      'Enter entry, stop and target: odds of target before stop, slippage, result after fees, liquidation buffer and journals.'
    ),
  },
  {
    target: 'market',
    name: tr('Rynek', 'Market'),
    icon: <Globe2 className="w-4 h-4" />,
    text: tr(
      'Model desku obok rynków predykcyjnych, funding na trzech giełdach, S&P 500, złoto i ropa, kalendarz makro i wiadomości.',
      'The Desk model next to prediction markets, funding on three exchanges, S&P 500, gold and oil, macro calendar and news.'
    ),
  },
  {
    target: 'lab',
    name: 'Lab 3D',
    icon: <Box className="w-4 h-4" />,
    text: tr(
      'Pięć scen 3D: płynność, przepływ, delta, ryzyko likwidacji i opcje, każda z opisem, jak ją czytać.',
      'Five 3D scenes: liquidity, flow, delta, liquidation risk and options, each with a guide on how to read it.'
    ),
  },
  {
    target: 'micro',
    name: tr('Mikrostruktura', 'Microstructure'),
    icon: <Activity className="w-4 h-4" />,
    text: tr(
      'Jak pracuje arkusz: płynność o każdej godzinie, koszt wejścia Twoją wielkością, OFI, VPIN i wielkość pozycji.',
      'How the book works: liquidity at every hour, the cost of entering with your size, OFI, VPIN and position sizing.'
    ),
  },
  {
    target: 'lessons',
    name: tr('Lekcje', 'Lessons'),
    icon: <GraduationCap className="w-4 h-4" />,
    text: tr(
      'Ćwiczenia na prawdziwych dniach BTC, atlas wskaźników z Wykresów, jak je łączyć, mity zestawione z danymi i symulator ryzyka.',
      'Exercises on real BTC days, an atlas of the indicators from Charts, how to combine them, myths checked against data and a risk simulator.'
    ),
  },
  {
    target: 'sources',
    name: tr('Źródła', 'Sources'),
    icon: <Database className="w-4 h-4" />,
    text: tr(
      'Skąd jest każda liczba: źródło, metoda, odświeżanie i licencje. Tu włączysz też dane z Binance i Bybit.',
      'Where every number comes from: source, method, refresh rate and licences. This is also where you turn on Binance and Bybit data.'
    ),
  },
  {
    target: { href: './blog/' },
    name: tr('Blog', 'Blog (PL)'),
    icon: <Newspaper className="w-4 h-4" />,
    text: tr(
      'Analizy BTC pisane przed faktem: mapa dnia, mapa przed Nowym Jorkiem, aktualizacje i podsumowanie dnia.',
      'BTC analysis written before the fact, in Polish: day map, pre-New York map, updates and the daily summary.'
    ),
  },
];

const cardCls =
  'group flex gap-3 p-3.5 rounded-lg border border-line bg-page/40 text-left hover:bg-surface-2 hover:border-line-strong transition-colors duration-150';

/** Powitanie i mapa strony: bohater ekranu Desk, statyczny, widoczny od pierwszej chwili (bez czekania na dane). */
export const WelcomePanel: React.FC = () => {
  const { setView } = useDesk();

  const go = (e: React.MouseEvent, v: ViewId) => {
    e.preventDefault();
    setView(v);
    window.scrollTo({ top: 0 });
  };

  return (
    <section className="flex-1 bg-surface-1 border border-line-strong rounded-xl p-4 sm:p-6 flex flex-col gap-6 min-w-0">
      <div className="flex flex-col gap-3 max-w-3xl">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{tr('BTC · Hyperliquid · dane na żywo', 'BTC · Hyperliquid · live data')}</div>
        <h1 className="font-display text-[28px] leading-tight font-bold tracking-tight">{tr('Witaj w HyperQuant', 'Welcome to HyperQuant')}</h1>
        <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
          {tr(
            'Otwarty desk do day tradingu BTC zbudowany na publicznych danych Hyperliquid. Pokazuje przepływ zleceń, płynność arkusza, poziomy dnia i kontekst rynku, a każda liczba z modelu jest oznaczona. Desk nie daje sygnałów kupna ani sprzedaży. Pomaga ocenić plan, który przygotowujesz sam.',
            'An open BTC day-trading desk built on public Hyperliquid data. It shows order flow, book liquidity, daily levels and market context, and every model number is labelled. The Desk gives no buy or sell signals. It helps you assess the plan you prepare yourself.'
          )}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="#charts"
            onClick={(e) => go(e, 'charts')}
            className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-md bg-accent/15 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/25 transition-colors"
          >
            {tr('Otwórz wykresy', 'Open charts')}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </a>
          <a
            href="#plan"
            onClick={(e) => go(e, 'plan')}
            className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-md bg-surface-3 border border-line-strong text-ink-1 text-sm font-medium hover:bg-surface-2 transition-colors"
          >
            {tr('Oceń swój plan', 'Check your plan')}
          </a>
        </div>
      </div>

      <nav aria-labelledby="site-map-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-4">
          <h2 id="site-map-title" className="font-display text-base font-semibold">
            {tr('Mapa strony', 'Site map')}
          </h2>
          <span className="text-xs text-ink-3">{tr('Co znajdziesz w każdej zakładce', 'What you will find in each tab')}</span>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {MAP.map((m) => (
            <li key={m.name} className="flex">
              <MapCard item={m} onGo={go} />
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
};

const MapCard: React.FC<{ item: MapItem; onGo: (e: React.MouseEvent, v: ViewId) => void }> = ({ item, onGo }) => {
  const here = item.target === 'desk';
  const body = (
    <>
      <span className="shrink-0 w-9 h-9 rounded-lg bg-surface-2 border border-line text-accent flex items-center justify-center" aria-hidden="true">
        {item.icon}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink-1">
            {item.name}
            {here && <span className="ml-2 text-[11px] font-medium text-accent">{tr('jesteś tutaj', 'you are here')}</span>}
          </span>
          {here ? (
            <ArrowDown className="w-4 h-4 text-ink-3 group-hover:text-ink-1 transition-colors" aria-hidden="true" />
          ) : (
            <ArrowRight className="w-4 h-4 text-ink-3 group-hover:text-ink-1 transition-colors" aria-hidden="true" />
          )}
        </span>
        <span className="text-[13px] text-ink-2 leading-relaxed">{item.text}</span>
      </span>
    </>
  );

  // Desk: przewinięcie tuż za powitanie (telefon: arkusz z taśmą, desktop: pas kontekstu), bez zmiany adresu
  if (here) {
    return (
      <button
        type="button"
        onClick={(e) => {
          const section = e.currentTarget.closest('section');
          if (!section) return;
          const header = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          window.scrollTo({ top: section.getBoundingClientRect().bottom + window.scrollY - header, behavior: reduce ? 'auto' : 'smooth' });
        }}
        className={`${cardCls} w-full`}
      >
        {body}
      </button>
    );
  }
  const t = item.target;
  return typeof t === 'string' ? (
    <a href={`#${t}`} onClick={(e) => onGo(e, t)} className={`${cardCls} w-full`}>
      {body}
    </a>
  ) : (
    <a href={t.href} className={`${cardCls} w-full`}>
      {body}
    </a>
  );
};
