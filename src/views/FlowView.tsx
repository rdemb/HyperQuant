import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PickCard } from '../charts/pro/chart/FlowPanels';
import { LOT_FLOOR, type LiquidityPick } from '../charts/pro/chart/liquidity';
import { lotThreshold } from '../charts/pro/core/book';
import { autoThreshold, classify } from '../charts/pro/core/clashes';
import type { TradeScan } from '../charts/pro/core/ladder';
import type { AggressorOrder } from '../charts/pro/core/orders';
import { tapePace } from '../charts/pro/core/tapeMemory';
import { fmtHms } from '../charts/pro/core/time';
import { wallFates, wallThreshold } from '../charts/pro/core/wallFates';
import { storeFor } from '../charts/pro/store/proStore';
import { startRecording } from '../charts/pro/store/recording';
import { requestHistory } from '../charts/pro/store/serverHistory';
import { useStoreVersion } from '../charts/pro/store/useStoreVersion';
import { usePublished } from '../state/usePublished';
import { Segmented } from '../ui';
import { isWhaleLayer } from '../utils/whaleLayer';
import { tr } from '../i18n';
import { FlowTape } from './flow/FlowTape';
import { HEAT_MS, Ladder } from './flow/Ladder';
import { WallFatesPanel } from './flow/WallFatesPanel';

/**
 * Ekran DOM i taśmy: drabina „kto stoi w kolejce”, losy ścian i taśma z pamięcią dla BTC-PERP Hyperliquid, bez wykresu
 * świec. Ten sam magazyn rynku co w Wykresach (jedno połączenie na stronę), a ostatnia godzina arkusza i taśmy
 * przychodzi z zapisu serwera, więc liczniki i mapa nie startują od zera po otwarciu strony.
 */

type StepId = 'exact' | 'near' | 'far';
type PhoneTab = 'dom' | 'tape' | 'walls';
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

const FlowView: React.FC = () => {
  const store = storeFor('BTC');
  useEffect(() => {
    startRecording(store);
    // Ostatnia godzina z zapisu serwera: mapa ciepła, taśma 15 min i losy ścian od pierwszej chwili
    requestHistory(store, store.serverNow() - WALL_WINDOW_MS);
  }, [store]);
  useStoreVersion(store, 250);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [tab, setTab] = useState<PhoneTab>('dom');
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

  const since = store.coverage.first();
  const frame = narrow ? 'h-full' : 'h-full rounded-xl border border-line overflow-hidden';
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
      narrow={narrow}
      className={frame}
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
    />
  );
  const fates = <WallFatesPanel fates={walls.fates} minUsd={walls.minUsd} step={chosen?.step ?? Number.NaN} since={walls.since} narrow={narrow} className={frame} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold text-ink-1">{tr('DOM i taśma', 'DOM & tape')}</h1>
          <p className="hidden sm:block text-[12px] text-ink-3">
            {tr(
              'BTC-PERP Hyperliquid na żywo: kto stoi w arkuszu, co się dzieje ze ścianami i kto uderza w taśmę. Opis tego, gdzie stoi i płynie pieniądz, nie sygnał.',
              'BTC-PERP Hyperliquid live: who rests in the book, what happens to walls and who hits the tape. A description of where money rests and flows, not a signal.'
            )}
          </p>
        </div>
        <p className="font-mono text-[11px] text-ink-3">
          {since !== null && Number.isFinite(since) ? tr(`taśma od ${fmtHms(since)}`, `tape since ${fmtHms(since)}`) : tr('czekam na taśmę…', 'waiting for the tape…')}
          {' · '}
          {tr(`mapa ${HEAT_MS / 60_000} min`, `map ${HEAT_MS / 60_000} min`)}
        </p>
      </div>

      {narrow && (
        <Segmented<PhoneTab>
          ariaLabel={tr('Panel', 'Panel')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'dom', label: tr('Arkusz', 'Book') },
            { value: 'tape', label: tr('Taśma', 'Tape') },
            { value: 'walls', label: tr('Ściany', 'Walls') },
          ]}
        />
      )}

      <div
        className={`relative ${
          narrow
            ? 'h-[calc(100dvh-17.5rem)] min-h-[440px] rounded-xl border border-line overflow-hidden'
            : 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 h-[calc(100dvh-12.5rem)] min-h-[560px]'
        }`}
      >
        {narrow ? (
          tab === 'dom' ? ladder : tab === 'tape' ? tape : fates
        ) : (
          <>
            {ladder}
            <div className="grid grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3 min-h-0">
              {tape}
              {fates}
            </div>
          </>
        )}
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
