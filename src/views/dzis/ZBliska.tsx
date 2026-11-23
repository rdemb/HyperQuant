import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { ENABLED_MARKETS, deskPhrase } from '../../config/deskMarkets';
import { lang, tr } from '../../i18n';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useLiqMap } from '../../state/useLiqMap';
import { Badge, type BadgeTone, DASH, EmptyState, LocalBoundary, fmtFixed } from '../../ui';
import { DUR, EASE_OUT } from '../../ui/motion';
import { FlowReel } from '../start/FlowReel';

/**
 * „Z bliska · BTC” na ekranie Dziś: rozdziały dawnego Startu, które mają dane tylko dla BTC. Krajobraz płynności z mapy
 * skanera (LIVE z godziną i pokryciem OI, wygładzanie MODEL), poglądowy przepływ (SIM), dziennik prognoz z wynikami
 * (LIVE/MODEL) i pochodzenie liczb. Teren i dziennik ładują się dopiero przy zbliżeniu do ekranu.
 */

const LiquidityTerrain = lazy(() => import('../start/LiquidityTerrain'));

const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';
const time = (ms: number) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

/** Widoczność elementu (raz): ciężkie rozdziały ładują się, gdy zbliżają się do ekranu */
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

const Rozdzial: React.FC<{ id: string; nr: string; eyebrow: string; title: string; lead: string; aside?: React.ReactNode; children: React.ReactNode }> = ({
  id,
  nr,
  eyebrow,
  title,
  lead,
  aside,
  children,
}) => (
  <article aria-labelledby={id} className="hq-karta-dzis relative flex flex-col gap-6 overflow-hidden rounded-[22px] p-5 sm:p-8">
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
      <div className="min-w-0 max-w-2xl">
        <p className="mb-4 flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          <span className="tracking-normal text-ink-2">Nº {nr}</span>
          <span aria-hidden="true" className="h-px w-8 bg-lume" />
          {eyebrow}
        </p>
        <h3 id={id} className="font-display text-[clamp(28px,3.4vw,48px)] font-extrabold leading-[0.98] tracking-tight [font-stretch:86%] text-ink-1 text-balance">
          {title}
        </h3>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2 text-pretty">{lead}</p>
      </div>
      {aside}
    </div>
    {children}
  </article>
);

export const ZBliska: React.FC = () => {
  const reduce = useReducedMotion();
  const liq = useLiqMap();
  const ledger = useDeskLedger();
  const [terrainRef, terrainSeen] = useSeen<HTMLDivElement>();
  const rest = ENABLED_MARKETS.filter((m) => m.scanner !== 'full');
  const map = liq.map;
  const mapShown = map && (liq.status === 'ready' || liq.status === 'delayed');
  const mapWhy =
    liq.status === 'unconfigured'
      ? tr('brak adresu danych skanera w tym buildzie', 'no scanner data address in this build')
      : liq.status === 'loading'
        ? tr('wczytuję mapę skanera…', 'loading the scanner map…')
        : liq.status === 'error'
          ? tr('mapa skanera niedostępna', 'scanner map unavailable')
          : tr('mapa skanera nieświeża, liczby ukryte', 'scanner map stale, numbers hidden');
  const sum = ledger.summary;
  const r60 = sum?.scores.ret['60'];
  const ledgerOk = sum && (ledger.status === 'ready' || ledger.status === 'stale');

  return (
    <section aria-labelledby="dzis-btc" data-dzis-btc className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="dzis-btc" className="font-display text-[clamp(22px,2.2vw,30px)] font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">
          {tr('Z bliska: BTC', 'Up close: BTC')}
        </h2>
        <p className="max-w-3xl text-xs leading-relaxed text-ink-3">
          {tr(
            `Pozycje, likwidacje i dziennik prognoz są tylko dla BTC: Hyperliquid nie udostępnia pozycji rynków HIP-3 (${deskPhrase('pl', 'nom', rest)}), a prognozy prowadzimy dla BTC.`,
            `Positions, liquidations and the forecast ledger are BTC only: Hyperliquid does not expose positions on HIP-3 markets (${deskPhrase('en', 'nom', rest)}), and we keep forecasts for BTC.`
          )}
        </p>
      </div>

      <Rozdzial
        id="dzis-paliwo"
        nr="01"
        eyebrow={tr('Przed sesją', 'Pre-session')}
        title={tr('Gdzie leży paliwo BTC?', 'Where is the BTC fuel?')}
        lead={tr(
          'Mapa likwidacji ze skanera HyperQuant jako teren: grzbiety to ceny, przy których otwarte pozycje zostałyby zamknięte. Przód to szczegół, tył to szeroki kształt.',
          'The HyperQuant scanner liquidation map as a landscape: ridges are prices where open positions would be closed. The front is detail, the back is the broad shape.'
        )}
        aside={
          <div className="flex flex-col items-start gap-2 text-[13px] text-ink-2">
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
        <div ref={terrainRef} className="-mx-5 sm:-mx-8">
          {terrainSeen && mapShown && map ? (
            <LocalBoundary what={tr('Krajobraz płynności', 'Liquidity landscape')}>
              <Suspense fallback={<div className="h-[480px]" />}>
                <LiquidityTerrain map={map} price={map.markPx} />
              </Suspense>
            </LocalBoundary>
          ) : (
            <div className="grid h-[480px] place-items-center text-[13px] text-ink-3">{mapShown ? '' : mapWhy}</div>
          )}
        </div>
        <p className="text-xs text-ink-3">{tr('Cena przy mapie: cena znakowa z migawki skanera (nie z tej sekundy).', 'Price at the map: the mark price of the scanner snapshot (not this second).')}</p>
      </Rozdzial>

      <Rozdzial
        id="dzis-przeplyw"
        nr="02"
        eyebrow={tr('W sesji', 'In session')}
        title={tr('Przepływ, który widać gołym okiem.', 'Order flow you can see.')}
        lead={tr(
          'Kto uderza w rynek, kto stoi w księdze i co z niej znika. Taśma, footprint i heatmapa składają się w jeden obraz zamiast trzech okien.',
          'Who hits the market, who rests in the book and what disappears from it. Tape, footprint and heatmap form one picture instead of three windows.'
        )}
        aside={
          <a href="#charts" className="hq-przycisk-lume inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold">
            {tr('Otwórz Kokpit', 'Open the Cockpit')}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        }
      >
        <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
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
      </Rozdzial>

      <Rozdzial
        id="dzis-model"
        nr="03"
        eyebrow={tr('Po sesji', 'Post-session')}
        title={tr('Ile był wart model?', 'What was the model worth?')}
        lead={tr(
          'Co 15 minut prognozy trafiają do dziennika przed faktem: łańcuch SHA-256, kotwica w Bitcoinie, rozliczenie ze świec 1m. Każdy może przeliczyć wyniki sam.',
          'Every 15 minutes forecasts go into the ledger before the fact: a SHA-256 chain, a Bitcoin anchor, settlement from 1m candles. Anyone can recompute the scores.'
        )}
        aside={
          <a href="#after" className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong px-6 text-[15px] font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-2">
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
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{k}</dt>
                  <dd className="font-mono tabular-nums text-[32px] leading-none tracking-[-0.02em] text-ink-1">{v}</dd>
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
                        <motion.span
                          key={i}
                          className="flex-1 rounded-t-sm bg-ink-1"
                          initial={reduce ? false : { height: 0 }}
                          whileInView={{ height: `${(v / max) * 100}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: DUR.ui, ease: EASE_OUT, delay: reduce ? 0 : i * 0.03 }}
                          style={{ height: `${(v / max) * 100}%` }}
                        />
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
      </Rozdzial>

      {/* Pochodzenie liczby jako język wizualny */}
      <article aria-labelledby="dzis-pochodzenie" className="grid gap-x-10 gap-y-7 rounded-[22px] bg-ink-1 p-6 text-page sm:p-10 lg:grid-cols-5">
        <h3 id="dzis-pochodzenie" className="font-display text-[30px] font-bold leading-[1.02] [font-stretch:88%]">
          {tr('Pochodzenie liczby jest częścią liczby.', "A number's origin is part of the number.")}
        </h3>
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
      </article>
    </section>
  );
};
