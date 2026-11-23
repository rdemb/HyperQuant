import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CandlestickChart, Clock3, PanelLeftClose, Rows3, Sparkles } from 'lucide-react';
import { lang, tr } from '../i18n';
import type { ViewId } from '../state/types';
import './efekty.css';

/**
 * Efekty powłoki (23.11.2026): kurtyna przy pierwszym otwarciu aplikacji w sesji, ładowanie widoku i okno „Co nowego”
 * z falą przez stronę po „Rozumiem”. Wszystko tylko z transform, opacity i clip-path (bez przesunięć układu), nic nie
 * blokuje klików, ograniczony ruch wyłącza animacje (okno „Co nowego” zostaje, bez fali).
 */

export function ruchOgraniczony(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Znak HyperQuant (pierścień doby, „H” ze świec, kropka „teraz”), rysowany przy otwarciu. */
const Znak: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="40 40 432 432" aria-hidden="true" className={className}>
    <g fill="none" strokeLinecap="round" strokeWidth="30">
      <path className="hq-znak-luk" d="M270.9 78.6A178 178 0 0 1 417.1 331.8" stroke="var(--color-line-strong)" />
      <path className="hq-znak-luk hq-znak-luk2" d="M402.2 357.6A178 178 0 0 1 201.9 425.6" stroke="var(--color-ink-3)" />
      <path className="hq-znak-luk hq-znak-luk3" d="M174.4 414.2A178 178 0 0 1 241.1 78.6" stroke="currentColor" />
    </g>
    <g fill="currentColor">
      <rect className="hq-znak-swieca" x="183" y="150" width="14" height="212" rx="7" />
      <rect className="hq-znak-swieca" x="160" y="184" width="60" height="132" rx="14" />
      <rect className="hq-znak-swieca hq-znak-swieca2" x="315" y="138" width="14" height="196" rx="7" />
      <rect className="hq-znak-swieca hq-znak-swieca2" x="292" y="166" width="60" height="122" rx="14" />
      <rect className="hq-znak-swieca hq-znak-swieca2" x="214" y="238" width="84" height="26" rx="13" />
    </g>
    <circle className="hq-znak-kropka" cx="187.9" cy="420.5" r="34" fill="var(--color-lume)" stroke="var(--color-page)" strokeWidth="12" />
  </svg>
);

const KURTYNA_KLUCZ = 'hq.kurtyna.v1';

/**
 * Kurtyna: raz na sesję karty, przy pierwszym otwarciu aplikacji. Znak rysuje się na środku, po linii wody ekran
 * rozchodzi się w górę i w dół (ten sam gest co przejście między stronami). 1,4 s, kliknięcia przechodzą od razu.
 */
export const Kurtyna: React.FC = () => {
  const [on, setOn] = useState(() => {
    if (ruchOgraniczony()) return false;
    try {
      if (sessionStorage.getItem(KURTYNA_KLUCZ)) return false;
      sessionStorage.setItem(KURTYNA_KLUCZ, '1');
      return true;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 1600);
    return () => window.clearTimeout(t);
  }, [on]);
  if (!on) return null;
  return (
    <div className="hq-kurtyna" aria-hidden="true" data-kurtyna>
      <div className="hq-kurtyna-pol hq-kurtyna-gora" />
      <div className="hq-kurtyna-pol hq-kurtyna-dol" />
      <span className="hq-kurtyna-woda" />
      <div className="hq-kurtyna-znak">
        <Znak className="h-16 w-16 text-ink-1" />
        <span className="hq-kurtyna-nazwa font-display">HyperQuant</span>
      </div>
    </div>
  );
};

/** Ładowanie widoku: obracający się łuk doby z podpisem i szkielety kart (zajmują wysokość ekranu, bez skoku stopki). */
export const LadowanieWidoku: React.FC = () => (
  <div data-view-fallback className="min-h-[calc(100dvh-var(--hq-header-h,6rem))] flex flex-col gap-5 pt-2">
    <div role="status" className="flex items-center gap-3 text-sm text-ink-2">
      <svg viewBox="0 0 40 40" className="hq-ladowanie h-9 w-9" aria-hidden="true">
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--color-line-strong)" strokeWidth="3" />
        <path d="M20 4a16 16 0 0 1 16 16" fill="none" stroke="var(--color-lume)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="20" cy="20" r="3" fill="currentColor" />
      </svg>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{tr('Ładowanie widoku…', 'Loading view…')}</span>
    </div>
    <div aria-hidden="true" className="hq-szkielet h-40 rounded-[28px]" />
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="hq-szkielet h-44 rounded-[22px]" />
      <div className="hq-szkielet h-44 rounded-[22px] [animation-delay:.12s]" />
      <div className="hq-szkielet h-44 rounded-[22px] [animation-delay:.24s]" />
    </div>
  </div>
);

/* ------------------------------------------------ Co nowego ------------------------------------------------ */

/** Wersja okna „Co nowego”: nowa wartość pokazuje okno raz każdemu stałemu użytkownikowi. */
export const NOWOSCI_WERSJA = '2026-11-23-stol';
const NOWOSCI_KLUCZ = 'hq.nowosci';

type Nowosc = { ikona: React.ReactNode; tytul: string; opis: string; widok?: ViewId };
const NOWOSCI: Nowosc[] = [
  {
    ikona: <CandlestickChart className="h-5 w-5" aria-hidden="true" />,
    tytul: tr('Stanowisko z wykresami', 'Workbench with charts'),
    opis: tr(
      'Świece dowolnego rynku i interwału na żywo, gotowe układy: jedna, dwie, trzy kolumny i siatka 2 × 2. Stanowisko ma teraz tę samą nawigację co reszta.',
      'Live candles of any market and timeframe, ready layouts: one, two or three columns and a 2 × 2 grid. The workbench now has the same navigation as the rest.'
    ),
    widok: 'stanowisko',
  },
  {
    ikona: <Clock3 className="h-5 w-5" aria-hidden="true" />,
    tytul: tr('Żywy zegar doby', 'Live day clock'),
    opis: tr('W Dziś: płynna wskazówka, sekundy, postęp sesji i odliczanie do następnej. Nowa cena BTC wysyła falę po tarczy.', 'In Today: a smooth hand, seconds, session progress and a countdown to the next one. Each new BTC price sends a ripple.'),
    widok: 'dzis',
  },
  {
    ikona: <Rows3 className="h-5 w-5" aria-hidden="true" />,
    tytul: tr('Księga i taśma w nowej oprawie', 'Book and tape, redesigned'),
    opis: tr('Kolumna DOM obok wykresu w tym samym stylu co pasek wykresu, w Zorzy i w Opalu.', 'The DOM column next to the chart matches the chart bar, in Zorza and Opal.'),
    widok: 'charts',
  },
  {
    ikona: <PanelLeftClose className="h-5 w-5" aria-hidden="true" />,
    tytul: tr('Menu boczne pod ręką', 'Side menu at hand'),
    opis: tr('Przycisk w lewym górnym rogu albo klawisz \\ chowa i pokazuje menu, także na niskim ekranie laptopa.', 'The button in the top left corner or the \\ key hides and shows the menu, also on a short laptop screen.'),
  },
];

const DATA_WYDANIA = new Intl.DateTimeFormat(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'long' }).format(Date.UTC(2026, 10, 23, 12));

/** Stały użytkownik (był już w aplikacji przed tym wejściem): tylko jemu pokazujemy „Co nowego”. Odczyt przy imporcie modułu. */
const BYL_WCZESNIEJ = (() => {
  try {
    return localStorage.getItem('hq.view.last') !== null;
  } catch {
    return false;
  }
})();

/**
 * Fala przez stronę po „Rozumiem”: pierścień lume rozchodzi się od przycisku, a karty, nagłówek i pozycje menu kolejno
 * podskakują o kilka pikseli z opóźnieniem zależnym od odległości (strona „przyjmuje” aktualizację).
 */
export function falaStrony(x: number, y: number) {
  if (ruchOgraniczony()) return;
  const pierscien = document.createElement('div');
  pierscien.className = 'hq-fala-pierscien';
  pierscien.style.left = `${x}px`;
  pierscien.style.top = `${y}px`;
  document.body.append(pierscien);
  window.setTimeout(() => pierscien.remove(), 1400);
  const vh = window.innerHeight;
  const cele = document.querySelectorAll<HTMLElement>(
    '[data-szyna] li, [data-szyna] > a, [data-app-header] > div > *, [data-pasek-dnia], [data-view-root] section, [data-view-root] article, [data-view-root] [role="listitem"], [data-chart-card], [data-flow-column] > *'
  );
  let n = 0;
  for (const el of cele) {
    if (n > 70 || typeof el.animate !== 'function') break;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.width === 0) continue;
    const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    el.animate(
      [{ transform: 'none' }, { transform: 'translateY(-6px) scale(1.008)', offset: 0.35 }, { transform: 'none' }],
      { duration: 640, delay: Math.min(900, d * 0.55), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
    n++;
  }
}

export const CoNowego: React.FC<{ go: (v: ViewId) => void }> = ({ go }) => {
  const [otwarte, setOtwarte] = useState(false);
  const okno = useRef<HTMLDivElement>(null);
  const rozumiem = useRef<HTMLButtonElement>(null);
  const poprzedniFokus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let widziane: string | null = null;
    try {
      widziane = localStorage.getItem(NOWOSCI_KLUCZ);
      // Nowy użytkownik nie potrzebuje listy zmian: zapis bez okna
      if (!BYL_WCZESNIEJ && widziane !== NOWOSCI_WERSJA) localStorage.setItem(NOWOSCI_KLUCZ, NOWOSCI_WERSJA);
    } catch {
      return;
    }
    if (!BYL_WCZESNIEJ || widziane === NOWOSCI_WERSJA) return;
    // Po kurtynie i pierwszym malowaniu widoku
    const t = window.setTimeout(() => {
      poprzedniFokus.current = document.activeElement as HTMLElement | null;
      setOtwarte(true);
    }, 1700);
    return () => window.clearTimeout(t);
  }, []);

  const zamknij = useCallback((fala: boolean) => {
    try {
      localStorage.setItem(NOWOSCI_KLUCZ, NOWOSCI_WERSJA);
    } catch {
      /* pamięć zablokowana: okno wróci przy następnym wejściu */
    }
    const r = rozumiem.current?.getBoundingClientRect();
    setOtwarte(false);
    poprzedniFokus.current?.focus?.({ preventScroll: true });
    if (fala && r) window.setTimeout(() => falaStrony(r.left + r.width / 2, r.top + r.height / 2), 0);
  }, []);

  useEffect(() => {
    if (!otwarte) return;
    // Fokus na samym oknie (od góry): na niskim ekranie przycisk „Rozumiem” bywa poniżej widoku
    okno.current?.focus({ preventScroll: true });
    okno.current?.scrollTo?.({ top: 0 });
    const onKey = (e: KeyboardEvent) => {
      // Okno modalne: skróty aplikacji (⌘K, \, klawisze wykresu) nie działają pod nim
      e.stopImmediatePropagation();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        zamknij(false);
        return;
      }
      if (e.key !== 'Tab' || !okno.current) return;
      // Fokus zostaje w oknie
      const f = [...okno.current.querySelectorAll<HTMLElement>('button, a[href]')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [otwarte, zamknij]);

  if (!otwarte) return null;
  // W powłoce (nie w <body>): okno bierze tokeny motywu aplikacji
  return (
    <div className="hq-nowosci-tlo" data-co-nowego onPointerDown={(e) => e.target === e.currentTarget && zamknij(false)}>
      <div ref={okno} role="dialog" aria-modal="true" aria-labelledby="hq-nowosci-tytul" tabIndex={-1} className="hq-nowosci outline-none">
        <div className="hq-nowosci-glowa">
          <span className="hq-nowosci-iskra" aria-hidden="true">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">
              {tr('Aktualizacja', 'Update')} · {DATA_WYDANIA}
            </p>
            <h2 id="hq-nowosci-tytul" className="mt-1 font-display text-[clamp(24px,3vw,32px)] font-extrabold leading-none tracking-tight [font-stretch:86%] text-ink-1">
              {tr('Co nowego w HyperQuant', 'What’s new in HyperQuant')}
            </h2>
          </div>
        </div>
        <ol className="hq-nowosci-lista">
          {NOWOSCI.map((n, i) => (
            <li key={n.tytul} style={{ animationDelay: `${0.12 + i * 0.07}s` }}>
              <span className="hq-nowosci-ikona">{n.ikona}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink-1">{n.tytul}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-2 text-pretty">{n.opis}</span>
              </span>
              {n.widok && (
                <a
                  href={`#${n.widok}`}
                  onClick={(e) => {
                    e.preventDefault();
                    zamknij(true);
                    go(n.widok!);
                  }}
                  className="shrink-0 self-center inline-flex h-9 items-center rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-1 hover:bg-surface-2"
                >
                  {tr('Pokaż', 'Show')}
                </a>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <a href={tr('./co-nowego/', './en/whats-new/')} className="text-xs text-ink-3 underline decoration-line-strong hover:text-ink-1">
            {tr('Pełna historia zmian', 'Full change history')}
          </a>
          <button ref={rozumiem} type="button" data-nowosci-rozumiem onClick={() => zamknij(true)} className="hq-przycisk-lume inline-flex h-11 items-center rounded-full px-6 text-sm font-semibold">
            {tr('Rozumiem', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
};
