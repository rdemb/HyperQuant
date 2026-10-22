import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { RangeBar, VolModel } from '../../src/utils/volatility.ts';
import type { DeskLedgerSummary } from '../../src/utils/deskLedger.ts';
import {
  ACI_ALPHA,
  type Forecast,
  type Resolution,
  type RetForecast,
  RET_HORIZONS,
  SLOT,
  type SkipRecord,
  buildSummary,
  makeRetForecast,
  makeTouchForecast,
  nextAci,
  resolveRet,
  resolveTouch,
  slotOf,
} from './forecaster.ts';
import { type CommitResult, type LedgerRepo, type LedgerStore, commitLedger, dayKey } from './ledgerStore.ts';
import type { stampDigest } from './ots.ts';

/**
 * Koordynator weryfikowalnego dziennika (wywoływany co minutę):
 *  1. w nowym slocie 15 min (do 5 min po jego początku) wydaje prognozy; początkiem horyzontu jest pełna minuta PO
 *     wydaniu (bez podglądania ceny między początkiem slotu a wydaniem); slot przegapiony nie jest uzupełniany wstecz —
 *     dostaje jawny rekord `skip` z powodem (brak modelu, ceny, przerwa);
 *  2. zaraz po wydaniu znakuje głowę łańcucha w OpenTimestamps (niezależne kalendarze od razu, blok Bitcoina po kilku
 *     godzinach) — pokwitowanie `ots/slots/<slot>.ots` dowodzi, że prognozy istniały przed rozstrzygnięciem;
 *  3. rozstrzyga prognozy po horyzoncie ze świec 1m; bez danych przez 6 h po horyzoncie — jawne unieważnienie (`void`);
 *  4. kotwiczy pliki zakończonych dni (OpenTimestamps), publikuje podsumowanie (gałąź `main`) i commit na `ledger`.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ISSUE_WINDOW = 5 * MIN;
const RESOLVE_LAG = 90_000;
const VOID_AFTER = 6 * HOUR;
const MODEL_MAX_AGE = 3 * HOUR;
const KEEP = 31 * DAY;

export interface LedgerData {
  model: VolModel | null;
  modelAt: number;
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

export interface TickResult {
  appended: number;
  commit: CommitResult | null;
}

export class LedgerRunner {
  private readonly d: {
    coin: string;
    data: LedgerData;
    store: LedgerStore;
    repo: LedgerRepo | null;
    markPx: () => number | null;
    /** Znakowanie OpenTimestamps (brak = wyłączone, np. w testach) */
    stamp?: typeof stampDigest;
    /** Zegar do chwili wydania (po pobraniu danych); domyślnie czas wywołania */
    clock?: () => number;
    /** Publikacja podsumowania (gałąź `main` repo danych) */
    publish?: (json: string) => void;
  };
  private forecasts = new Map<string, Forecast>();
  private resolutions = new Map<string, Resolution & { void?: string }>();
  private skips = new Map<number, SkipRecord>();
  private aci: Record<number, number> = Object.fromEntries(RET_HORIZONS.map((h) => [h, ACI_ALPHA]));
  private ots: OtsEntry[] = [];
  private ok = false;
  private running = false;
  private lastSummaryAt = 0;
  /** Ostatni slot rozliczony (z prognozą albo jawnym `skip`) */
  private accounted: number | null = null;
  /** Powód niewydania w bieżącym slocie (do rekordu `skip`) */
  private slotFail: { slot: number; reason: string } | null = null;
  /** Pokwitowanie slotu do ponowienia (ten sam skrót: hash ostatniej prognozy slotu), najwyżej przez godzinę */
  private pendingStamp: { slot: number; hash: string; at: number } | null = null;

  constructor(d: LedgerRunner['d']) {
    this.d = d;
  }

  private clock(fallback: number): number {
    return this.d.clock ? this.d.clock() : fallback;
  }

  /** Wczytanie i weryfikacja łańcucha; ACI odtwarzane z α zapisanego przy wydaniu i późniejszych rozstrzygnięć. */
  init(now: number): { ok: boolean; error?: string } {
    const st = this.d.store.load(now);
    this.ok = st.ok;
    if (!st.ok) return { ok: false, error: st.error };
    for (const [id, f] of st.forecasts) this.forecasts.set(id, f as unknown as Forecast);
    for (const [id, r] of st.resolutions) this.resolutions.set(id, r as unknown as Resolution);
    for (const k of st.skips) this.skips.set(k.slot as number, k as unknown as SkipRecord);
    for (const h of RET_HORIZONS) {
      const ret = [...this.forecasts.values()].filter((f): f is RetForecast => f.kind === 'ret' && f.h === h).sort((a, b) => a.t - b.t);
      const last = ret[ret.length - 1];
      if (!last) continue;
      let a = last.aci ?? ACI_ALPHA;
      const later: { t: number; ft: number; miss: boolean }[] = [];
      for (const f of ret) {
        const r = this.resolutions.get(f.id) as (Resolution & { inAci?: number }) | undefined;
        if (r && typeof r.inAci === 'number' && r.t >= (last.ti ?? last.t)) later.push({ t: r.t, ft: f.t, miss: r.inAci === 0 });
      }
      later.sort((x, y) => x.t - y.t || x.ft - y.ft);
      for (const x of later) a = nextAci(a, x.miss);
      this.aci[h] = a;
    }
    // Ciągłość slotów z całego dziennika (także po przerwie dłuższej niż okno wczytanych rekordów)
    this.accounted = st.lastSlot;
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
      else if (b.k === 's') this.skips.set(b.slot as number, b as unknown as SkipRecord);
    }
  }

  /** Jedno wywołanie naraz — pobranie świec może czekać na budżet wag dłużej niż interwał timera. */
  async tick(now: number): Promise<TickResult> {
    if (!this.ok || this.running) return { appended: 0, commit: null };
    this.running = true;
    try {
      return await this.tickInner(now);
    } finally {
      this.running = false;
    }
  }

  private async tickInner(now: number): Promise<TickResult> {
    const { data } = this.d;
    await data.refreshModel(now);
    await data.refreshLevels(now);
    let appended = 0;

    // 0. Rozliczenie poprzednich slotów: brak prognozy = jawny `skip` (z powodem albo „przerwa”)
    const ti = this.clock(now);
    const slot = slotOf(ti);
    if (this.accounted === null) this.accounted = slot - SLOT;
    const missing: number[] = [];
    for (let s = this.accounted + SLOT; s < slot; s += SLOT) if (!this.forecasts.has(`${s}-ret60`) && !this.skips.has(s)) missing.push(s);
    const skipBodies: Record<string, unknown>[] =
      missing.length > 96
        ? [{ k: 's', slot: missing[0], until: missing[missing.length - 1], reason: 'outage' }]
        : missing.map((s) => ({ k: 's', slot: s, reason: this.slotFail?.slot === s ? this.slotFail.reason : 'outage' }));
    if (slot - SLOT > this.accounted) this.accounted = slot - SLOT;
    this.add(skipBodies, ti);
    appended += skipBodies.length;

    // 1. Wydanie prognoz w bieżącym slocie
    const issued: Record<string, unknown>[] = [];
    if (!this.forecasts.has(`${slot}-ret60`) && ti - slot < ISSUE_WINDOW) {
      const px = this.d.markPx();
      const fresh = data.model && ti - data.modelAt <= MODEL_MAX_AGE;
      const reason = !fresh ? 'no-model' : !(px && px > 0) ? 'no-price' : !Number.isFinite(data.sigma1h) ? 'no-benchmark' : null;
      if (reason) this.slotFail = { slot, reason };
      else {
        const tm = { slot, ti, t: Math.floor(ti / MIN) * MIN + MIN };
        for (const h of RET_HORIZONS) issued.push({ ...makeRetForecast(data.model!, tm, px!, h, data.sigma1h, this.aci[h] ?? ACI_ALPHA) });
        const today = Math.floor(ti / DAY) * DAY;
        if (data.levels && data.levels.day === today - DAY) issued.push({ ...makeTouchForecast(data.model!, tm, px!, data.levels.pdh, data.levels.pdl) });
        this.add(issued, ti);
        appended += issued.length;
        this.accounted = Math.max(this.accounted, slot);
        // Pokwitowanie: głowa łańcucha po wydaniu tego slotu (= hash ostatniej prognozy slotu)
        this.pendingStamp = { slot, hash: this.d.store.head, at: ti };
      }
    }
    if (this.pendingStamp && this.d.stamp) {
      const ps = this.pendingStamp;
      const res = await this.d.stamp(new Uint8Array(Buffer.from(ps.hash, 'hex')));
      if (res) {
        this.d.store.write(`ots/slots/${dayKey(ps.slot)}/${ps.slot}.ots`, res.ots);
        this.pendingStamp = null;
      } else if (ti - ps.at > HOUR) this.pendingStamp = null; // kalendarze niedostępne przez godzinę — brak pokwitowania (weryfikator to wykaże)
    }

    // 2. Rozstrzygnięcia (czas rozstrzygnięcia z zegara — po wydaniu w tym samym wywołaniu)
    const due = [...this.forecasts.values()].filter((f) => !this.resolutions.has(f.id) && f.t + f.h * MIN + RESOLVE_LAG <= ti);
    const resBodies: Record<string, unknown>[] = [];
    if (due.length > 0) {
      const from = Math.min(...due.map((f) => f.t));
      const candles = await data.minuteCandles(from, ti);
      const rNow = this.clock(ti);
      for (const f of due.sort((a, b) => a.t - b.t)) {
        const r = f.kind === 'ret' ? resolveRet(f, candles, rNow) : resolveTouch(f, candles, rNow);
        if (r) {
          resBodies.push({ ...r });
          if (f.kind === 'ret' && 'inAci' in r) this.aci[f.h] = nextAci(this.aci[f.h] ?? ACI_ALPHA, r.inAci === 0);
        } else if (rNow - (f.t + f.h * MIN) > VOID_AFTER) {
          resBodies.push({ k: 'r', id: f.id, t: rNow, void: 'no-data' });
        }
      }
    }
    this.add(resBodies, ti);
    appended += resBodies.length;

    // 3. Kotwice zakończonych dni (także zaległe po przerwie), najwyżej 2 na wywołanie
    let stamped = false;
    if (this.d.stamp && ti - Math.floor(ti / DAY) * DAY >= 10 * MIN) {
      const today = dayKey(ti);
      const days = this.dayFiles().filter((d) => d < today && !this.d.store.exists(`ots/${d}.jsonl.ots`));
      for (const d of days.slice(0, 2)) {
        const digest = new Uint8Array(createHash('sha256').update(readFileSync(this.d.store.path(`${d}.jsonl`))).digest());
        const res = await this.d.stamp(digest);
        if (!res) continue;
        const rel = `ots/${d}.jsonl.ots`;
        this.d.store.write(rel, res.ots);
        this.ots = [...this.ots.filter((e) => e.day !== d), { day: d, file: rel, calendars: res.calendars.length, stampedAt: ti }].sort((a, b) =>
          a.day.localeCompare(b.day)
        );
        this.d.store.write('ots/index.json', JSON.stringify(this.ots));
        stamped = true;
      }
    }

    this.prune(ti);

    // 4. Podsumowanie (przy zmianach albo co 15 min) i publikacja
    const changed = appended > 0 || stamped;
    if (!changed && ti - this.lastSummaryAt < 15 * MIN) return { appended: 0, commit: null };
    this.d.publish?.(JSON.stringify(this.summary(ti)));
    this.lastSummaryAt = ti;
    const commit = this.d.repo && changed ? await commitLedger(this.d.repo, `dziennik: ${new Date(ti).toISOString()}`, ti) : null;
    return { appended, commit };
  }

  private dayFiles(): string[] {
    const dir = this.d.store.path('');
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
          .map((f) => f.slice(0, 10))
          .sort()
      : [];
  }

  /** Mapy w pamięci: tylko ostatnie 31 dni (pliki na dysku zostają w całości). */
  private prune(now: number): void {
    for (const [id, f] of this.forecasts) {
      if (f.t >= now - KEEP) continue;
      this.forecasts.delete(id);
      this.resolutions.delete(id);
    }
    for (const s of this.skips.keys()) if (s < now - KEEP) this.skips.delete(s);
  }

  /** Pokwitowania slotów z ostatnich 24 h (podkatalogi dzienne — bez przeglądania całej historii). */
  private slotStamps(now: number): number {
    let n = 0;
    for (const day of [dayKey(now - DAY), dayKey(now)]) {
      const dir = this.d.store.path(`ots/slots/${day}`);
      if (!existsSync(dir)) continue;
      n += readdirSync(dir).filter((f) => {
        const s = Number(f.replace(/\.ots$/, ''));
        return Number.isFinite(s) && s >= now - DAY;
      }).length;
    }
    return n;
  }

  summary(now: number): DeskLedgerSummary {
    return buildSummary({
      coin: this.d.coin,
      now,
      head: { hash: this.d.store.head, lines: this.d.store.lines },
      forecasts: this.forecasts,
      resolutions: this.resolutions,
      aci: this.aci,
      ots: this.ots.slice(-7),
      skips: [...this.skips.values()],
      slotStamps: this.slotStamps(now),
    });
  }
}
