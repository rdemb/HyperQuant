import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOT_FLOOR } from '../../charts/pro/chart/liquidity';
import { type BookHistory, lotThreshold } from '../../charts/pro/core/book';
import { autoThreshold } from '../../charts/pro/core/clashes';
import type { TradeScan } from '../../charts/pro/core/ladder';
import { type TapePace, tapePace } from '../../charts/pro/core/tapeMemory';
import { type OpenWall, type WallFate, wallFates, wallThreshold } from '../../charts/pro/core/wallFates';
import { type Market, type ProStore, storeFor } from '../../charts/pro/store/proStore';
import { startRecording } from '../../charts/pro/store/recording';
import { requestHistory } from '../../charts/pro/store/serverHistory';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { usePublished } from '../../state/usePublished';
import { type WhaleOrder, isWhaleLayer } from '../../utils/whaleLayer';
import { DEFAULT_FLOW_PREFS, FLOW_PREFS_KEY, type FlowPrefs, type StepId, parseFlowPrefs } from './flowColumnModel';
import { HEAD_FLOW_MS, type LadderHead } from './Ladder';

/**
 * Obliczenia drabiny, taśmy i losów ścian dla jednego rynku (ekran DOM i taśma oraz kolumna obok wykresu): magazyn
 * rynku z nagraniem i ostatnią godziną z serwera, kanał bbo (czoło kolejki) na czas montowania, agregacje arkusza,
 * losy ścian, tempo taśmy, próg dużego zlecenia, najlepszy bid i ask oraz preferencje `hq.flow.v1`.
 */

/** Okno losów ścian i progu ściany: ostatnia godzina (z historią serwera). */
const WALL_WINDOW_MS = 3_600_000;
/** Próg dużego zlecenia agresora (jak w Wykresach) i próg dużego zlecenia w arkuszu (okno 30 min). */
const AUTO_WINDOW_MS = 3_600_000;
const LOT_WINDOW_MS = 30 * 60_000;
const WALL_FLOOR_USD = 100_000;
const WHALES_STALE_MS = 20 * 60_000;
/** Dokładny arkusz starszy niż tyle ms nie daje środka i spreadu (drabina wraca do swojej agregacji). */
const TOP_STALE_MS = 30_000;

function loadPrefs(): FlowPrefs {
  try {
    return parseFlowPrefs(JSON.parse(localStorage.getItem(FLOW_PREFS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_FLOW_PREFS;
  }
}

function savePrefs(p: FlowPrefs): void {
  try {
    localStorage.setItem(FLOW_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Zapis niedostępny (tryb prywatny) — ustawienia zostają do zamknięcia strony
  }
}

export interface FlowStep {
  id: StepId;
  hist: BookHistory;
  step: number;
}

export interface FlowWalls {
  fates: WallFate[];
  open: OpenWall[];
  /** Próg ściany (USD) i próg dużego zlecenia w arkuszu (USD). */
  minUsd: number;
  lotUsd: number;
  /** Początek okna z danymi (ms). */
  since: number | null;
}

export interface FlowColumnData {
  store: ProStore;
  prefs: FlowPrefs;
  patch: (p: Partial<FlowPrefs>) => void;
  /** Agregacje arkusza (dokładna, bliska, daleka) bez powtórzeń i wybrana. */
  steps: FlowStep[];
  chosen: FlowStep | null;
  hist: BookHistory | null;
  walls: FlowWalls;
  pace: TapePace;
  bigUsd: number;
  /** Najlepszy bid i ask ze świeżego dokładnego arkusza. */
  top: { bid: number; ask: number } | null;
  /** Czoło kolejki z kanału bbo (bilans z ostatnich minut). */
  head: LadderHead | null;
  /** Zlecenia wielorybów tego rynku ze świeżego pliku skanera. */
  whales: readonly WhaleOrder[] | null;
}

export function useFlowColumn(coin: Market): FlowColumnData {
  const store = storeFor(coin);
  useEffect(() => {
    startRecording(store);
    // Ostatnia godzina z zapisu serwera: mapa ciepła, taśma 15 min i losy ścian od pierwszej chwili
    requestHistory(store, store.serverNow() - WALL_WINDOW_MS);
  }, [store]);
  // Czoło kolejki: kanał bbo tylko, gdy drabina jest na ekranie
  useEffect(() => store.watchBbo(), [store]);
  useStoreVersion(store, 250);
  const [prefs, setPrefs] = useState<FlowPrefs>(loadPrefs);
  const patch = useCallback((p: Partial<FlowPrefs>) => {
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
    .filter((s, i, all): s is FlowStep => s.hist !== null && Number.isFinite(s.step) && all.findIndex((x) => x.hist === s.hist) === i);
  const chosen = steps.find((s) => s.id === prefs.step) ?? steps.find((s) => s.id === 'near') ?? steps[0] ?? null;
  const hist = chosen?.hist ?? null;
  const histVersion = hist?.version ?? 0;

  // Losy ścian z ostatniej godziny wybranej agregacji (przeliczane przy nowej migawce)
  const walls = useMemo((): FlowWalls => {
    if (!hist) return { fates: [], open: [], minUsd: WALL_FLOOR_USD, lotUsd: bigUsd * LOT_FLOOR, since: null };
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

  // Najlepszy bid i ask z dokładnego arkusza (świeży), żeby środek i spread nie zależały od kroku drabiny
  const ex = books.exact?.latest() ?? null;
  const top = ex && ex.nBids > 0 && ex.nBids < ex.px.length && now - ex.t <= TOP_STALE_MS ? { bid: ex.px[0], ask: ex.px[ex.nBids] } : null;

  const hq = store.head;
  const head = hq.bid || hq.ask ? { bid: hq.bid, ask: hq.ask, flow: hq.flow(now - HEAD_FLOW_MS, now + 1), from: hq.from, first: hq.first } : null;

  return { store, prefs, patch, steps, chosen, hist, walls, pace, bigUsd, top, head, whales };
}
