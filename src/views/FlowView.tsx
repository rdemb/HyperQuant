import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Expand, Maximize2, Minimize2, Shrink } from 'lucide-react';
import { PickCard } from '../charts/pro/chart/FlowPanels';
import type { LiquidityPick } from '../charts/pro/chart/liquidity';
import { classify } from '../charts/pro/core/clashes';
import type { AggressorOrder } from '../charts/pro/core/orders';
import { fmtHms } from '../charts/pro/core/time';
import { isTyping } from '../charts/pro/draw/tools';
import { Segmented } from '../ui';
import { tr } from '../i18n';
import { pulseTiles } from './flow/FlowColumn';
import type { StepId } from './flow/flowColumnModel';
import { FlowTape } from './flow/FlowTape';
import { HEAT_MS, HEAT_WIDE_MS, Ladder } from './flow/Ladder';
import { type PanelId, Pulse } from './flow/Pulse';
import { TwapPanel, useTwaps } from './flow/TwapPanel';
import { useFlowColumn } from './flow/useFlowColumn';
import { WallFatesPanel } from './flow/WallFatesPanel';
import { WhoPanel, useWho } from './flow/WhoPanel';

/**
 * Ekran DOM i taśmy: drabina „kto stoi w kolejce”, losy ścian i taśma z pamięcią dla BTC-PERP Hyperliquid, bez wykresu
 * świec. Ten sam magazyn rynku co w Wykresach (jedno połączenie na stronę), a ostatnia godzina arkusza i taśmy
 * przychodzi z zapisu serwera, więc liczniki i mapa nie startują od zera po otwarciu strony. Obliczenia są wspólne
 * z kolumną obok wykresu (`useFlowColumn`).
 */

type LowerTab = 'walls' | 'twap' | 'who';

const NARROW = '(max-width: 1023.98px)';
/** Od tej szerokości trzy kolumny bez zakładek (drabina zostaje pełna, z kolumną średniego zlecenia). */
const WIDE = '(min-width: 1600px)';

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
  const f = useFlowColumn('BTC');
  const { store, prefs, patch, steps, chosen, hist, walls, pace, bigUsd } = f;
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

  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  const pickOrder = useCallback((o: AggressorOrder) => setPick({ kind: 'order', order: o, cls: classify(o, bigUsd) }), [bigUsd]);
  const closePick = useCallback(() => {
    setPick(null);
    setHighlight('');
  }, []);

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
      whales={f.whales}
      fates={walls.fates}
      open={walls.open}
      lotUsd={walls.lotUsd}
      top={f.top}
      head={f.head}
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
  const tiles = pulseTiles(f, { who, twap: twapData }, narrow);
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
