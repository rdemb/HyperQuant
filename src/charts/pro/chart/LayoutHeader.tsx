import React, { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Badge, DASH, sourceTag } from '../../../ui';
import { scrollFadeRef } from '../../../ui/scrollFade';
import type { BlogMap, BlogMapsState } from '../../../state/useBlogMaps';
import type { LiqMapState } from '../../../state/useLiqMap';
import type { VolModel } from '../../../utils/volatility';
import type { WhaleLayer } from '../../../utils/whaleLayer';
import { type Branching, MIN_EVENTS } from '../core/hawkes';
import { fitBranchingLater } from '../core/hawkesWorker';
import type { ProStore } from '../store/proStore';
import { type InputScan, readInputs } from './layoutInputs';
import { FLOW_WINDOW_MS, type Got, type LayoutInputs, type LayoutNumber, layoutNumbers } from './layoutNumbers';
import type { StationId } from './stations';
import { tr } from '../../../i18n';

/**
 * Nagłówek układu nad wykresem (pierwszy panel karty): pytanie układu i trzy liczby z plakietkami (layoutNumbers.ts,
 * wejścia z magazynu w layoutInputs.ts).
 * Liczby z danych, które wykres już ma — świece magazynu rynku (1m, 5m, 1h; seria wczytuje się przy pierwszym użyciu),
 * taśma i arkusz magazynu, migawki skanera, model zmienności HAR i mapy z bloga. Przeliczane co 5 s (na starcie częściej),
 * dotknięcie liczby rozwija ich źródła. Na telefonie jedna linia z przewijaniem w bok: najpierw liczby, potem pytanie.
 */

const EVERY_MS = 5_000;
/** Przez pierwsze sekundy (dane dopiero dochodzą) — co sekundę. */
const WAIT_MS = 1_000;
const WARMUP_MS = 15_000;
const MIN = 60_000;

/** Plakietka liczby: „—” bez plakietki źródła (najwyżej powód, np. „tylko BTC”), powód braku w podpowiedzi. */
const Tag: React.FC<{ n: LayoutNumber; size?: 'sm' }> = ({ n, size }) => {
  const t = sourceTag(n);
  return t ? (
    <Badge tone={t.tone} size={size}>
      {t.text}
    </Badge>
  ) : null;
};

export const LayoutHeader: React.FC<{
  id: StationId;
  question: string;
  store: ProStore;
  model: VolModel | null;
  liq: LiqMapState;
  whales: WhaleLayer | null;
  /** Build ma adres danych skanera (bez niego warstwa wielorybów jest niedostępna, nie „nieaktualna”). */
  whalesConfigured: boolean;
  /** Mapy z bloga i mapa wybrana na wykresie (liczba „Mapa: dotknięte” w Rozliczeniu). */
  blogMaps: BlogMapsState;
  blogMap: BlogMap | null;
  narrow: boolean;
  /** Po każdym przeliczeniu: trzy liczby nagłówka (domyślny tytuł Klatki). */
  onNumbers?: (nums: LayoutNumber[]) => void;
}> = ({ id, question, store, model, liq, whales, whalesConfigured, blogMaps, blogMap, narrow, onNumbers }) => {
  const [nums, setNums] = useState<LayoutNumber[]>(() => layoutNumbers(id, { coin: store.coin, now: Date.now() }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onNumbersRef = useRef(onNumbers);
  onNumbersRef.current = onNumbers;
  const scan = useRef<InputScan>({ model, liq, whales, whalesConfigured, blog: { state: blogMaps, map: blogMap } });
  scan.current = { model, liq, whales, whalesConfigured, blog: { state: blogMaps, map: blogMap } };
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
      let waiting = Date.now() - started < WARMUP_MS;
      try {
        const n = layoutNumbers(id, readInputs(id, store, scan.current, id === 'big-hands' ? hawkesInput() : undefined));
        setNums(n);
        onNumbersRef.current?.(n);
        waiting &&= n.some((v) => v.value === DASH);
      } finally {
        // Następne przeliczenie także po wyjątku (nagłówek nie może zamarznąć na starych liczbach)
        timer = window.setTimeout(run, waiting ? WAIT_MS : EVERY_MS);
      }
    };
    runRef.current = run;
    run();
    return () => {
      window.clearTimeout(timer);
      runRef.current = () => {};
    };
    // hawkesInput czyta tylko refy i magazyn z tego renderu
  }, [id, store]);

  // Nowa migawka skanera, model zmienności albo mapa z bloga — od razu
  useEffect(() => {
    runRef.current();
  }, [model, liq.status, liq.map, whales, whalesConfigured, blogMaps, blogMap]);

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
      <div ref={scrollFadeRef} className={`hq-fade-x flex items-center min-w-0 overflow-x-auto [scrollbar-width:none] whitespace-nowrap ${narrow ? 'h-11 gap-x-2 px-1.5' : 'h-8 gap-x-3 px-2 sm:px-3'}`}>
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
                <Tag n={n} size={narrow ? 'sm' : undefined} />
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
                  <Tag n={n} />
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
