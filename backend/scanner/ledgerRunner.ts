import { AB_DESIGN } from '../../src/utils/abTest.ts';
import { HOUR_DESIGN, type HourRow, TRUST_DESIGN, type TrustHour, hourRow, trustHour } from '../../src/utils/schrodiTrust.ts';
import { fitEnsemble } from '../../src/utils/ensemble.ts';
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
  type CatForecast,
  type CatModel,
  type CatResolution,
  type HourForecast,
  buildSummary,
  ensPairs,
  makeCatForecast,
  makeHourForecast,
  makeMktForecast,
  makeRetForecast,
  makeRetForecastB,
  type Regime,
  makeTouchForecast,
  nextAci,
  resolveCat,
  resolveHour,
  resolveMkt,
  resolveRet,
  resolveTouch,
  slotOf,
} from './forecaster.ts';
import type { MarketSnap } from './marketQuotes.ts';
import type { SchrodiInput } from '../../src/utils/schrodi.ts';
import { type CommitResult, type LedgerRepo, type LedgerStore, commitLedger, dayKey } from './ledgerStore.ts';
import { canonicalJson } from './ledger.ts';
import type { stampDigest } from './ots.ts';

/**
 * Koordynator weryfikowalnego dziennika (wywoływany co minutę):
 *  1. w nowym slocie 15 min (do 5 min po jego początku) wydaje prognozy; początkiem horyzontu jest pełna minuta PO
 *     wydaniu (bez podglądania ceny między początkiem slotu a wydaniem); slot przegapiony nie jest uzupełniany wstecz —
 *     dostaje jawny rekord `skip` z powodem (brak modelu, ceny, przerwa);
 *     W tym samym slocie i tej samej partii — prognoza kota (Schrödi), jeśli jego dane z tego slotu są gotowe, a o :15
 *     i :30 godzina na żywo (z rekordu kota z początku godziny);
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
/** SHA-256 kanonicznego JSON planu oceny A/B — identyfikator prerejestracji w dzienniku */
const AB_HASH = createHash('sha256').update(canonicalJson(AB_DESIGN)).digest('hex');
/** SHA-256 kanonicznego JSON planu oceny zaufania kota */
const TRUST_HASH = createHash('sha256').update(canonicalJson(TRUST_DESIGN)).digest('hex');
/** SHA-256 kanonicznego JSON planu oceny godziny na żywo */
const HOUR_HASH = createHash('sha256').update(canonicalJson(HOUR_DESIGN)).digest('hex');
const MODEL_MAX_AGE = 3 * HOUR;
const KEEP = 31 * DAY;
/** Okno wydania rekordu „model vs rynek” w slocie (od początku slotu): 5–10 min, czyli 5–10 min przed terminem rynku */
const MKT_FROM = 5 * MIN;
const MKT_TO = 10 * MIN;
/** Notowanie rynku starsze niż 30 s w chwili wydania — nie zapisujemy (porównanie z modelem z innej chwili) */
const MKT_MAX_QUOTE_AGE = 30_000;
/** Pokwitowań slotów na jedno wywołanie (nadrabianie zaległych po awarii kalendarzy) */
const STAMPS_PER_TICK = 4;

export interface LedgerData {
  model: VolModel | null;
  modelAt: number;
  sigma1h: number;
  levels: { pdh: number; pdl: number; day: number } | null;
  refreshModel(now: number): Promise<void>;
  refreshLevels(now: number): Promise<void>;
  minuteCandles(from: number, now: number): Promise<RangeBar[]>;
  /** Reżim zmienności (BOCPD na świecach 5m) do wariantu B — opcjonalny; B tylko z reżimem policzonym w slocie wydania */
  regime?: Regime | null;
  regimeAt?: number;
  refreshRegime?(now: number): Promise<void>;
  /** Kot (Schrödi) — opcjonalny; wydawany tylko z danymi pobranymi w slocie wydania */
  cat?: CatModel | null;
  catInput?: { slot: number; inp: SchrodiInput } | null;
  refreshCat?(now: number): Promise<void>;
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
    /** Migawka aktywnego 15-minutowego rynku HIP-4 z terminem `expiry` (model vs rynek); brak = wyłączone */
    markets?: (expiry: number, now: number) => Promise<MarketSnap | null>;
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
  /**
   * Kolejka pokwitowań slotów (skrót = hash ostatniej prognozy slotu): ponawiane do skutku, także po restarcie
   * (przy starcie — sloty z prognozą bez pliku `.ots`); bez pokwitowania weryfikator odrzuca slot.
   */
  private stampQueue: { slot: number; hash: string; batch: '' | 'm' }[] = [];
  /** Próby pobrania rynku HIP-4 w slocie (najwyżej 2 — zapytania ważą ~22 z budżetu API) */
  private mktTries = new Map<number, number>();
  /** Prerejestracje katalogów (laboratorium) z dziennika */
  private preregs: Record<string, unknown>[] = [];
  /** Rekord dopisany poza przebiegiem (prerejestracja) — zatwierdzenie przy najbliższym przebiegu */
  private dirty = false;
  /** Rozstrzygnięte pełne godziny kota z całego dziennika (ocena zaufania) — po slocie, w zwartej postaci */
  private trustHours = new Map<number, TrustHour>();
  /** Rozstrzygnięte zapisy godziny na żywo z całego dziennika (ocena wobec reguły z samej drogi ceny) */
  private hourRows = new Map<string, HourRow>();

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
    this.preregs = st.preregs;
    for (const [id, r] of st.catHours.resolutions) this.addTrustHour(st.catHours.forecasts.get(id), r);
    for (const h of RET_HORIZONS) {
      const ret = [...this.forecasts.values()].filter((f): f is RetForecast => f.kind === 'ret' && !f.variant && f.h === h).sort((a, b) => a.t - b.t);
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
    // Zaległe pokwitowania (np. kalendarze niedostępne przed restartem)
    // Partie slotu: prognozy główne ('') i „model vs rynek” ('m', wydawane później w slocie) mają osobne pokwitowania
    const lastHash = new Map<string, { slot: number; hash: string; batch: '' | 'm' }>();
    for (const f of this.forecasts.values()) {
      const h = (f as Forecast & { hash?: string }).hash;
      const batch = f.kind === 'mkt' ? 'm' : '';
      if (typeof h === 'string') lastHash.set(`${f.slot}${batch}`, { slot: f.slot, hash: h, batch });
    }
    for (const q of lastHash.values()) if (!this.d.store.exists(this.receiptPath(q.slot, q.batch))) this.stampQueue.push(q);
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
      else if (b.k === 'r') {
        this.resolutions.set(b.id as string, b as unknown as Resolution);
        this.addTrustHour(this.forecasts.get(b.id as string), b);
      }
      else if (b.k === 's') this.skips.set(b.slot as number, b as unknown as SkipRecord);
      else if (b.k === 'p') this.preregs.push({ ...b, hash: this.d.store.head });
    }
  }

  /** Pełna godzina kota albo zapis godziny na żywo z rozstrzygnięciem (bez unieważnionych) do oceny zaufania */
  private addTrustHour(f: unknown, r: Record<string, unknown>): void {
    const c = f as CatForecast | HourForecast | undefined;
    if (c?.kind === 'hour' && typeof r.void !== 'string' && 'yBig' in r) this.hourRows.set(c.id, hourRow(c, r as unknown as CatResolution));
    if (c?.kind !== 'cat' || c.slot % HOUR !== 0 || typeof r.void === 'string' || !('yBig' in r)) return;
    const h = trustHour(c, r as unknown as CatResolution);
    if (h) this.trustHours.set(h.slot, h);
  }

  /**
   * Prerejestracja katalogu (laboratorium folkloru): rekord `{k: 'p', id, t, catalogHash, catalog}` w łańcuchu hashy —
   * dowód, że definicje istniały przed danymi oceny (pokwitowanie OTS najbliższego slotu obejmuje głowę łańcucha).
   * Ten sam hash już w dzienniku → czas i hash linii tamtego rekordu. Dziennik niegotowy albo w trakcie przebiegu → null
   * (przebieg może dopisywać z wcześniejszym czasem — rekord w środku przebiegu mógłby trafić do pliku następnego dnia
   * przed liniami dnia poprzedniego i przerwać łańcuch; laboratorium ponawia za 10 min).
   */
  register(body: { id: string; catalogHash: string; catalog: unknown }, now: number): { at: number; added: boolean; hash: string } | null {
    if (!this.ok || this.running) return null;
    const prev = this.preregs.find((p) => p.catalogHash === body.catalogHash && typeof p.t === 'number');
    if (prev) return { at: prev.t as number, added: false, hash: String(prev.hash) };
    const t = this.clock(now);
    const before = this.preregs.length;
    this.add([{ k: 'p', id: body.id, t, catalogHash: body.catalogHash, catalog: body.catalog }], t);
    this.dirty = true;
    return { at: t, added: true, hash: String(this.preregs[before]?.hash ?? '') };
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
    // Reżim (wariant B) opcjonalny: błąd pobrania nie wstrzymuje wersji A — slot bez wariantu B
    let regimeOk = !!data.refreshRegime;
    if (data.refreshRegime) {
      try {
        await data.refreshRegime(now);
      } catch {
        regimeOk = false;
      }
    }
    // Kot opcjonalny jak reżim: dane tylko przed wydaniem w nowym slocie; błąd pobrania = slot bez kota
    if (data.refreshCat && now - slotOf(now) < ISSUE_WINDOW && !this.forecasts.has(`${slotOf(now)}-ret60`)) {
      try {
        await data.refreshCat(now);
      } catch {
        // slot bez kota
      }
    }
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

    // Plan oceny A/B prerejestrowany w łańcuchu raz, zanim powstaną oceniane pary (wariant B włączony)
    if (data.refreshRegime && !this.preregs.some((p) => p.catalogHash === AB_HASH)) {
      this.add([{ k: 'p', id: AB_DESIGN.id, t: ti, catalogHash: AB_HASH, catalog: AB_DESIGN }], ti);
      appended++;
    }
    // Plan oceny zaufania kota — w łańcuchu przed pierwszą ocenianą godziną (liczą się sloty od chwili rejestracji)
    if (data.refreshCat && !this.preregs.some((p) => p.catalogHash === TRUST_HASH)) {
      this.add([{ k: 'p', id: TRUST_DESIGN.id, t: ti, catalogHash: TRUST_HASH, catalog: TRUST_DESIGN }], ti);
      appended++;
    }
    // Plan oceny godziny na żywo — w łańcuchu przed pierwszym zapisem godziny (liczą się godziny od chwili rejestracji)
    if (data.refreshCat && data.cat?.hour && !this.preregs.some((p) => p.catalogHash === HOUR_HASH)) {
      this.add([{ k: 'p', id: HOUR_DESIGN.id, t: ti, catalogHash: HOUR_HASH, catalog: HOUR_DESIGN }], ti);
      appended++;
    }

    // 1. Wydanie prognoz w bieżącym slocie — tylko w przebiegu zaczętym w tym slocie: reżim i kot są pobierane dla slotu
    // chwili `now`; przebieg sprzed granicy (np. pierwsze pobranie modelu po restarcie) zostawia wydanie następnemu
    const issued: Record<string, unknown>[] = [];
    if (!this.forecasts.has(`${slot}-ret60`) && ti - slot < ISSUE_WINDOW && slotOf(now) === slot) {
      const px = this.d.markPx();
      const fresh = data.model && ti - data.modelAt <= MODEL_MAX_AGE;
      const reason = !fresh ? 'no-model' : !(px && px > 0) ? 'no-price' : !Number.isFinite(data.sigma1h) ? 'no-benchmark' : null;
      if (reason) this.slotFail = { slot, reason };
      else {
        const tm = { slot, ti, t: Math.floor(ti / MIN) * MIN + MIN };
        for (const h of RET_HORIZONS) issued.push({ ...makeRetForecast(data.model!, tm, px!, h, data.sigma1h, this.aci[h] ?? ACI_ALPHA) });
        // A/B: wariant B (σ z mieszaniny modelu i reżimu BOCPD) dla 1 h — ta sama chwila i partia pokwitowania co A
        if (regimeOk && data.regime && data.regimeAt !== undefined && slotOf(data.regimeAt) === slot && data.regimeAt <= ti) {
          const a = issued.find((f) => f.id === `${slot}-ret60`) as unknown as RetForecast | undefined;
          if (a) issued.push({ ...makeRetForecastB(data.model!, a, data.regime) });
        }
        const today = Math.floor(ti / DAY) * DAY;
        if (data.levels && data.levels.day === today - DAY) issued.push({ ...makeTouchForecast(data.model!, tm, px!, data.levels.pdh, data.levels.pdl) });
        if (data.cat && data.catInput?.slot === slot) {
          const c = makeCatForecast(data.cat, data.catInput.inp, tm);
          if (c) issued.push({ ...c });
          // Godzina na żywo (:15, :30): tylko z rekordem kota z początku tej godziny
          const cat0 = this.forecasts.get(`${slot - (slot % HOUR)}-cat`);
          const hf = data.cat.hour && cat0?.kind === 'cat' ? makeHourForecast(data.cat.hour, cat0, data.catInput.inp.m1, tm) : null;
          if (hf) issued.push({ ...hf });
        }
        this.add(issued, ti);
        appended += issued.length;
        this.accounted = Math.max(this.accounted, slot);
        // Pokwitowanie: głowa łańcucha po wydaniu tego slotu (= hash ostatniej prognozy slotu)
        this.stampQueue.push({ slot, hash: this.d.store.head, batch: '' });
      }
    }

    // 1b. Model vs rynek (HIP-4): 5–10 min przed końcem slotu — aktywny 15-minutowy rynek binarny z terminem = koniec slotu
    // Tylko w slocie z prognozami głównymi: slot bez nich dostaje jawny `skip` — rekord rynku w takim slocie dałby
    // w łańcuchu jednocześnie prognozę i pominięcie (nie do naprawienia w historii tylko dopisywanej)
    const mktDone = [...this.forecasts.values()].some((f) => f.kind === 'mkt' && f.slot === slot);
    const mainIssued = this.forecasts.has(`${slot}-ret60`);
    if (this.d.markets && mainIssued && !mktDone && ti - slot >= MKT_FROM && ti - slot < MKT_TO && (this.mktTries.get(slot) ?? 0) < 2) {
      this.mktTries.set(slot, (this.mktTries.get(slot) ?? 0) + 1);
      const fresh = data.model && ti - data.modelAt <= MODEL_MAX_AGE;
      const snap = fresh ? await this.d.markets(slot + SLOT, ti).catch(() => null) : null;
      // Chwila wydania po pobraniu notowania i ceny (bez podglądania); cena = środek z migawki (świeży), notowanie ≤ 30 s
      const t2 = this.clock(now);
      const bookFresh = snap !== null && (snap.bookTime === null || (t2 - snap.bookTime <= MKT_MAX_QUOTE_AGE && snap.bookTime <= t2 + 5_000));
      if (snap && bookFresh && snap.px > 0 && slotOf(t2) === slot && t2 - slot < MKT_TO) {
        // Wagi ensemble i rekalibracji rynku wyłącznie z pytań rozstrzygniętych w 30 dniach przed chwilą wydania
        const pairs = ensPairs(this.forecasts.values(), this.resolutions, t2);
        const f = makeMktForecast(data.model!, { slot, ti: t2, t: Math.floor(t2 / MIN) * MIN + MIN }, snap.px, snap, fitEnsemble(pairs, t2), fitEnsemble(pairs, t2, { mode: 'market' }));
        if (f) {
          this.add([{ ...f }], t2);
          appended += 1;
          this.stampQueue.push({ slot, hash: this.d.store.head, batch: 'm' });
        }
      }
    }
    // Pokwitowania z kolejki (najstarsze najpierw); pierwsza porażka kończy próby w tym wywołaniu
    let stamped = false;
    for (let i = 0; this.d.stamp && this.stampQueue.length > 0 && i < STAMPS_PER_TICK; i++) {
      const ps = this.stampQueue[0];
      const res = await this.d.stamp(new Uint8Array(Buffer.from(ps.hash, 'hex')));
      if (!res) break;
      this.d.store.write(this.receiptPath(ps.slot, ps.batch), res.ots);
      this.stampQueue.shift();
      stamped = true;
    }

    // 2. Rozstrzygnięcia (czas rozstrzygnięcia z zegara — po wydaniu w tym samym wywołaniu)
    const due = [...this.forecasts.values()].filter((f) => !this.resolutions.has(f.id) && f.t + f.h * MIN + RESOLVE_LAG <= ti);
    const resBodies: Record<string, unknown>[] = [];
    if (due.length > 0) {
      // Godzina na żywo: od minuty przed początkiem godziny (cena odniesienia)
      const from = Math.min(...due.map((f) => (f.kind === 'hour' ? f.hs : f.t)));
      const candles = await data.minuteCandles(from, ti);
      const rNow = this.clock(ti);
      for (const f of due.sort((a, b) => a.t - b.t)) {
        const r =
          f.kind === 'ret'
            ? resolveRet(f, candles, rNow)
            : f.kind === 'touch'
              ? resolveTouch(f, candles, rNow)
              : f.kind === 'cat'
                ? resolveCat(f, candles, rNow)
                : f.kind === 'hour'
                  ? resolveHour(f, candles, rNow)
                  : resolveMkt(f, candles, rNow);
        if (r) {
          resBodies.push({ ...r });
          if (f.kind === 'ret' && !f.variant && 'inAci' in r) this.aci[f.h] = nextAci(this.aci[f.h] ?? ACI_ALPHA, r.inAci === 0);
        } else if (rNow - (f.t + f.h * MIN) > VOID_AFTER) {
          resBodies.push({ k: 'r', id: f.id, t: rNow, void: 'no-data' });
        }
      }
    }
    this.add(resBodies, ti);
    appended += resBodies.length;

    // 3. Kotwice zakończonych dni (także zaległe po przerwie), najwyżej 2 na wywołanie
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
    const changed = appended > 0 || stamped || this.dirty;
    this.dirty = false;
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
    // Rekord zakresowy po końcu zakresu (długa przerwa zostaje w podsumowaniu, dopóki jej część jest w oknie)
    for (const [s, k] of this.skips) if ((k.until ?? s) < now - KEEP) this.skips.delete(s);
    this.stampQueue = this.stampQueue.filter((q) => q.slot >= now - KEEP);
    for (const s of this.mktTries.keys()) if (s < now - DAY) this.mktTries.delete(s);
  }

  /** Pokwitowanie partii slotu: prognozy główne `<slot>.ots`, „model vs rynek” `<slot>-m.ots`. */
  private receiptPath(slot: number, batch: '' | 'm' = ''): string {
    return `ots/slots/${dayKey(slot)}/${slot}${batch ? `-${batch}` : ''}.ots`;
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
      abRegisteredAt: (this.preregs.find((p) => p.catalogHash === AB_HASH)?.t as number | undefined) ?? null,
      catHours: [...this.trustHours.values()],
      trustPlan: ((p) => (p && typeof p.t === 'number' ? { id: TRUST_DESIGN.id, hash: String(p.hash), at: p.t } : null))(
        this.preregs.find((p) => p.catalogHash === TRUST_HASH)
      ),
      hourRows: [...this.hourRows.values()],
      hourPlan: ((p) => (p && typeof p.t === 'number' ? { id: HOUR_DESIGN.id, hash: String(p.hash), at: p.t } : null))(
        this.preregs.find((p) => p.catalogHash === HOUR_HASH)
      ),
    });
  }
}
