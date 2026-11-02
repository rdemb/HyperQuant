import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Expand, Maximize2, Minimize2, Shrink } from 'lucide-react';
import { PickCard, compact } from '../charts/pro/chart/FlowPanels';
import { LOT_FLOOR, type LiquidityPick } from '../charts/pro/chart/liquidity';
import { lotThreshold } from '../charts/pro/core/book';
import { autoThreshold, classify } from '../charts/pro/core/clashes';
import { type TradeScan, bidShare } from '../charts/pro/core/ladder';
import type { AggressorOrder } from '../charts/pro/core/orders';
import { tapePace } from '../charts/pro/core/tapeMemory';
import { fmtHms } from '../charts/pro/core/time';
import { wallFates, wallThreshold } from '../charts/pro/core/wallFates';
import { storeFor } from '../charts/pro/store/proStore';
import { startRecording } from '../charts/pro/store/recording';
import { requestHistory } from '../charts/pro/store/serverHistory';
import { useStoreVersion } from '../charts/pro/store/useStoreVersion';
import { isTyping } from '../charts/pro/draw/tools';
import { usePublished } from '../state/usePublished';
import { Segmented, numLang } from '../ui';
import { isWhaleLayer } from '../utils/whaleLayer';
import { tr } from '../i18n';
import { FlowTape } from './flow/FlowTape';
import { HEAD_FLOW_MS, HEAT_MS, HEAT_WIDE_MS, Ladder } from './flow/Ladder';
import { type PanelId, type PulseTile, Pulse } from './flow/Pulse';
import { TwapPanel, useTwaps } from './flow/TwapPanel';
import { WallFatesPanel } from './flow/WallFatesPanel';
import { WhoPanel, useWho } from './flow/WhoPanel';

/**
 * Ekran DOM i taśmy: drabina „kto stoi w kolejce”, losy ścian i taśma z pamięcią dla BTC-PERP Hyperliquid, bez wykresu
 * świec. Ten sam magazyn rynku co w Wykresach (jedno połączenie na stronę), a ostatnia godzina arkusza i taśmy
 * przychodzi z zapisu serwera, więc liczniki i mapa nie startują od zera po otwarciu strony.
 */

type StepId = 'exact' | 'near' | 'far';
type LowerTab = 'walls' | 'twap' | 'who';
interface Prefs {
  minUsd: number;
  sound: boolean;
  step: StepId;
}

const PREFS_KEY = 'hq.flow.v1';
const DEFAULT_PREFS: Prefs = { minUsd: 10_000, sound: false, step: 'near' };
/** Okno losów ścian i progu ściany: ostatnia godzina (z historią serwera). */
const WALL_WINDOW_MS = 3_600_000;
/** Próg dużego zlecenia agresora (jak w Wykresach) i próg dużego zlecenia w arkuszu (okno 30 min). */
const AUTO_WINDOW_MS = 3_600_000;
const LOT_WINDOW_MS = 30 * 60_000;
const WALL_FLOOR_USD = 100_000;
const WHALES_STALE_MS = 20 * 60_000;
/** Dokładny arkusz starszy niż tyle ms nie daje środka i spreadu (drabina wraca do swojej agregacji). */
const TOP_STALE_MS = 30_000;
const NARROW = '(max-width: 1023.98px)';
/** Od tej szerokości trzy kolumny bez zakładek (drabina zostaje pełna, z kolumną średniego zlecenia). */
const WIDE = '(min-width: 1600px)';

function loadPrefs(): Prefs {
  try {
    const r = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      minUsd: typeof r?.minUsd === 'number' && r.minUsd >= 0 ? r.minUsd : DEFAULT_PREFS.minUsd,
      sound: typeof r?.sound === 'boolean' ? r.sound : DEFAULT_PREFS.sound,
      step: r?.step === 'exact' || r?.step === 'near' || r?.step === 'far' ? r.step : DEFAULT_PREFS.step,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Zapis niedostępny (tryb prywatny) — ustawienia zostają do zamknięcia strony
  }
}

const subscribeNarrow = (fn: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};
const isNarrow = () => window.matchMedia(NARROW).matches;
const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};
const isWide = () => window.matchMedia(WIDE).matches;

const FlowView: React.FC = () => {
  const store = storeFor('BTC');
  useEffect(() => {
    startRecording(store);
    // Ostatnia godzina z zapisu serwera: mapa ciepła, taśma 15 min i losy ścian od pierwszej chwili
    requestHistory(store, store.serverNow() - WALL_WINDOW_MS);
  }, [store]);
  // Czoło kolejki: kanał bbo tylko, gdy ten widok jest otwarty
  useEffect(() => store.watchBbo(), [store]);
  useStoreVersion(store, 250);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const [tab, setTab] = useState<PanelId>('dom');
  const [lower, setLower] = useState<LowerTab>('walls');
  // Powiększony panel (komputer) i pełny ekran całego widoku (klawisz F, Esc wraca z powiększenia)
  const [max, setMax] = useState<PanelId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);
  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key.toLowerCase() === 'f') toggleFs();
      else if (e.key === 'Escape' && max !== null) setMax(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrow, toggleFs, max]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const patch = useCallback((p: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      return next;
    });
  }, []);

  const now = store.serverNow();
  const scan: TradeScan = useCallback((a, b, fn) => store.tape.forEach(a, b, fn), [store]);

  // Próg dużego zlecenia z rynku (odświeżany co kilka sekund, nie przy każdej transakcji)
  const autoKey = Math.floor(now / 5_000);
  const bigUsd = useMemo(() => autoThreshold(store.orders.range(now - AUTO_WINDOW_MS, now + 1)), [store, autoKey]);

  // Agregacje arkusza: dokładna (osobny kanał), bliska i daleka — bez powtórzeń, gdy bliska równa się tickowi
  const books = { exact: store.exactBook(), near: store.book('near'), far: store.book('far') };
  const steps = (['exact', 'near', 'far'] as const)
    .map((id) => ({ id, hist: books[id], step: books[id]?.latest()?.step ?? Number.NaN }))
    .filter((s, i, all) => s.hist && Number.isFinite(s.step) && all.findIndex((x) => x.hist === s.hist) === i);
  const chosen = steps.find((s) => s.id === prefs.step) ?? steps.find((s) => s.id === 'near') ?? steps[0] ?? null;
  const hist = chosen?.hist ?? null;
  const histVersion = hist?.version ?? 0;

  // Losy ścian z ostatniej godziny wybranej agregacji (przeliczane przy nowej migawce)
  const walls = useMemo(() => {
    if (!hist) return { fates: [], open: [], minUsd: WALL_FLOOR_USD, lotUsd: bigUsd * LOT_FLOOR, since: null as number | null };
    const t = store.serverNow();
    const frames = hist.range(t - WALL_WINDOW_MS, t + 1);
    const minUsd = wallThreshold(frames, WALL_FLOOR_USD);
    const { fates, open } = wallFates(frames, scan, minUsd);
    const lotUsd = lotThreshold(hist.range(t - LOT_WINDOW_MS, t + 1), bigUsd * LOT_FLOOR);
    return { fates, open, minUsd, lotUsd, since: frames.length > 0 ? frames[0].t : null };
  }, [hist, histVersion, scan, store, bigUsd]);

  const paceKey = Math.floor(now / 1_000);
  const pace = useMemo(() => tapePace(scan, store.serverNow(), (a, b) => store.coverage.covers(a, b)), [scan, store, paceKey]);

  const whalePub = usePublished('whales.json', isWhaleLayer);
  const whales = whalePub.value && Date.now() - whalePub.value.asOf < WHALES_STALE_MS ? (whalePub.value.markets[store.coin]?.orders ?? null) : null;

  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  const pickOrder = useCallback((o: AggressorOrder) => setPick({ kind: 'order', order: o, cls: classify(o, bigUsd) }), [bigUsd]);
  const closePick = useCallback(() => {
    setPick(null);
    setHighlight('');
  }, []);

  // Najlepszy bid i ask z dokładnego arkusza (świeży), żeby środek i spread nie zależały od kroku drabiny
  const ex = books.exact?.latest() ?? null;
  const top = ex && ex.nBids > 0 && ex.nBids < ex.px.length && now - ex.t <= TOP_STALE_MS ? { bid: ex.px[0], ask: ex.px[ex.nBids] } : null;

  // Czoło kolejki z kanału bbo (bilans z ostatnich minut)
  const hq = store.head;
  const ladderHead = hq.bid || hq.ask ? { bid: hq.bid, ask: hq.ask, flow: hq.flow(now - HEAD_FLOW_MS, now + 1), from: hq.from, first: hq.first } : null;
  const who = useWho(store);
  const twapData = useTwaps(store, narrow);

  const since = store.coverage.first();
  const frame = narrow ? 'h-full' : 'h-full rounded-xl border border-line overflow-hidden';
  const maxBtn = (id: PanelId) =>
    narrow ? undefined : (
      <button
        type="button"
        onClick={() => setMax((m) => (m === id ? null : id))}
        aria-pressed={max === id}
        aria-label={max === id ? tr('Wróć do układu (Esc)', 'Back to the layout (Esc)') : tr('Powiększ panel', 'Enlarge the panel')}
        title={max === id ? tr('Wróć do układu (Esc)', 'Back to the layout (Esc)') : tr('Powiększ panel', 'Enlarge the panel')}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-2 shrink-0"
      >
        {max === id ? <Shrink className="w-3.5 h-3.5" aria-hidden="true" /> : <Expand className="w-3.5 h-3.5" aria-hidden="true" />}
      </button>
    );
  const ladder = (
    <Ladder
      store={store}
      hist={hist}
      steps={steps.map((s) => ({ id: s.id, step: s.step }))}
      stepId={chosen?.id ?? prefs.step}
      onStep={(id) => patch({ step: id as StepId })}
      whales={whales}
      fates={walls.fates}
      open={walls.open}
      lotUsd={walls.lotUsd}
      top={top}
      head={ladderHead}
      wide={max === 'dom'}
      narrow={narrow}
      className={frame}
      tools={maxBtn('dom')}
    />
  );
  const tape = (
    <FlowTape
      store={store}
      minUsd={prefs.minUsd}
      sound={prefs.sound}
      bigUsd={bigUsd}
      pace={pace}
      selected={pick?.kind === 'order' ? pick.order : null}
      highlight={highlight}
      narrow={narrow}
      className={frame}
      onPick={pickOrder}
      onMinUsd={(v) => patch({ minUsd: v })}
      onSound={(v) => patch({ sound: v })}
      tools={maxBtn('tape')}
    />
  );
  // Laptop (dwie kolumny): ściany, TWAP-y i „kto przyjmuje” dzielą dolne pole po prawej (zakładki w nagłówku)
  const tabbed = !narrow && !wide && max === null;
  const lowerHead = tabbed ? (
    <Segmented<LowerTab>
      ariaLabel={tr('Dolny panel', 'Lower panel')}
      value={lower}
      onChange={setLower}
      options={[
        { value: 'walls', label: tr('Ściany', 'Walls'), title: tr('Ściany: zjedzone czy zdjęte', 'Walls: eaten or pulled') },
        { value: 'twap', label: tr('TWAP-y', 'TWAPs'), title: tr('TWAP-y w drodze', 'TWAPs en route') },
        { value: 'who', label: tr('Kto przyjmuje', 'Who absorbs'), title: tr('Kto przyjmuje uderzenia', 'Who absorbs the hits') },
      ]}
    />
  ) : undefined;
  const fates = (
    <WallFatesPanel fates={walls.fates} minUsd={walls.minUsd} step={chosen?.step ?? Number.NaN} since={walls.since} narrow={narrow} className={frame} head={lowerHead} tools={maxBtn('walls')} />
  );
  const twaps = (
    <TwapPanel
      store={store}
      data={twapData}
      head={lowerHead ?? <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium">{tr('TWAP-y w drodze', 'TWAPs en route')}</span>}
      tools={maxBtn('twap')}
      narrow={narrow}
      className={frame}
    />
  );
  const whoPanel = <WhoPanel data={who} highlight={highlight} onHighlight={setHighlight} head={lowerHead} tools={maxBtn('who')} wide={max === 'who'} narrow={narrow} className={frame} />;
  const panels: Record<PanelId, React.ReactNode> = { dom: ladder, tape, who: whoPanel, walls: fates, twap: twaps };

  // Pasek „co się dzieje teraz”: po jednej liczbie na panel
  const f0 = hist?.latest() ?? null;
  const bs = f0 && f0.nBids > 0 && f0.nBids < f0.px.length ? bidShare(f0) : Number.NaN;
  const ratio = pace.median > 0 ? pace.usd1m / pace.median : Number.NaN;
  const untouched = walls.fates.filter((x) => x.verdict !== 'eaten' && !x.touched).length;
  const pctS = (x: number) => (Number.isFinite(x) ? `${numLang(String(Math.round(x * 100)))}%` : '—');
  // Para bid / ask; na telefonie bez znaku % i spacji, żeby zmieściła się w kaflu
  const pair = (b: number, a: number) => {
    const v = (x: number) => (narrow ? (Number.isFinite(x) ? String(Math.round(x * 100)) : '—') : pctS(x));
    return (
      <>
        <span className="text-of-buy-ink">{v(b)}</span>
        <span className="text-ink-3">{narrow ? '/' : ' / '}</span>
        <span className="text-of-sell-ink">{v(a)}</span>
      </>
    );
  };
  const tiles: PulseTile[] = [
    {
      id: 'dom',
      label: tr('Arkusz', 'Book'),
      value: pair(bs, 1 - bs),
      sub: hq.bid && hq.ask ? tr(`czoło ${compact(hq.bid.sz * hq.bid.px)} / ${compact(hq.ask.sz * hq.ask.px)} USD`, `head ${compact(hq.bid.sz * hq.bid.px)} / ${compact(hq.ask.sz * hq.ask.px)} USD`) : tr('głębokość bid / ask', 'bid / ask depth'),
      title: tr('Arkusz: kto stoi w kolejce. Liczba: udział bidów i asków w widocznej głębokości; dopisek: wartość czoła kolejki (najlepszy bid / ask).', 'Book: who is in the queue. Number: share of bids and asks in the visible depth; below: value at the head of the queue (best bid / ask).'),
    },
    {
      id: 'tape',
      label: tr('Taśma', 'Tape'),
      value: <span className={ratio >= 2 ? 'text-warn font-semibold' : undefined}>{Number.isFinite(ratio) ? `${numLang(ratio.toFixed(1))}×` : '—'}</span>,
      sub: tr(`${compact(pace.usd1m)}/min · kupno ${pctS(pace.buyShare)}`, `${compact(pace.usd1m)}/min · buy ${pctS(pace.buyShare)}`),
      title: tr('Taśma: wartość transakcji z ostatniej minuty wobec mediany minut z godziny i udział kupujących.', 'Tape: trade value in the last minute against the median minute of the hour, and the buyers’ share.'),
    },
    {
      id: 'who',
      label: narrow ? tr('Kto', 'Who') : tr('Kto przyjmuje', 'Who absorbs'),
      value: pair(who.bid.share, who.ask.share),
      sub: tr('3 największych makerów', 'top 3 makers'),
      title: tr('Kto przyjmuje uderzenia: udział 3 największych kont makerów po stronie bidów i asków z 15 min.', 'Who absorbs the hits: share of the 3 largest maker accounts on the bid and ask side in 15 min.'),
    },
    {
      id: 'walls',
      label: tr('Ściany', 'Walls'),
      value: walls.fates.length > 0 ? pctS(untouched / walls.fates.length) : '—',
      sub: tr(`bez transakcji · ${walls.fates.length} w 1 h`, `no trade · ${walls.fates.length} in 1 h`),
      title: tr('Ściany: zjedzone czy zdjęte. Liczba: odsetek ścian z ostatniej godziny, które zniknęły bez żadnej transakcji.', 'Walls: eaten or pulled. Number: share of walls from the last hour that vanished without any trade.'),
    },
    {
      id: 'twap',
      label: narrow ? 'TWAP' : tr('TWAP-y w drodze', 'TWAPs en route'),
      value: <span className={twapData.net >= 0 ? 'text-of-buy-ink' : 'text-of-sell-ink'}>{`${twapData.net > 0 ? '+' : ''}${compact(twapData.net)}`}</span>,
      sub: tr(`netto 15 min · plany ${twapData.known}`, `net 15 min · plans ${twapData.known}`),
      title: tr('TWAP-y w drodze: ile według znanych planów kupią minus sprzedadzą w najbliższych 15 min (USD).', 'TWAPs en route: how much the known plans will buy minus sell in the next 15 min (USD).'),
    },
  ];
  const subtitle = tr(
    'BTC-PERP Hyperliquid na żywo: kto stoi w arkuszu i na czele kolejki, kto uderza, kto przyjmuje, co się dzieje ze ścianami i jakie TWAP-y są w drodze. Opis tego, gdzie stoi i płynie pieniądz, nie sygnał.',
    'BTC-PERP Hyperliquid live: who rests in the book and at the head of the queue, who hits, who absorbs, what happens to walls and which TWAPs are en route. A description of where money rests and flows, not a signal.'
  );
  const onTile = (id: PanelId) => (narrow ? setTab(id) : setMax((m) => (m === id ? null : id)));

  // Na niskim ekranie kafle nie mają dopisku (Pulse), więc pole paneli jest o tyle wyższe
  const gridH = fs
    ? 'h-[calc(100dvh-8rem)]'
    : narrow
      ? 'h-[calc(100dvh-20.25rem)] min-h-[440px]'
      : 'h-[calc(100dvh-16.75rem)] [@media(max-height:860px)]:h-[calc(100dvh-15.75rem)] min-h-[500px]';
  const body = narrow ? (
    <div className={`relative ${gridH} rounded-xl border border-line overflow-hidden`}>{panels[tab]}</div>
  ) : max !== null ? (
    <div className={`relative ${gridH}`}>{panels[max]}</div>
  ) : wide ? (
    // Szeroki ekran: arkusz | taśma i kto przyjmuje | ściany i TWAP-y, bez zakładek
    <div className={`relative grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 ${gridH}`}>
      {ladder}
      <div className="grid grid-rows-[minmax(0,1fr)_auto] gap-3 min-h-0">
        {tape}
        {whoPanel}
      </div>
      <div className="grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 min-h-0">
        {fates}
        {twaps}
      </div>
    </div>
  ) : (
    <div className={`relative grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 ${gridH}`}>
      {ladder}
      <div className="grid grid-rows-[minmax(0,3fr)_minmax(17rem,2fr)] gap-3 min-h-0">
        {tape}
        {lower === 'walls' ? fates : lower === 'twap' ? twaps : whoPanel}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`flex flex-col gap-3 ${fs ? 'h-full p-3 bg-page overflow-hidden' : ''}`}>
      {/* Jeden wiersz: tytuł, opis (skrócony, pełny w podpowiedzi), zakres nagrania i pełny ekran */}
      <div className="flex items-center gap-x-4 min-w-0">
        <h1 className="shrink-0 font-display text-lg font-semibold text-ink-1">{tr('DOM i taśma', 'DOM & tape')}</h1>
        <p className="hidden lg:block min-w-0 flex-1 truncate text-[12px] text-ink-3" title={subtitle}>
          {subtitle}
        </p>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <p className="font-mono text-[11px] text-ink-3">
            {since !== null && Number.isFinite(since) ? tr(`taśma od ${fmtHms(since)}`, `tape since ${fmtHms(since)}`) : tr('czekam na taśmę…', 'waiting for the tape…')}
            {' · '}
            {tr(`mapa ${(max === 'dom' ? HEAT_WIDE_MS : HEAT_MS) / 60_000} min`, `map ${(max === 'dom' ? HEAT_WIDE_MS : HEAT_MS) / 60_000} min`)}
          </p>
          {!narrow && (
            <button
              type="button"
              onClick={toggleFs}
              aria-pressed={fs}
              title={fs ? tr('Zamknij pełny ekran (F)', 'Exit full screen (F)') : tr('Pełny ekran (F)', 'Full screen (F)')}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-surface-1 text-[11px] text-ink-2 hover:text-ink-1 hover:border-ink-3"
            >
              {fs ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
              {fs ? tr('Zamknij', 'Exit') : tr('Pełny ekran', 'Full screen')}
            </button>
          )}
        </div>
      </div>

      <Pulse tiles={tiles} active={narrow ? tab : max} narrow={narrow} onPick={onTile} />

      <div className="relative">
        {body}
        {pick && (
          <div className="absolute right-2 bottom-2 z-30 w-[min(340px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto rounded-xl">
            <PickCard pick={pick} store={store} bigUsd={bigUsd} highlight={highlight} onHighlight={setHighlight} onClose={closePick} />
          </div>
        )}
      </div>
    </div>
  );
};
export default FlowView;
