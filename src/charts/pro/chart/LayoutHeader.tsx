import React, { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Badge, DASH } from '../../../ui';
import type { LiqMapState } from '../../../state/useLiqMap';
import type { VolModel } from '../../../utils/volatility';
import type { WhaleLayer } from '../../../utils/whaleLayer';
import { type TradeSession, currentTradeSession, expectedRange } from '../../../utils/sessionDay';
import type { Candle } from '../hl/parse';
import { type Branching, MIN_EVENTS } from '../core/hawkes';
import { fitBranchingLater } from '../core/hawkesWorker';
import { liqLevels } from '../core/indicators';
import { fmtHm } from '../core/time';
import { marketCostBp } from '../indicators/registry';
import type { ProStore } from '../store/proStore';
import {
  type Absent,
  COST_USD,
  FLOW_WINDOW_MS,
  type Got,
  type LayoutInputs,
  type LayoutNumber,
  dayVwapOf,
  isAbsent,
  layoutNumbers,
  liqNearestOf,
  nakedPocOf,
  prevDayOf,
  profileStep,
  reviewOf,
  rvolOf,
  sessionNowOf,
  toVBars,
  twapShareOf,
  whaleBalanceOf,
} from './layoutNumbers';
import type { StationId } from './stations';
import { tr } from '../../../i18n';

/**
 * Nagłówek układu nad wykresem (pierwszy panel karty): pytanie układu i trzy liczby z plakietkami (layoutNumbers.ts).
 * Liczby z danych, które wykres już ma — świece magazynu rynku (1m, 5m, 1h; seria wczytuje się przy pierwszym użyciu),
 * taśma i arkusz magazynu, migawki skanera i model zmienności HAR z Desku. Przeliczane co 5 s (na starcie częściej),
 * dotknięcie liczby rozwija ich źródła. Na telefonie jedna linia z przewijaniem w bok: najpierw liczby, potem pytanie.
 */

const EVERY_MS = 5_000;
/** Przez pierwsze sekundy (dane dopiero dochodzą) — co sekundę. */
const WAIT_MS = 1_000;
const WARMUP_MS = 15_000;
/** Migawka arkusza starsza niż tyle ms jest nieaktualna (zerwane połączenie), jak w Stanie rynku. */
const BOOK_STALE_MS = 30_000;
const MIN = 60_000;

interface Scan {
  model: VolModel | null;
  liq: LiqMapState;
  whales: WhaleLayer | null;
}

/** Świece interwału `id` z magazynu (seria wczytuje się przy pierwszym użyciu); w trakcie wczytywania — undefined. */
function candles(store: ProStore, id: string): Got<readonly Candle[]> | undefined {
  const s = store.series(id);
  if (s.loadState === 'idle') void s.load();
  if (s.loadState === 'error') return { why: tr(`Nie udało się pobrać świec ${id} z Hyperliquid`, `Could not load ${id} candles from Hyperliquid`) };
  return s.loadState === 'ready' ? s.candlesNow() : undefined;
}

/** Brak albo wczytywanie wejścia, od którego zależy liczba (gotowe wejście — tu nie trafia). */
const pass = (v: Got<unknown> | undefined): Absent | undefined => (v !== undefined && isAbsent(v) ? v : undefined);

/** Oczekiwany zakres sesji: z modelem HAR (BTC) od razu, bez niego ze świec 5m tego rynku (Parkinson). */
function expectedOf(store: ProStore, model: VolModel | null, s: TradeSession, now: number, price: number): LayoutInputs['expected'] {
  let bars5m: Candle[] = [];
  if (!model) {
    const c5 = candles(store, '5m');
    if (c5 === undefined || isAbsent(c5)) return c5;
    bars5m = [...c5];
  }
  const e = expectedRange(model, toVBars(bars5m), s, now, price);
  if (e) return e;
  return {
    why: model
      ? tr('Model HAR nie daje zmienności dla tej sesji', 'The HAR model gives no volatility for this session')
      : tr('Bez modelu HAR, a za mało zamkniętych świec 5m z ostatniej doby (min. 12)', 'No HAR model and too few closed 5m candles from the last day (min. 12)'),
  };
}

function liqOf(liq: LiqMapState, price: number): LayoutInputs['liq'] {
  switch (liq.status) {
    case 'ready':
    case 'delayed':
      return liqNearestOf(liqLevels(liq.map!), price, liq.map!.asOf);
    case 'loading':
      return undefined;
    case 'unconfigured':
      return { why: tr('Mapa likwidacji niedostępna w tej wersji strony', 'Liquidation map unavailable in this version of the site') };
    case 'error':
      return { why: tr('Nie udało się pobrać mapy likwidacji', 'Could not load the liquidation map') };
    default:
      return { why: tr('Skaner nie publikuje teraz aktualnej mapy — klastry ukryte', 'The scanner is not publishing a current map right now — clusters hidden') };
  }
}

/** Wejścia liczb układu `id` z magazynu rynku i migawek skanera (tylko to, czego układ potrzebuje). */
function readInputs(id: StationId, store: ProStore, scan: Scan, hawkes: LayoutInputs['hawkes']): LayoutInputs {
  const now = store.serverNow();
  const lp = store.lastPrice();
  const x: LayoutInputs = { coin: store.coin, now, price: lp > 0 ? lp : undefined };
  const model = store.coin === 'BTC' ? scan.model : null;
  if (id === 'cockpit' || id === 'auction-open') {
    const c1 = candles(store, '1m');
    if (c1 !== undefined && !isAbsent(c1)) {
      x.dayVwap = dayVwapOf(c1, now);
      x.session = sessionNowOf(c1, now);
    } else {
      x.dayVwap = pass(c1);
      // Sesja azjatycka: powód nie zależy od świec
      x.session = currentTradeSession(now) ? pass(c1) : sessionNowOf([], now);
    }
    const sn = x.session;
    x.expected = sn === undefined || isAbsent(sn) ? pass(sn) : expectedOf(store, model, sn.s, now, lp > 0 ? lp : sn.close);
  }
  if (id === 'cockpit' || id === 'fuel') {
    const c1h = candles(store, '1h');
    x.rvol = c1h === undefined || isAbsent(c1h) ? pass(c1h) : rvolOf(c1h, now);
  }
  if (id === 'day-map') {
    const c1h = candles(store, '1h');
    if (c1h === undefined || isAbsent(c1h) || !(lp > 0)) {
      x.prevDay = x.nakedPoc = pass(c1h);
    } else {
      const step = profileStep(lp);
      x.prevDay = prevDayOf(c1h, now, step);
      x.nakedPoc = nakedPocOf(c1h, now, lp, step);
    }
  }
  if (id === 'fuel') {
    if (lp > 0) x.liq = liqOf(scan.liq, lp);
    const f = store.exactBook()?.latest() ?? null;
    if (!f) x.cost = undefined;
    else if (now - f.t > BOOK_STALE_MS) x.cost = { why: tr(`Migawka arkusza z ${fmtHm(f.t)} nieaktualna (połączenie?)`, `Book snapshot from ${fmtHm(f.t)} is stale (connection?)`) };
    else {
      const ask = marketCostBp(f, COST_USD, true);
      const bid = marketCostBp(f, COST_USD, false);
      x.cost = Number.isFinite(ask) || Number.isFinite(bid) ? { ask, bid, at: f.t } : { why: tr('20 poziomów arkusza nie mieści 100 000 USD po żadnej stronie', '20 book levels cannot hold 100,000 USD on either side') };
    }
  }
  if (id === 'big-hands') {
    const from = now - FLOW_WINDOW_MS;
    x.twap = store.zeroKnown.covers(from, now)
      ? twapShareOf(store.orders.range(from, now))
      : { why: tr('Taśma bez znaczników TWAP (hash zerowy) w całych ostatnich 15 min', 'The tape lacks TWAP marks (zero hash) over the whole last 15 min') };
    x.hawkes = hawkes;
    const w = scan.whales;
    const m = w?.markets[store.coin];
    // Adres danych skanera jest wspólny: bez niego (mapa likwidacji „unconfigured”) nie ma też wielorybów
    x.whales = !w
      ? scan.liq.status === 'unconfigured'
        ? { why: tr('Warstwa wielorybów niedostępna w tej wersji strony', 'Whale layer unavailable in this version of the site') }
        : { why: tr('Skaner nie publikuje teraz warstwy wielorybów', 'The scanner is not publishing the whale layer right now') }
      : !m
        ? { why: tr(`Skaner nie publikuje wielorybów dla ${store.coin}`, `The scanner publishes no whales for ${store.coin}`) }
        : whaleBalanceOf(m.positions, w.asOf);
  }
  if (id === 'review') {
    const c5 = candles(store, '5m');
    if (c5 === undefined || isAbsent(c5)) x.review = x.reviewExpected = pass(c5);
    else {
      const r = reviewOf(c5, now);
      x.review = r;
      // Zamknięta sesja: oczekiwanie sprzed jej otwarcia (Parkinson ze świec 5m doby przed otwarciem), nie z dzisiejszych świec
      x.reviewExpected = isAbsent(r)
        ? r
        : (expectedRange(model, toVBars([...c5]), r.s, r.inProgress ? now : r.s.start, r.close) ?? {
            why: tr('Bez modelu HAR, a za mało zamkniętych świec 5m z doby przed sesją (min. 12)', 'No HAR model and too few closed 5m candles from the day before the session (min. 12)'),
          });
    }
  }
  return x;
}

const badgeTone = (n: LayoutNumber) => (n.note ? (n.value === DASH ? 'neutral' : 'stale') : n.badge === 'LIVE' ? 'live' : 'model');

export const LayoutHeader: React.FC<{
  id: StationId;
  question: string;
  store: ProStore;
  model: VolModel | null;
  liq: LiqMapState;
  whales: WhaleLayer | null;
  narrow: boolean;
}> = ({ id, question, store, model, liq, whales, narrow }) => {
  const [nums, setNums] = useState<LayoutNumber[]>(() => layoutNumbers(id, { coin: store.coin, now: Date.now() }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scan = useRef<Scan>({ model, liq, whales });
  scan.current = { model, liq, whales };
  const runRef = useRef<() => void>(() => {});
  // Hawkes liczony w tle (Web Worker) raz na minutę okna; do nowego wyniku zostaje poprzedni tego rynku
  const hk = useRef<{ coin: string; key: string; r: Got<Branching> } | null>(null);
  const busy = useRef(false);

  const hawkesInput = (): LayoutInputs['hawkes'] => {
    const now = store.serverNow();
    const end = Math.floor(now / MIN) * MIN;
    const from = end - FLOW_WINDOW_MS;
    if (!store.addressed.covers(from, end)) {
      return { why: tr('Taśma bez kont biorców w całym oknie 15 min (strumień na żywo i zapis serwera)', 'The tape lacks taker accounts over the whole 15 min window (live stream and server recording)') };
    }
    const count = store.orders.count(from, end);
    if (count < MIN_EVENTS) return { why: tr(`Za mało zleceń w oknie 15 min (${count}, min. ${MIN_EVENTS})`, `Too few orders in the 15 min window (${count}, min. ${MIN_EVENTS})`) };
    const key = `${store.coin}|${end}|${count}`;
    if (hk.current?.key === key) return hk.current.r;
    if (!busy.current) {
      busy.current = true;
      // Zdarzenie = chwila z transakcjami (zlecenia z tej samej chwili raz), sekundy od początku okna — jak we wskaźniku
      const ts: number[] = [];
      for (const o of store.orders.range(from, end)) {
        const t = (o.time - from) / 1000;
        if (ts.length === 0 || t > ts[ts.length - 1]) ts.push(t);
      }
      const coin = store.coin;
      void fitBranchingLater(Float64Array.from(ts), FLOW_WINDOW_MS / 1000).then((r) => {
        busy.current = false;
        hk.current = { coin, key, r: r ?? { why: tr('Dopasowanie modelu bez wyniku w tym oknie', 'The model fit gave no result in this window') } };
        runRef.current();
      });
    }
    return hk.current?.coin === store.coin ? hk.current.r : undefined;
  };

  useEffect(() => {
    let timer = 0;
    const started = Date.now();
    const run = () => {
      window.clearTimeout(timer);
      const n = layoutNumbers(id, readInputs(id, store, scan.current, id === 'big-hands' ? hawkesInput() : undefined));
      setNums(n);
      const waiting = n.some((v) => v.value === DASH) && Date.now() - started < WARMUP_MS;
      timer = window.setTimeout(run, waiting ? WAIT_MS : EVERY_MS);
    };
    runRef.current = run;
    run();
    return () => {
      window.clearTimeout(timer);
      runRef.current = () => {};
    };
    // hawkesInput czyta tylko refy i magazyn z tego renderu
  }, [id, store]);

  // Nowa migawka skanera albo model zmienności — od razu
  useEffect(() => {
    runRef.current();
  }, [model, liq.status, liq.map, whales]);

  // Rozwinięcie zamyka dotknięcie obok i Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0 border-b border-line">
      <div className={`flex items-center min-w-0 overflow-x-auto [scrollbar-width:none] whitespace-nowrap ${narrow ? 'h-11 gap-x-2 px-1.5' : 'h-8 gap-x-3 px-2 sm:px-3'}`}>
        {/* Pytanie układu: na komputerze pierwsze (przycięte, całe w podpowiedzi), na telefonie po liczbach, z przewijaniem */}
        <p title={question} className={`flex items-center gap-1.5 text-[11.5px] text-ink-2 ${narrow ? 'order-last shrink-0' : 'flex-1 min-w-0'}`}>
          <CircleHelp className="w-3.5 h-3.5 shrink-0 text-ink-3" aria-label={tr('Pytanie układu', 'Layout question')} />
          <span className={narrow ? '' : 'truncate'}>{question}</span>
        </p>
        <div role="group" aria-label={tr('Liczby układu', 'Layout numbers')} className={`flex items-center shrink-0 ${narrow ? 'gap-x-2' : 'gap-x-3'}`}>
          {nums.map((n) => (
            <button
              key={n.label}
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              title={n.hint}
              className={`shrink-0 rounded-md px-1 -mx-1 hover:bg-surface-2 transition-colors duration-150 ${narrow ? 'h-11 flex flex-col items-start justify-center gap-1' : 'flex items-center gap-1.5'}`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] leading-none text-ink-3">{narrow ? (n.short ?? n.label) : n.label}</span>
              <span className="flex items-center gap-1 leading-none">
                {/* Liczby krojem o stałej szerokości, opisy (typ dnia, migracja) zwykłym — węższe na telefonie */}
                <span className={`${/\d/.test(n.value) ? 'font-mono tabular-nums text-[12px]' : 'text-[11px]'} ${n.value === DASH ? 'text-ink-3' : 'text-ink-1'}`}>{n.value}</span>
                <Badge tone={badgeTone(n)} size={narrow ? 'sm' : undefined}>
                  {n.note ?? n.badge}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="absolute left-2 right-2 sm:right-auto sm:w-[36rem] top-full mt-1 z-40 max-h-[calc(100dvh-22rem)] sm:max-h-[60vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-3 shadow-2xl text-xs">
          <p className="text-ink-1 leading-snug">{question}</p>
          <dl className="mt-2.5 flex flex-col gap-2">
            {nums.map((n) => (
              <div key={n.label}>
                <dt className="flex items-center gap-1.5 font-medium text-ink-1">
                  {n.label}: <span className="font-mono tabular-nums font-normal">{n.value}</span>
                  <Badge tone={badgeTone(n)}>{n.note ?? n.badge}</Badge>
                </dt>
                <dd className="mt-0.5 leading-snug text-ink-3">{n.hint}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 text-[10.5px] leading-snug text-ink-3">
            {tr(
              `Liczby z danych tego wykresu (${store.coin}), odświeżane co 5 s. LIVE — dane Hyperliquid albo skanera, MODEL — wynik modelu z nazwą metody, wiek — migawka skanera starsza niż 2 min. To opis, nie sygnał ani rekomendacja.`,
              `Numbers from this chart's data (${store.coin}), refreshed every 5 s. LIVE is Hyperliquid or scanner data, MODEL a model output with the method name, an age a scanner snapshot older than 2 min. A description, not a signal or a recommendation.`
            )}
          </p>
        </div>
      )}
    </div>
  );
};
