import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Bot, FlaskConical, GraduationCap, Newspaper, Table2 } from 'lucide-react';
import { useDesk } from '../state/DeskContext';
import type { ViewId } from '../state/types';
import { useLiqMap } from '../state/useLiqMap';
import { useDeskLedger } from '../state/useDeskLedger';
import { SESSION_LABEL, type SessionId } from '../charts/pro/core/sessions';
import { Badge, type BadgeTone, DASH, EmptyState, LocalBoundary, fmtFixed } from '../ui';
import { DUR, EASE_OUT } from '../ui/motion';
import { lang, tr } from '../i18n';
import { SessionDial } from './start/SessionDial';
import { type DayPhase, dayPhase, fmtSpan, sessionClock, useNow } from '../shell/dzien';
import { FlowReel } from './start/FlowReel';
import { MarketsNow } from './start/MarketsNow';
import { ENABLED_MARKETS, deskMarketOf, deskPhrase } from '../config/deskMarkets';

// Czwórka i teren rysowany canvasem: osobne pakiety, ładowane dopiero pod hero (pierwszy ekran bez modułów wykresu)
const FourCard = lazy(() => import('./before/FourCard').then((m) => ({ default: m.FourCard })));
const LiquidityTerrain = lazy(() => import('./start/LiquidityTerrain'));

/** Rynek Czwórki na Starcie: wybór z „Rynków teraz”, zapamiętany na urządzeniu (domyślnie BTC; mapa i dziennik zostają dla BTC) */
const START_MARKET_KEY = 'hq.start.market.v1';
function readStartMarket(): string {
  try {
    const v = window.localStorage.getItem(START_MARKET_KEY);
    return v && ENABLED_MARKETS.some((m) => m.coin === v) ? v : 'BTC';
  } catch {
    return 'BTC';
  }
}
function useStartMarket(): [string, (coin: string) => void] {
  const [coin, setCoin] = useState(readStartMarket);
  const set = (c: string) => {
    setCoin(c);
    try {
      window.localStorage.setItem(START_MARKET_KEY, c);
    } catch {
      // Pamięć zablokowana: wybór tylko na tę wizytę
    }
  };
  return [coin, set];
}
const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';

type Phase = DayPhase;

function cta(phase: Phase, session: SessionId): string {
  if (phase === 'before') return tr('Przygotuj sesję Londynu', 'Prepare for the London session');
  if (phase === 'after') return tr('Rozlicz dzień', 'Review the day');
  return session === 'london' ? tr('Wejdź w sesję Londynu', 'Enter the London session') : tr('Wejdź w sesję Nowego Jorku', 'Enter the New York session');
}

/** Widoczność elementu (raz): leniwe rozdziały ładują się, gdy zbliżają się do ekranu */
function useSeen<E extends Element>(): [React.RefObject<E | null>, boolean] {
  const ref = useRef<E>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

const time = (ms: number, seconds = false) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: 'h23' }).format(ms);
const zone = (ms: number) => new Intl.DateTimeFormat(LOCALE, { timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';

/** Tarcza i zegar: jedyny element odświeżany co sekundę */
const HeroClock: React.FC = () => {
  const now = useNow(1000);
  const c = sessionClock(now);
  return (
    <>
      {/* Duża tarcza zależy od szerokości sekcji (kontener), nie okna (szyna nawigacji zabiera 88–240 px). Cała tarcza
          w sekcji, bez wysunięcia za prawą krawędź: skala (transformacja, ostra: SVG i tekst) rośnie z szerokością treści,
          tak żeby obok tytułu (640 px) zostało miejsce; poniżej 1060 px treści — mała tarcza nad tytułem. */}
      <div className="pointer-events-none absolute top-6 right-6 lg:right-10 hidden origin-top-right @min-[1060px]:block @min-[1060px]:scale-[0.6] @min-[1250px]:scale-[0.72] @min-[1500px]:scale-[0.86] @min-[1700px]:scale-100" aria-hidden={false}>
        <SessionDial now={now} />
        <div className="absolute top-[410px] left-[410px] flex -translate-x-1/2 -translate-y-[54%] flex-col items-center gap-2.5 text-center">
          <span className="text-[11px] font-bold tracking-[0.14em] text-ink-2 uppercase">
            {tr('Czas lokalny', 'Local time')} · {zone(now)}
          </span>
          <span className="font-mono tabular-nums text-[112px] leading-[0.9] font-light tracking-[-0.04em]">{time(now)}</span>
          <span className="font-mono tabular-nums text-[13px] text-ink-3">{new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(now)} UTC</span>
          <span className="mt-2.5 flex flex-col gap-1 border-t border-line pt-3 text-sm text-ink-2">
            <span>
              <strong className="text-ink-1">{SESSION_LABEL[c.current.id]}</strong> {tr('trwa', 'running')} <span className="font-mono tabular-nums text-ink-1">{fmtSpan(c.elapsed)}</span>
            </span>
            <span>
              <strong className="text-ink-1">{SESSION_LABEL[c.next.id]}</strong> {tr('za', 'in')} <span className="font-mono tabular-nums text-ink-1">{fmtSpan(c.untilNext)}</span>
            </span>
          </span>
        </div>
      </div>
      <div className="relative mx-auto mb-8 grid w-[300px] place-items-center @min-[1060px]:hidden">
        <SessionDial now={now} size={300} detailed={false} />
        <span className="absolute flex flex-col items-center">
          <span className="font-mono tabular-nums text-[54px] leading-none font-light tracking-[-0.04em]">{time(now)}</span>
          <span className="text-xs text-ink-2">
            <strong className="text-ink-1">{SESSION_LABEL[c.current.id]}</strong> <span className="font-mono tabular-nums">{fmtSpan(c.elapsed)}</span>
          </span>
        </span>
      </div>
    </>
  );
};

const Chapter: React.FC<{ nr: string; eyebrow: string; title: string; lead: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ nr, eyebrow, title, lead, aside, children }) => {
  const reduce = useReducedMotion();
  return (
    <section className="border-t border-line px-4 py-16 lg:px-14 lg:py-24">
      <motion.div className="mb-10 flex flex-wrap items-end justify-between gap-x-16 gap-y-6" initial={reduce ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: DUR.ui, ease: EASE_OUT }}>
        <div className="max-w-2xl">
          <p className="mb-5 flex items-center gap-3.5 text-xs font-bold tracking-[0.14em] text-ink-2 uppercase">
            <span className="font-mono tracking-normal">Nº {nr}</span>
            <span aria-hidden="true" className="h-px w-12 bg-ink-1" />
            {eyebrow}
          </p>
          <h2 className="display text-[clamp(36px,4.4vw,64px)] leading-[0.95] font-extrabold text-balance">{title}</h2>
          <p className="mt-5 text-base text-pretty text-ink-2 lg:text-lg">{lead}</p>
        </div>
        {aside}
      </motion.div>
      {children}
    </section>
  );
};

/**
 * Start: fazy dnia z tarczą sesji, Czwórka (te same liczby co Przed sesją), krajobraz płynności z mapy skanera,
 * animacja poglądowa przepływu (SIM), rejestr prognoz i pochodzenie liczb jako język wizualny.
 * Pierwsza wizyta otwiera Start; powrót — ostatnio używany widok (route.landingView).
 */
const StartView: React.FC = () => {
  const { setView } = useDesk();
  const reduce = useReducedMotion();
  const now = useNow(30_000);
  const { phase, session } = dayPhase(now);
  const liq = useLiqMap();
  const ledger = useDeskLedger();
  const [terrainRef, terrainSeen] = useSeen<HTMLDivElement>();
  // Czwórka ciągnie moduły Przed sesją (~150 KB gzip): ładowana dopiero przy ekranie, żeby nie blokować pierwszego widoku
  const [fourRef, fourSeen] = useSeen<HTMLElement>();
  const [startCoin, setStartCoin] = useStartMarket();
  const startLabel = deskMarketOf(startCoin)?.label ?? startCoin;
  // Rynki bez pełnego skanera: dla nich nie ma pozycji, likwidacji ani dziennika prognoz
  const rest = ENABLED_MARKETS.filter((m) => m.scanner !== 'full');
  const otherMarkets = deskPhrase('pl', 'gen', rest);
  const otherMarketsEn = deskPhrase('en', 'nom', rest);
  const go = (v: ViewId) => (e: React.MouseEvent) => {
    e.preventDefault();
    setView(v);
  };
  const lines: { id: Phase; text: string }[] = [
    { id: 'before', text: tr('Przed sesją.', 'Before.') },
    { id: 'charts', text: tr('W sesji.', 'In session.') },
    { id: 'after', text: tr('Po sesji.', 'After.') },
  ];
  const map = liq.map;
  const mapShown = map && (liq.status === 'ready' || liq.status === 'delayed');
  const mapWhy =
    liq.status === 'unconfigured' ? tr('brak adresu danych skanera w tym buildzie', 'no scanner data address in this build')
    : liq.status === 'loading' ? tr('wczytuję mapę skanera…', 'loading the scanner map…')
    : liq.status === 'error' ? tr('mapa skanera niedostępna', 'scanner map unavailable')
    : tr('mapa skanera nieświeża, liczby ukryte', 'scanner map stale, numbers hidden');
  const sum = ledger.summary;
  const r60 = sum?.scores.ret['60'];
  const ledgerOk = sum && (ledger.status === 'ready' || ledger.status === 'stale');

  return (
    <div className="-mx-4 -mt-4 lg:-mx-6">
      {/* Hero: trzy czasy dnia i tarcza 24 h */}
      <section aria-labelledby="start-title" className="@container grid-paper relative overflow-hidden px-4 pt-10 pb-14 lg:px-14 lg:pt-16">
        <HeroClock />
        <motion.div className="relative max-w-[640px] @min-[1060px]:min-h-[520px] @min-[1250px]:min-h-[600px] @min-[1500px]:min-h-[720px]" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.ui, ease: EASE_OUT }}>
          <p className="mb-8 flex items-center gap-3.5 text-xs font-bold tracking-[0.14em] text-ink-2 uppercase lg:mb-10">
            <span className="font-mono tracking-normal">Nº 01</span>
            <span aria-hidden="true" className="h-px w-12 bg-ink-1" />
            {tr(`desk ${deskPhrase('pl', 'gen')} · Hyperliquid`, `a ${deskPhrase('en')} desk · Hyperliquid`)}
          </p>
          <h1 id="start-title" className="display flex flex-col text-[clamp(52px,7.2vw,104px)] leading-[0.92] font-extrabold">
            {lines.map((x) =>
              x.id === phase ? (
                <span key={x.id} className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {x.text}
                  <span className="inline-flex h-[30px] items-center rounded-full border-[1.5px] border-ink-1 bg-lume px-3 font-sans text-xs font-bold tracking-[0.06em] text-[#111315] uppercase [font-stretch:100%]">
                    {phase === 'after' ? tr('teraz · po zamknięciu Wall Street', 'now · after the Wall Street close') : `${tr('teraz', 'now')} · ${SESSION_LABEL[session]}`}
                  </span>
                </span>
              ) : (
                <span key={x.id} className="hollow font-bold">
                  {x.text}
                </span>
              )
            )}
          </h1>
          <p className="mt-9 max-w-[500px] text-lg text-pretty text-ink-2">
            {tr(
              `Darmowy, otwarty desk do day tradingu na Hyperliquid: ${deskPhrase('pl')}. Opisuje strukturę rynku w trzech czasach dnia. Nigdy nie zgaduje kierunku.`,
              `A free, open desk for day trading on Hyperliquid: ${deskPhrase('en')}. It describes market structure in the three tenses of the day. It never guesses direction.`
            )}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a href={`#${phase}`} onClick={go(phase)} className="inline-flex h-[54px] items-center gap-3 rounded-full bg-ink-1 px-6 text-base font-bold text-page transition-transform duration-150 hover:-translate-y-px">
              {cta(phase, session)}
              <span aria-hidden="true" className="size-2 rounded-full bg-lume" />
            </a>
            <a href="#sources" onClick={go('sources')} className="text-[15px] font-semibold underline decoration-line-strong underline-offset-[5px] hover:decoration-ink-1">
              {tr('Skąd jest każda liczba', 'Where every number comes from')}
            </a>
          </div>
          {/* Rynki teraz: rynki desku z konfiguracji (projekt 60, §8) */}
          <MarketsNow selected={startCoin} onSelect={setStartCoin} />
        </motion.div>
      </section>

      {/* Czwórka: te same cztery liczby i ta sama funkcja co Przed sesją (i serwer MCP) */}
      <section ref={fourRef} aria-label={tr(`Cztery liczby: ${startLabel}`, `Four numbers: ${startLabel}`)} className="border-t border-line px-4 py-10 lg:px-14">
        <LocalBoundary what={tr('Czwórka', 'Four numbers')}>
          <Suspense fallback={<div className="h-[180px] rounded-xl border border-line bg-surface-1" />}>
            {fourSeen ? <FourCard key={startCoin} coin={startCoin} /> : <div className="h-[180px] rounded-xl border border-line bg-surface-1" />}
          </Suspense>
        </LocalBoundary>
      </section>

      {/* Głębia tylko dla BTC: pozycje, likwidacje, przepływ kont i dziennik prognoz (projekt 60, S4) */}
      <div data-tylko-btc className="border-t border-line px-4 pt-12 lg:px-14">
        <p className="text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">{tr('Tylko BTC: pozycje, likwidacje i prognozy', 'BTC only: positions, liquidations and forecasts')}</p>
        <p className="mt-2 max-w-[640px] text-sm text-ink-2">
          {tr(
            `Dla ${otherMarkets} tych danych nie ma: Hyperliquid nie udostępnia pozycji rynków HIP-3, a dziennik prognoz prowadzimy dla BTC. Dlatego poniższe rozdziały są zawsze o BTC.`,
            `There is no such data for ${otherMarketsEn}: Hyperliquid does not expose positions on HIP-3 markets, and the forecast ledger covers BTC. So the chapters below are always about BTC.`
          )}
        </p>
      </div>

      <Chapter
        nr="02"
        eyebrow={tr('Przed sesją', 'Pre-session')}
        title={tr('Gdzie leży paliwo BTC?', 'Where is the BTC fuel?')}
        lead={tr(
          'Mapa likwidacji ze skanera HyperQuant jako teren: grzbiety to ceny, przy których otwarte pozycje zostałyby zamknięte. Przód to szczegół, tył to szeroki kształt.',
          'The HyperQuant scanner liquidation map as a landscape: ridges are prices where open positions would be closed. The front is detail, the back is the broad shape.'
        )}
        aside={
          <div className="flex flex-col items-start gap-2 text-[13px] text-ink-2">
            <Badge tone="neutral" title={tr('Mapa likwidacji istnieje tylko dla BTC (pozycje on-chain z pełnego skanera)', 'The liquidation map exists for BTC only (on-chain positions from the full scanner)')}>
              BTC
            </Badge>
            {mapShown && map ? (
              <Badge tone="live" title={tr('Mapa skanera z pozycji on-chain', 'Scanner map from on-chain positions')}>
                LIVE · {time(map.asOf)} · {fmtFixed(map.coverage.share * 100, 0)}% OI
              </Badge>
            ) : (
              <span className="text-ink-3">{mapWhy}</span>
            )}
            <Badge tone="model" title={tr('Wygładzanie jądrem Gaussa w wielu skalach', 'Gaussian kernel smoothing at several scales')}>
              MODEL · {tr('wygładzanie 80–1400 USD', 'smoothing 80–1400 USD')}
            </Badge>
          </div>
        }
      >
        <div ref={terrainRef} className="-mx-4 lg:-mx-14">
          {terrainSeen && mapShown && map ? (
            <Suspense fallback={<div className="h-[480px]" />}>
              <LiquidityTerrain map={map} price={map.markPx} />
            </Suspense>
          ) : (
            <div className="grid h-[480px] place-items-center text-[13px] text-ink-3">{mapShown ? '' : mapWhy}</div>
          )}
        </div>
        <p className="mt-4 text-xs text-ink-3">{tr('Cena przy mapie: cena znakowa z migawki skanera (nie z tej sekundy).', 'Price at the map: the mark price of the scanner snapshot (not this second).')}</p>
        {deskMarketOf(startCoin)?.scanner !== 'full' && (
          <p data-teren-tylko-btc className="mt-2 text-xs text-ink-2">
            {tr(
              `Wybrany rynek: ${startLabel}. Mapa likwidacji istnieje tylko dla BTC (Hyperliquid nie udostępnia pozycji rynków HIP-3), więc ten rozdział zawsze pokazuje BTC.`,
              `Selected market: ${startLabel}. The liquidation map exists for BTC only (Hyperliquid does not expose positions on HIP-3 markets), so this chapter always shows BTC.`
            )}
          </p>
        )}
      </Chapter>

      <Chapter
        nr="03"
        eyebrow={tr('W sesji', 'In session')}
        title={tr('Przepływ, który widać gołym okiem.', 'Order flow you can see.')}
        lead={tr(
          'Kto uderza w rynek, kto stoi w księdze i co z niej znika. Taśma, footprint i heatmapa składają się w jeden obraz zamiast trzech okien.',
          'Who hits the market, who rests in the book and what disappears from it. Tape, footprint and heatmap form one picture instead of three windows.'
        )}
        aside={
          <a href="#charts" onClick={go('charts')} className="inline-flex h-[52px] items-center gap-3 rounded-full bg-ink-1 px-6 font-bold text-page">
            {tr('Otwórz Kokpit', 'Open the Cockpit')} <span aria-hidden="true" className="size-2 rounded-full bg-lume" />
          </a>
        }
      >
        <div className="grid gap-10 2xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
          <FlowReel />
          <ol className="flex flex-col border-t border-line text-sm text-ink-2">
            {[
              [tr('Taśma z pamięcią.', 'Tape with memory.'), tr('Plastry TWAP jednego konta sklejone w jeden rosnący wiersz.', "One account's TWAP slices glued into one growing row.")],
              [tr('Footprint rośnie z przybliżeniem.', 'Footprint grows as you zoom.'), tr('Świeca, potem profil w świecy, potem komórki z liczbami.', 'A candle, then a profile inside it, then cells with numbers.')],
              [tr('Ściany: zjedzone czy wycofane.', 'Walls: eaten or pulled.'), tr('Werdykt z porównania migawek księgi co około 5 sekund.', 'A verdict from comparing book snapshots about every 5 seconds.')],
            ].map(([a, b], i) => (
              <li key={a} className="flex gap-4 border-b border-line py-4">
                <span className="font-mono text-ink-1">0{i + 1}</span>
                <span>
                  <strong className="text-ink-1">{a}</strong> {b}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </Chapter>

      <Chapter
        nr="04"
        eyebrow={tr('Po sesji', 'Post-session')}
        title={tr('Ile był wart model?', 'What was the model worth?')}
        lead={tr(
          'Co 15 minut prognozy trafiają do dziennika przed faktem: łańcuch SHA-256, kotwica w Bitcoinie, rozliczenie ze świec 1m. Każdy może przeliczyć wyniki sam.',
          'Every 15 minutes forecasts go into the ledger before the fact: a SHA-256 chain, a Bitcoin anchor, settlement from 1m candles. Anyone can recompute the scores.'
        )}
        aside={
          <a href="#after" onClick={go('after')} className="inline-flex h-[52px] items-center gap-3 rounded-full border-[1.5px] border-ink-1 px-6 font-bold">
            {tr('Dziennik i rozliczenie', 'Ledger and review')}
          </a>
        }
      >
        {ledgerOk && r60 ? (
          <div className="grid gap-10 lg:grid-cols-2">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-8">
              {(
                [
                [tr('Pokrycie 90% · 1 h', '90% coverage · 1 h'), r60.cov90 ? `${fmtFixed(r60.cov90.rate * 100, 1)}%` : DASH, 'model' as const, 'HAR + FHS'],
                ['CRPSS · 1 h', r60.crpss === null ? DASH : fmtFixed(r60.crpss, 3), 'live' as const, tr('vs rozkład normalny', 'vs normal benchmark')],
                [tr('Brier dotknięć', 'Touch Brier'), sum.scores.touch.brier === null ? DASH : fmtFixed(sum.scores.touch.brier, 3), 'live' as const, `${tr('bazowo', 'base')} ${sum.scores.touch.brierBase === null ? DASH : fmtFixed(sum.scores.touch.brierBase, 3)}`],
                [tr('Rozstrzygnięte prognozy · 1 h', 'Settled forecasts · 1 h'), fmtFixed(r60.n, 0), 'live' as const, `${tr('dziennik', 'ledger')} ${time(sum.asOf)}`],
                ] as [string, string, BadgeTone, string][]
              ).map(([k, v, tone, meta]) => (
                <div key={k} className="flex flex-col gap-2">
                  <dt className="text-[11px] font-bold tracking-[0.1em] text-ink-2 uppercase">{k}</dt>
                  <dd className="font-mono tabular-nums text-[32px] leading-none tracking-[-0.02em]">{v}</dd>
                  <dd className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                    <Badge tone={tone} card={tone === 'model' ? 'ledger' : undefined}>
                      {tone === 'live' ? 'LIVE' : 'MODEL'}
                    </Badge>
                    {meta}
                  </dd>
                </div>
              ))}
            </dl>
            <figure className="m-0 flex flex-col gap-3">
              <figcaption className="text-[13px] text-ink-2">
                <strong className="text-ink-1">PIT · 1 h</strong> — {tr('równe słupki = rozkład skalibrowany; linia przerywana = idealna wysokość', 'even bars = a calibrated distribution; dashed line = the ideal height')}
              </figcaption>
              <div className="relative flex h-48 items-end gap-1.5 border-b border-ink-1" role="img" aria-label={`PIT: ${r60.pitHist.join(', ')}`}>
                {(() => {
                  const h = r60.pitHist;
                  const max = Math.max(...h, 1);
                  const even = h.reduce((a, b) => a + b, 0) / Math.max(1, h.length);
                  return (
                    <>
                      <span aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-ink-3" style={{ bottom: `${(even / max) * 100}%` }} />
                      {h.map((v, i) => (
                        <motion.span key={i} className="flex-1 bg-ink-1" initial={reduce ? false : { height: 0 }} whileInView={{ height: `${(v / max) * 100}%` }} viewport={{ once: true }} transition={{ duration: DUR.ui, ease: EASE_OUT, delay: reduce ? 0 : i * 0.03 }} style={{ height: `${(v / max) * 100}%` }} />
                      ))}
                    </>
                  );
                })()}
              </div>
            </figure>
          </div>
        ) : (
          <EmptyState title={ledger.status === 'loading' ? tr('Wczytuję dziennik prognoz…', 'Loading the forecast ledger…') : tr('Dziennik prognoz niedostępny', 'Forecast ledger unavailable')} />
        )}
      </Chapter>

      {/* Pochodzenie liczby jako język wizualny */}
      <section aria-labelledby="prov-title" className="mx-4 grid gap-x-10 gap-y-7 rounded-2xl bg-ink-1 p-8 text-page lg:mx-14 lg:grid-cols-5 lg:p-11">
        <h2 id="prov-title" className="display text-[32px] leading-[1.02] font-bold">
          {tr('Pochodzenie liczby jest częścią liczby.', "A number's origin is part of the number.")}
        </h2>
        {[
          ['LIVE', 'bg-lume', tr('Pobrane z API przed chwilą, zawsze z godziną odczytu. Nieświeże gaśnie do „—”.', 'Fetched from the API just now, always with its read time. Stale data fades to “—”.')],
          ['MODEL', 'bg-[linear-gradient(90deg,var(--color-page)_50%,transparent_50%)]', tr('Policzone nazwaną metodą: HAR, mediana 20 dni, Dalton. Nazwa stoi przy liczbie.', 'Computed by a named method: HAR, 20-day median, Dalton. The name sits next to the number.')],
          ['SIM', 'border-dashed', tr('Symulacja jest zawsze podpisana. Brak danych to kreska i powód, nigdy liczba na niby.', 'Simulation is always labelled. Missing data is a dash and a reason, never a stand-in number.')],
          ['HIP-3', 'bg-transparent', tr('Rynki HIP-3 (trade.xyz): cena z wyroczni rynku bazowego; poza jego godzinami wycena samej platformy, oznaczona jako „cena platformy”.', 'HIP-3 markets (trade.xyz): the price comes from the underlying market oracle; outside its hours it is the platform’s own price, marked “platform price”.')],
        ].map(([k, mark, v]) => (
          <p key={k} className="flex flex-col gap-2">
            <span className="flex items-center gap-2.5 text-[13px] font-bold tracking-[0.08em]">
              <span aria-hidden="true" className={`size-3.5 rounded-full border-2 border-page ${mark}`} />
              {k}
            </span>
            <span className="text-sm opacity-80">{v}</span>
          </p>
        ))}
      </section>

      {/* Reszta HyperQuant */}
      <section aria-label={tr('Więcej w HyperQuant', 'More in HyperQuant')} className="px-4 py-16 lg:px-14 lg:py-20">
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3 xl:grid-cols-5">
          {(
            [
              ['markets', <Table2 key="i" className="w-[22px] h-[22px]" />, tr('Rynki', 'Markets')],
              ['lessons', <GraduationCap key="i" className="w-[22px] h-[22px]" />, tr('Lekcje', 'Lessons')],
              ['research', <FlaskConical key="i" className="w-[22px] h-[22px]" />, tr('Badania', 'Research')],
              ['agents', <Bot key="i" className="w-[22px] h-[22px]" />, tr('Agenci AI', 'AI agents')],
              ['blog', <Newspaper key="i" className="w-[22px] h-[22px]" />, tr('Blog', 'Blog (PL)')],
            ] as const
          ).map(([id, icon, label]) => (
            <li key={id} className="bg-surface-1">
              <a
                href={id === 'blog' ? './blog/' : `#${id}`}
                onClick={id === 'blog' ? undefined : go(id)}
                className="group flex h-full min-h-[140px] flex-col justify-between gap-6 p-6 transition-colors duration-150 hover:bg-surface-2"
              >
                <span className="flex items-center justify-between">
                  {icon}
                  <ArrowUpRight aria-hidden="true" className="w-[18px] h-[18px] text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink-1" />
                </span>
                <span className="display text-xl font-bold">{label}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default StartView;
