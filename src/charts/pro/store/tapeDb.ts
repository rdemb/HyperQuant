import type { Side } from '../hl/parse';
import type { Span } from '../core/coverage';
import type { TradeRow } from '../core/tape';
import type { ProStore } from './proStore';
import { RETENTION_MS } from './proStore';

/**
 * Zapis taśmy w przeglądarce (IndexedDB) na dobę: minuty taśmy — czas, cena, wielkość, strona i tid
 * (bez adresów i hashy) — oraz odcinki pokrycia nagrania. Po powrocie na stronę footprint, Delta i CVD
 * z ostatnich godzin są od razu, a czas bez otwartej strony zostaje jawną luką. Kilka kart zapisuje tę samą
 * bazę: minuty i pokrycie się sumują, duplikaty transakcji odrzuca taśma (tid).
 */

export interface StoredMinute {
  minute: number;
  t: Float64Array;
  px: Float64Array;
  sz: Float64Array;
  side: Int8Array;
  tid: Float64Array;
}

/** Minimalny magazyn klucz–wartość (IndexedDB w przeglądarce, pamięć w testach). */
export interface TapeKv {
  minutesSince(from: number): Promise<StoredMinute[]>;
  getMinutes(minutes: number[]): Promise<(StoredMinute | undefined)[]>;
  putMinutes(list: StoredMinute[]): Promise<void>;
  deleteBefore(minute: number): Promise<void>;
  getSpans(): Promise<Span[]>;
  putSpans(spans: Span[]): Promise<void>;
}

/** Zapas na transakcje jeszcze w drodze: pokrycie zapisujemy do chwili sprzed kilku sekund. */
const IN_FLIGHT_MS = 3000;

export class TapePersistence {
  private readonly saved = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> | null = null;

  constructor(
    private readonly store: ProStore,
    private readonly kv: TapeKv,
    private readonly everyMs = 15_000
  ) {}

  /** Wczytuje zapis z ostatniej doby do taśmy i pokrycia (przed startem albo w trakcie strumienia). */
  async restore(): Promise<number> {
    const cut = this.store.serverNow() - RETENTION_MS;
    const [minutes, spans] = await Promise.all([this.kv.minutesSince(cut), this.kv.getSpans()]);
    const rows: TradeRow[] = [];
    for (const m of minutes.sort((a, b) => a.minute - b.minute)) {
      for (let i = 0; i < m.t.length; i++) rows.push({ t: m.t[i], px: m.px[i], sz: m.sz[i], side: m.side[i] as Side, tid: m.tid[i] });
    }
    this.store.restore(rows, spans.filter(([, b]) => b > cut));
    // Wczytane minuty nie wymagają ponownego zapisu, dopóki się nie zmienią
    for (const m of minutes) this.saved.set(m.minute, this.store.tape.chunk(m.minute)?.version ?? 0);
    return rows.length;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.save(), this.everyMs);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onHide);
      document.addEventListener('visibilitychange', this.onHide);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onHide);
      document.removeEventListener('visibilitychange', this.onHide);
    }
  }

  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') void this.save();
  };

  /** Zapisuje zmienione minuty i pokrycie; usuwa zapis starszy niż doba. */
  save(): Promise<void> {
    this.saving ??= this.doSave().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async doSave(): Promise<void> {
    const tape = this.store.tape;
    const now = this.store.serverNow();
    const cut = now - RETENTION_MS;
    const changed: StoredMinute[] = [];
    const versions: [number, number][] = [];
    for (const minute of tape.minutes()) {
      const c = tape.chunk(minute);
      if (!c || minute < cut || this.saved.get(minute) === c.version) continue;
      changed.push({
        minute,
        t: Float64Array.from(c.t),
        px: Float64Array.from(c.px),
        sz: Float64Array.from(c.sz),
        side: Int8Array.from(c.side),
        tid: Float64Array.from(c.tid),
      });
      versions.push([minute, c.version]);
    }
    try {
      if (changed.length > 0) {
        // Inna karta mogła zapisać te minuty — łączymy zamiast nadpisywać
        const stored = await this.kv.getMinutes(changed.map((m) => m.minute));
        await this.kv.putMinutes(changed.map((m, i) => (stored[i] ? mergeMinute(stored[i], m) : m)));
      }
      // Pokrycie z zapisu innych kart też zostaje: łączymy z bieżącym (odcinki się scalają)
      const spans = mergeSpans([...(await this.kv.getSpans()), ...this.store.coverage.snapshot(now - IN_FLIGHT_MS)]).filter(([, b]) => b > cut);
      await this.kv.putSpans(spans);
      await this.kv.deleteBefore(cut);
      for (const [m, v] of versions) this.saved.set(m, v);
      this.saved.forEach((_v, m) => {
        if (m < cut) this.saved.delete(m);
      });
    } catch {
      // Brak miejsca albo zablokowana baza — taśma działa dalej w pamięci, spróbujemy przy następnym zapisie
    }
  }
}

/** Suma dwóch zapisów tej samej minuty, rosnąco po czasie, bez duplikatów (ten sam czas i tid). */
export function mergeMinute(a: StoredMinute, b: StoredMinute): StoredMinute {
  const n = a.t.length + b.t.length;
  const out = { t: new Float64Array(n), px: new Float64Array(n), sz: new Float64Array(n), side: new Int8Array(n), tid: new Float64Array(n) };
  let i = 0;
  let j = 0;
  let k = 0;
  const take = (src: StoredMinute, at: number): void => {
    // Duplikat: ten sam tid w tej samej milisekundzie już przepisany
    for (let q = k - 1; q >= 0 && out.t[q] === src.t[at]; q--) if (out.tid[q] === src.tid[at]) return;
    out.t[k] = src.t[at];
    out.px[k] = src.px[at];
    out.sz[k] = src.sz[at];
    out.side[k] = src.side[at];
    out.tid[k] = src.tid[at];
    k++;
  };
  while (i < a.t.length || j < b.t.length) {
    if (j >= b.t.length || (i < a.t.length && a.t[i] <= b.t[j])) take(a, i++);
    else take(b, j++);
  }
  return { minute: a.minute, t: out.t.slice(0, k), px: out.px.slice(0, k), sz: out.sz.slice(0, k), side: out.side.slice(0, k), tid: out.tid.slice(0, k) };
}

/** Scala odcinki nakładające się i stykające (rosnąco). */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// ───────────────────────── IndexedDB ─────────────────────────

const DB_NAME = 'hq-pro-tape-btc';
const MINUTES = 'minutes';
const META = 'meta';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Magazyn w IndexedDB; null, gdy przeglądarka go nie udostępnia (np. prywatne okno w części przeglądarek). */
export async function openTapeDb(): Promise<TapeKv | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(MINUTES, { keyPath: 'minute' });
      open.result.createObjectStore(META);
    };
    db = await req(open);
  } catch {
    return null;
  }
  return {
    async minutesSince(from) {
      const tx = db.transaction(MINUTES, 'readonly');
      return req(tx.objectStore(MINUTES).getAll(IDBKeyRange.lowerBound(Math.floor(from / 60_000) * 60_000))) as Promise<StoredMinute[]>;
    },
    async getMinutes(minutes) {
      const tx = db.transaction(MINUTES, 'readonly');
      const st = tx.objectStore(MINUTES);
      return Promise.all(minutes.map((m) => req(st.get(m)) as Promise<StoredMinute | undefined>));
    },
    async putMinutes(list) {
      const tx = db.transaction(MINUTES, 'readwrite');
      const st = tx.objectStore(MINUTES);
      for (const m of list) st.put(m);
      await done(tx);
    },
    async deleteBefore(minute) {
      const tx = db.transaction(MINUTES, 'readwrite');
      tx.objectStore(MINUTES).delete(IDBKeyRange.upperBound(minute, true));
      await done(tx);
    },
    async getSpans() {
      const tx = db.transaction(META, 'readonly');
      const v = await req(tx.objectStore(META).get('coverage'));
      return Array.isArray(v) ? (v as Span[]) : [];
    },
    async putSpans(spans) {
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put(spans, 'coverage');
      await done(tx);
    },
  };
}
