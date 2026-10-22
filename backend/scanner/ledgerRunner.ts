import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RangeBar, VolModel } from '../../src/utils/volatility.ts';
import type { DeskLedgerSummary } from '../../src/utils/deskLedger.ts';
import {
  ACI_ALPHA,
  type Forecast,
  type Resolution,
  RET_HORIZONS,
  buildSummary,
  makeRetForecast,
  makeTouchForecast,
  nextAci,
  resolveRet,
  resolveTouch,
  slotOf,
} from './forecaster.ts';
import { type LedgerRepo, type LedgerStore, commitLedger, dayKey } from './ledgerStore.ts';
import { stampDigest } from './ots.ts';

/**
 * Koordynator weryfikowalnego dziennika (wywoływany co minutę):
 *  1. w nowym slocie 15 min (do 5 min po jego początku) wydaje prognozy — bez dopisywania wstecz: slot przegapiony zostaje pusty;
 *  2. rozstrzyga prognozy po horyzoncie ze świec 1m; bez danych przez 6 h po horyzoncie — jawne unieważnienie (`void`);
 *  3. po 00:10 UTC kotwiczy plik poprzedniego dnia w Bitcoinie (OpenTimestamps);
 *  4. zapisuje podsumowanie i publikuje zmiany na gałąź `ledger` (commit bez --force).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ISSUE_WINDOW = 5 * MIN;
const RESOLVE_LAG = 90_000;
const VOID_AFTER = 6 * HOUR;

export interface LedgerData {
  model: VolModel | null;
  sigma1h: number;
  levels: { pdh: number; pdl: number; day: number } | null;
  refreshModel(now: number): Promise<void>;
  refreshLevels(now: number): Promise<void>;
  minuteCandles(from: number, now: number): Promise<RangeBar[]>;
}

interface OtsEntry {
  day: string;
  file: string;
  calendars: number;
  stampedAt: number;
}

export class LedgerRunner {
  private readonly d: {
    coin: string;
    data: LedgerData;
    store: LedgerStore;
    repo: LedgerRepo | null;
    markPx: () => number | null;
    stamp?: typeof stampDigest;
  };
  private forecasts = new Map<string, Forecast>();
  private resolutions = new Map<string, Resolution & { void?: string }>();
  private aci: Record<number, number> = Object.fromEntries(RET_HORIZONS.map((h) => [h, ACI_ALPHA]));
  private ots: OtsEntry[] = [];
  private ok = false;
  private lastSummaryAt = 0;
  private running = false;

  constructor(d: LedgerRunner['d']) {
    this.d = d;
  }

  /** Wczytanie i weryfikacja łańcucha; ACI odtwarzane deterministycznie z rozstrzygnięć. */
  init(now: number): { ok: boolean; error?: string } {
    const st = this.d.store.load(now);
    this.ok = st.ok;
    if (!st.ok) return { ok: false, error: st.error };
    for (const [id, f] of st.forecasts) this.forecasts.set(id, f as unknown as Forecast);
    for (const [id, r] of st.resolutions) this.resolutions.set(id, r as unknown as Resolution);
    const retDone = [...this.forecasts.values()]
      .filter((f) => f.kind === 'ret')
      .sort((a, b) => a.t - b.t)
      .map((f) => ({ f, r: this.resolutions.get(f.id) }))
      .filter((x) => x.r && 'inAci' in x.r);
    for (const { f, r } of retDone) this.aci[f.h] = nextAci(this.aci[f.h] ?? ACI_ALPHA, (r as { inAci: number }).inAci === 0);
    try {
      const idx = JSON.parse(readFileSync(this.d.store.path('ots/index.json'), 'utf8')) as OtsEntry[];
      if (Array.isArray(idx)) this.ots = idx.filter((e) => e && typeof e.day === 'string');
    } catch {
      // brak indeksu
    }
    return { ok: true };
  }

  private add(bodies: Record<string, unknown>[], now: number): void {
    if (bodies.length === 0) return;
    this.d.store.append(bodies, now);
    for (const b of bodies) {
      if (b.k === 'f') this.forecasts.set(b.id as string, b as unknown as Forecast);
      else if (b.k === 'r') this.resolutions.set(b.id as string, b as unknown as Resolution);
    }
  }

  /** Jedno wywołanie naraz — pobranie świec może czekać na budżet wag dłużej niż interwał timera. */
  async tick(now: number): Promise<{ appended: number; committed: boolean }> {
    if (!this.ok || this.running) return { appended: 0, committed: false };
    this.running = true;
    try {
      return await this.tickInner(now);
    } finally {
      this.running = false;
    }
  }

  private async tickInner(now: number): Promise<{ appended: number; committed: boolean }> {
    const { data } = this.d;
    await data.refreshModel(now);
    await data.refreshLevels(now);
    const bodies: Record<string, unknown>[] = [];

    // 1. Wydanie prognoz w bieżącym slocie
    const slot = slotOf(now);
    const px = this.d.markPx();
    if (now - slot < ISSUE_WINDOW && !this.forecasts.has(`${slot}-ret60`) && data.model && px && px > 0 && Number.isFinite(data.sigma1h)) {
      for (const h of RET_HORIZONS) bodies.push({ ...makeRetForecast(data.model, slot, px, h, data.sigma1h, this.aci[h] ?? ACI_ALPHA) });
      const today = Math.floor(now / DAY) * DAY;
      if (data.levels && data.levels.day === today - DAY) bodies.push({ ...makeTouchForecast(data.model, slot, px, data.levels.pdh, data.levels.pdl) });
    }

    // 2. Rozstrzygnięcia
    const due = [...this.forecasts.values()].filter((f) => !this.resolutions.has(f.id) && f.t + f.h * MIN + RESOLVE_LAG <= now);
    if (due.length > 0) {
      const from = Math.min(...due.map((f) => f.t));
      const candles = await data.minuteCandles(from, now);
      for (const f of due.sort((a, b) => a.t - b.t)) {
        const r = f.kind === 'ret' ? resolveRet(f, candles, now) : resolveTouch(f, candles, now);
        if (r) {
          bodies.push({ ...r });
          if (f.kind === 'ret' && 'inAci' in r) this.aci[f.h] = nextAci(this.aci[f.h] ?? ACI_ALPHA, r.inAci === 0);
        } else if (now - (f.t + f.h * MIN) > VOID_AFTER) {
          bodies.push({ k: 'r', id: f.id, t: now, void: 'no-data' });
        }
      }
    }
    this.add(bodies, now);

    // 3. Kotwica dnia poprzedniego (OpenTimestamps)
    let stamped = false;
    const yesterday = dayKey(now - DAY);
    const sinceMidnight = now - Math.floor(now / DAY) * DAY;
    const otsRel = `ots/${yesterday}.jsonl.ots`;
    if (sinceMidnight >= 10 * MIN && this.d.store.exists(`${yesterday}.jsonl`) && !this.d.store.exists(otsRel)) {
      const digest = new Uint8Array(createHash('sha256').update(readFileSync(this.d.store.path(`${yesterday}.jsonl`))).digest());
      const res = await (this.d.stamp ?? stampDigest)(digest);
      if (res) {
        this.d.store.write(otsRel, res.ots);
        this.ots = [...this.ots.filter((e) => e.day !== yesterday), { day: yesterday, file: otsRel, calendars: res.calendars.length, stampedAt: now }];
        this.d.store.write('ots/index.json', JSON.stringify(this.ots));
        stamped = true;
      }
    }

    // 4. Podsumowanie (przy zmianach albo co 15 min) i publikacja
    const changed = bodies.length > 0 || stamped;
    if (!changed && now - this.lastSummaryAt < 15 * MIN) return { appended: 0, committed: false };
    this.d.store.write('summary.json', JSON.stringify(this.summary(now)));
    this.lastSummaryAt = now;
    const committed = this.d.repo ? await commitLedger(this.d.repo, `dziennik: ${new Date(now).toISOString()}`, now) : false;
    return { appended: bodies.length, committed };
  }

  summary(now: number): DeskLedgerSummary {
    const s = buildSummary({
      coin: this.d.coin,
      now,
      head: { hash: this.d.store.head, lines: this.d.store.lines },
      forecasts: this.forecasts,
      resolutions: this.resolutions,
      aci: this.aci,
      ots: this.ots.slice(-7),
    });
    return s;
  }
}
