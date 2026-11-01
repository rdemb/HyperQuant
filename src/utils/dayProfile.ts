/**
 * Profil doby UTC z nagranej taśmy (bez importów zewnętrznych; uruchamiany także natywnie przez Node 24 w rejestratorze).
 *
 * Na każdym wierszu ceny (krok `tick`): agresywne kupno i sprzedaż oraz zmiana otwartych pozycji (OI) przypisana tej cenie.
 * OI jest minutowe, więc zmianę OI minuty dzielimy na wiersze w proporcji do wolumenu minuty na każdym z nich i zaliczamy
 * do jednej z czterech części według znaku zmiany OI i strony z przewagą agresji w tej minucie:
 * - `ob` OI rośnie przy przewadze kupna (umownie nowe longi), `os` OI rośnie przy przewadze sprzedaży (nowe shorty);
 * - `cb` OI spada przy przewadze kupna (zamykanie shortów), `cs` OI spada przy przewadze sprzedaży (zamykanie longów).
 * Umowne, bo w każdej transakcji są dwie strony: agresor wskazuje tylko, kto pchał cenę. OI Hyperliquid liczy pozycje
 * obu stron (zmiana w minucie sięga dwukrotności jej wolumenu), wartości są w jednostkach giełdy.
 *
 * Serwer zapisuje profil każdej zamkniętej doby w gałęzi historii (`<RYNEK>/<RRRR-MM-DD>/profile.json.gz`), strona
 * składa ten sam profil z taśmy w pamięci dla dób bez pliku (bieżąca, wczorajsza przed zapisem).
 */

export const DAY_PROFILE_VERSION = 1;
export const PROFILE_DAY_MS = 86_400_000;
const MIN = 60_000;
const MINUTES = PROFILE_DAY_MS / MIN;
/** Najwięcej wierszy w pliku (ochrona przed zepsutą ceną). */
const MAX_ROWS = 200_000;

/** Profil doby w pamięci: wiersz i obejmuje ceny [(lo + i) × tick, (lo + i + 1) × tick). */
export interface DayProfile {
  coin: string;
  /** Początek doby UTC. */
  day: number;
  tick: number;
  lo: number;
  buy: ArrayLike<number>;
  sell: ArrayLike<number>;
  ob: ArrayLike<number>;
  os: ArrayLike<number>;
  cb: ArrayLike<number>;
  cs: ArrayLike<number>;
  /** Wolumen taśmy w każdej minucie doby (1440). */
  mv: ArrayLike<number>;
  /** Wolumen taśmy w minutach z odczytem OI na obu końcach. */
  oiVol: number;
}

/** Plik profilu: kolumny wierszy od `lo` (zaokrąglone do 4 miejsc). */
export interface DayProfileFile {
  v: number;
  coin: string;
  day: number;
  tick: number;
  lo: number;
  buy: number[];
  sell: number[];
  ob: number[];
  os: number[];
  cb: number[];
  cs: number[];
  mv: number[];
  oiVol: number;
}

const pad = (x: number) => String(x).padStart(2, '0');

/** Ścieżka pliku w gałęzi historii: `BTC/2026-10-31/profile.json.gz`. */
export function dayProfilePath(coin: string, day: number): string {
  const d = new Date(day);
  return `${coin}/${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}/profile.json.gz`;
}

/** Krok wierszy pliku: ten sam co tick bazowy footprintu strony (hlTick ceny o 5% niższej, najwyżej 1). */
export function profileTick(px: number): number {
  return px > 0 ? Math.min(1, 10 ** (Math.floor(Math.log10(px * 0.95)) - 4)) : 1;
}

const COLS = 6;

/** Składanie profilu doby minuta po minucie (rosnąco albo w dowolnej kolejności — sumy są przemienne). */
export class DayProfileBuilder {
  /** Indeks wiersza → [kupno, sprzedaż, ob, os, cb, cs] */
  private readonly rows = new Map<number, Float64Array>();
  private readonly mv = new Float64Array(MINUTES);
  private oiVol = 0;

  readonly coin: string;
  readonly day: number;
  readonly tick: number;

  constructor(coin: string, day: number, tick: number) {
    this.coin = coin;
    this.day = day;
    this.tick = tick;
  }

  /**
   * Transakcje jednej minuty (strona > 0 = agresywne kupno) i zmiana OI w tej minucie; null bez odczytu OI na jej
   * początku albo końcu (wtedy tylko kupno i sprzedaż).
   */
  addMinute(minute: number, px: ArrayLike<number>, sz: ArrayLike<number>, side: ArrayLike<number>, dOi: number | null): void {
    const m = Math.floor((minute - this.day) / MIN);
    if (m < 0 || m >= MINUTES || px.length === 0) return;
    let vol = 0;
    let delta = 0;
    for (let i = 0; i < px.length; i++) {
      if (!(px[i] > 0) || !(sz[i] > 0)) continue;
      vol += sz[i];
      delta += side[i] > 0 ? sz[i] : -sz[i];
    }
    if (!(vol > 0)) return;
    this.mv[m] += vol;
    const d = dOi !== null && Number.isFinite(dOi) ? dOi : null;
    if (d !== null) this.oiVol += vol;
    // Część OI minuty: kolumny 2–5; przy równej agresji po połowie
    const k = d !== null ? Math.abs(d) / vol : 0;
    const a = d !== null && d > 0 ? 2 : 4;
    const wBuy = delta > 0 ? 1 : delta < 0 ? 0 : 0.5;
    for (let i = 0; i < px.length; i++) {
      if (!(px[i] > 0) || !(sz[i] > 0)) continue;
      const r = Math.floor(px[i] / this.tick + 1e-7);
      let row = this.rows.get(r);
      if (!row) this.rows.set(r, (row = new Float64Array(COLS)));
      row[side[i] > 0 ? 0 : 1] += sz[i];
      if (k > 0) {
        row[a] += k * sz[i] * wBuy;
        row[a + 1] += k * sz[i] * (1 - wBuy);
      }
    }
  }

  /** Profil z gęstymi kolumnami od najniższego do najwyższego wiersza; null bez transakcji. */
  build(): DayProfile | null {
    if (this.rows.size === 0) return null;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const r of this.rows.keys()) {
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    const n = hi - lo + 1;
    if (n > MAX_ROWS) return null;
    const cols = Array.from({ length: COLS }, () => new Float64Array(n));
    for (const [r, v] of this.rows) for (let c = 0; c < COLS; c++) cols[c][r - lo] = v[c];
    const [buy, sell, ob, os, cb, cs] = cols;
    return { coin: this.coin, day: this.day, tick: this.tick, lo, buy, sell, ob, os, cb, cs, mv: this.mv, oiVol: this.oiVol };
  }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const col = (xs: ArrayLike<number>) => Array.from(xs, r4);

export function encodeDayProfile(p: DayProfile): DayProfileFile {
  return {
    v: DAY_PROFILE_VERSION,
    coin: p.coin,
    day: p.day,
    tick: p.tick,
    lo: p.lo,
    buy: col(p.buy),
    sell: col(p.sell),
    ob: col(p.ob),
    os: col(p.os),
    cb: col(p.cb),
    cs: col(p.cs),
    mv: col(p.mv),
    oiVol: r4(p.oiVol),
  };
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nonNeg = (x: unknown, n: number): x is number[] => Array.isArray(x) && x.length === n && x.every((v) => fin(v) && v >= 0);

/** Odczyt pliku profilu; zły kształt albo wersja → null. */
export function decodeDayProfile(raw: unknown): DayProfile | null {
  const f = raw as Partial<DayProfileFile> | null;
  if (!f || f.v !== DAY_PROFILE_VERSION || typeof f.coin !== 'string' || !fin(f.day) || f.day % PROFILE_DAY_MS !== 0) return null;
  if (!fin(f.tick) || !(f.tick > 0) || !Number.isInteger(f.lo) || !fin(f.oiVol) || f.oiVol < 0) return null;
  const n = Array.isArray(f.buy) ? f.buy.length : -1;
  if (n <= 0 || n > MAX_ROWS) return null;
  for (const c of [f.buy, f.sell, f.ob, f.os, f.cb, f.cs]) if (!nonNeg(c, n)) return null;
  if (!nonNeg(f.mv, MINUTES)) return null;
  return { coin: f.coin, day: f.day, tick: f.tick, lo: f.lo as number, buy: f.buy!, sell: f.sell!, ob: f.ob!, os: f.os!, cb: f.cb!, cs: f.cs!, mv: f.mv, oiVol: f.oiVol };
}
