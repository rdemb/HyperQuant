import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildRegistry,
  emptyRegistryState,
  isRegistryState,
  parseDexMarkets,
  parsePerpDexs,
  recordSnapshot,
  type MarketSample,
  type RegistryState,
} from '../../src/utils/marketRegistry.ts';
import type { InfoClient } from './liqDetect.ts';

/** Rejestr przeliczany najwyżej raz na tyle (ms); takt timera częstszy, więc restart nie dokłada zapytań. */
export const MARKET_REGISTRY_EVERY_MS = 3_600_000;
/** Waga `perpDexs` i `metaAndAssetCtxs` (dokumentacja „Rate limits”: pozostałe zapytania info — 20) */
const INFO_WEIGHT = 20;
/** Odstęp między zapytaniami kolejnych giełd: wspólny budżet nie oddaje naraz całego wiadra jednemu zadaniu */
const DEFAULT_GAP_MS = 20_000;

/**
 * Okno startu w 15-minutowym slocie dziennika: od 3. do 8. minuty. Przebieg (do ~4 min przy 11 giełdach) kończy się przed
 * następnym slotem, więc nie zabiera budżetu prognoz w chwili ich wydania; takt co 5 min trafia w okno raz na slot.
 */
export const REGISTRY_START_WINDOW: readonly [number, number] = [3 * 60_000, 8 * 60_000];
const SLOT_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface MarketRegistryRunnerDeps {
  rest: InfoClient;
  /** Stan w `HQ_STATE_DIR` (próbki OI z ~10 dni, serie, członkowie) */
  statePath: string;
  /** `markets.json` w `HQ_OUT_DIR` */
  outPath: string;
  /** Rynki z pełnymi warstwami skanera (`scanner: "full"`) */
  scannerCoins: readonly string[];
  wait?: (ms: number) => Promise<void>;
  gapMs?: number;
  /** Okno startu w slocie (ms od początku slotu); domyślnie REGISTRY_START_WINDOW */
  startWindow?: readonly [number, number];
}

export interface MarketRegistryTick {
  ran: boolean;
  /** Pobrane giełdy */
  dexes?: number;
  markets?: number;
  error?: string;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/**
 * Rejestr rynków `markets.json` (reguła `reg-v1`, `src/utils/marketRegistry.ts`): raz na godzinę lista giełd
 * (`perpDexs`) i jedno `metaAndAssetCtxs` na giełdę, razem 20 × (1 + liczba giełd) wag. Bez giełdy głównej albo listy
 * giełd przebieg jest odrzucany (stan bez zmian, próba w następnym takcie); niedostępna giełda HIP-3 jest pomijana.
 */
export class MarketRegistryRunner {
  private readonly d: MarketRegistryRunnerDeps;
  private state: RegistryState;
  private running = false;

  constructor(d: MarketRegistryRunnerDeps) {
    this.d = d;
    let state = emptyRegistryState();
    try {
      const j: unknown = JSON.parse(readFileSync(d.statePath, 'utf8'));
      if (isRegistryState(j)) state = j;
    } catch {
      // brak albo uszkodzony stan — rejestr od nowa (4 stałe rynki, wejścia po 3 dniach)
    }
    this.state = state;
  }

  async tick(now: number): Promise<MarketRegistryTick> {
    if (this.running || now - this.state.lastAt < MARKET_REGISTRY_EVERY_MS) return { ran: false };
    const [w0, w1] = this.d.startWindow ?? REGISTRY_START_WINDOW;
    const inSlot = now % SLOT_MS;
    if (inSlot < w0 || inSlot >= w1) return { ran: false };
    const { rest } = this.d;
    // Zadanie mniej ważne niż prognozy w tym samym budżecie — czeka, gdy API jest w wycofaniu
    if (rest.healthy && !rest.healthy()) return { ran: false };
    this.running = true;
    try {
      const dexes = parsePerpDexs(await rest.info({ type: 'perpDexs' }, INFO_WEIGHT));
      if (!dexes) return { ran: false, error: 'brak listy giełd (perpDexs)' };
      const wait = this.d.wait ?? sleep;
      const fetched: string[] = [];
      const failed: string[] = [];
      const samples: MarketSample[] = [];
      for (const [i, dex] of dexes.entries()) {
        if (i > 0) await wait(this.d.gapMs ?? DEFAULT_GAP_MS);
        const rows = parseDexMarkets(await rest.info(dex === '' ? { type: 'metaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex }, INFO_WEIGHT), dex);
        if (rows === null) {
          if (dex === '') return { ran: false, error: 'brak kontekstów giełdy głównej (metaAndAssetCtxs)' };
          failed.push(dex);
          continue;
        }
        fetched.push(dex);
        samples.push(...rows);
      }
      const next = recordSnapshot(this.state, { at: now, dexes: fetched, samples });
      const file = buildRegistry(next, this.d.scannerCoins);
      writeJsonAtomic(this.d.statePath, next);
      writeJsonAtomic(this.d.outPath, file);
      this.state = next;
      return { ran: true, dexes: fetched.length, markets: file.markets.length, ...(failed.length ? { error: `giełdy bez odpowiedzi: ${failed.join(', ')}` } : {}) };
    } finally {
      this.running = false;
    }
  }
}
