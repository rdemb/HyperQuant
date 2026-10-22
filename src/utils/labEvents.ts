/**
 * Generatory zdarzeń laboratorium folkloru (świece 1h / 1d Hyperliquid, czas UTC).
 *
 * Reguły barierowe: zdarzenie startuje na zamknięciu bara, który je wywołał (cena C), z dwiema barierami — sukces
 * (przewidywana przez folklor) i porażka. Pod hipotezą zerową „cena jest martyngałem” twierdzenie o opcjonalnym
 * zatrzymaniu daje dokładnie P(sukces) = p0 = |C − porażka| / |sukces − porażka|, bez założeń o rozkładzie.
 * Ścieżka z high/low kolejnych barów. Brak rozstrzygnięcia w limicie albo luka w danych → wynik ułamkowy
 * x = |C_T − porażka| / |sukces − porażka| z ostatniego zamknięcia: liniowy w cenie, więc pod H0 nadal E[x] = p0
 * dokładnie (zatrzymany martyngał) — odrzucanie takich zdarzeń faworyzowałoby bliższą barierę. Bar dotykający obu
 * barier → niejednoznaczne, odrzucone; żeby było rzadkie, każda reguła barierowa wymaga pasma ≥ 2 × mediana zakresu
 * 24 poprzednich godzin (warunek sprawdzany w chwili startu). Odrzucenie niejednoznacznych jest neutralne tylko przy
 * symetrii odbicia przyrostów (stąd reguła pasma, także dla reguł wyśrodkowanych). Koniec danych → zdarzenie otwarte
 * (bez wpisu, czeka). Zdarzenia jednej reguły nie nakładają się: kolejne szukane od bara po rozstrzygnięciu
 * poprzedniego (dotknięcia w trakcie otwartego zdarzenia nie są widoczne dla reguły).
 *
 * Reguły kalendarzowe (10:00 w Nowym Jorku, momentum śróddzienne, weekend) mają p0 = 0,5 z symetrii znaku albo
 * wymienialności — dokładnie pod hipotezą zerową.
 */

const H = 3_600_000;
const D = 24 * H;

export interface LabBar {
  /** Początek świecy (ms UTC) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface LabEvent {
  /** Start zdarzenia (chwila decyzji) */
  t0: number;
  /** Rozstrzygnięcie (koniec bara, w którym padła bariera / koniec okna) */
  t1: number;
  /** 1 = sukces, 0 = porażka, ułamek = wartość martyngału przy limicie czasu / luce w danych */
  x: number;
  p0: number;
}

export interface Dropped {
  /** Bar dotknął obu barier — zdarzenie odrzucone */
  ambiguous: number;
  /** Start pominięty: pasmo węższe niż 2 × mediana zakresu godzin (niejednoznaczność byłaby częsta) */
  narrow: number;
  /** Zdarzenia z wynikiem ułamkowym (limit czasu / luka w danych) — liczone, nie odrzucane */
  timeout: number;
  gap: number;
}

export interface GenResult {
  events: LabEvent[];
  dropped: Dropped;
}

const newResult = (): GenResult => ({ events: [], dropped: { ambiguous: 0, narrow: 0, timeout: 0, gap: 0 } });

/**
 * Minimalna szerokość pasma barier w medianach zakresu godziny (wszystkie reguły barierowe). Przy 2× w symulacji
 * martyngału brak obciążenia, na danych BTC 2026 niejednoznaczne ≤ 1,4% zdarzeń.
 */
export const MIN_BAND_RANGES = 2;

type Pass =
  | { kind: 'hit'; success: boolean; j: number }
  | { kind: 'ambiguous'; j: number }
  /** Limit czasu albo luka: zatrzymanie na zamknięciu bara `stop`, dalsze szukanie po `j` */
  | { kind: 'timeout' | 'gap'; stop: number; j: number }
  | { kind: 'open' };

/** Pierwsze dotknięcie bariery w barach po `i` (najwyżej `maxBars`). */
function firstPassage(bars: readonly LabBar[], i: number, succ: number, fail: number, maxBars: number): Pass {
  const up = succ > fail;
  for (let j = i + 1; j <= i + maxBars; j++) {
    if (j >= bars.length) return { kind: 'open' };
    if (bars[j].t !== bars[j - 1].t + H) return { kind: 'gap', stop: j - 1, j: j - 1 };
    const hitS = up ? bars[j].h >= succ : bars[j].l <= succ;
    const hitF = up ? bars[j].l <= fail : bars[j].h >= fail;
    if (hitS && hitF) return { kind: 'ambiguous', j };
    if (hitS) return { kind: 'hit', success: true, j };
    if (hitF) return { kind: 'hit', success: false, j };
  }
  return { kind: 'timeout', stop: i + maxBars, j: i + maxBars };
}

/** Zapis wyniku przejścia: sukces / porażka / ułamek (limit, luka) / odrzucenie; zwraca indeks ostatniego bara albo -1 (otwarte). */
function record(bars: readonly LabBar[], res: GenResult, t0: number, p: Pass, succ: number, fail: number, p0: number): number {
  if (p.kind === 'open') return -1;
  if (p.kind === 'ambiguous') {
    res.dropped.ambiguous++;
    return p.j;
  }
  if (p.kind === 'hit') {
    res.events.push({ t0, t1: bars[p.j].t + H, x: p.success ? 1 : 0, p0 });
    return p.j;
  }
  res.dropped[p.kind]++;
  const q = Math.min(1, Math.max(0, (bars[p.stop].c - fail) / (succ - fail)));
  res.events.push({ t0, t1: bars[p.stop].t + H, x: q, p0 });
  return p.j;
}

/** Mediana zakresu (high − low) do 24 poprzednich barów — skala niejednoznaczności; NaN = za mało danych. */
function medianRange(bars: readonly LabBar[], i: number): number {
  const r: number[] = [];
  for (let j = Math.max(0, i - 24); j < i; j++) r.push(bars[j].h - bars[j].l);
  if (r.length < 12) return Number.NaN;
  r.sort((x, y) => x - y);
  return r[Math.floor(r.length / 2)];
}

/**
 * Wspólna pętla reguł barierowych z p0 ≠ 0,5: `trigger(i)` → bariery zdarzenia startującego na zamknięciu bara i albo
 * null. Start pomijany, gdy cena już jest poza pasmem albo pasmo jest za wąskie względem zakresu godzin.
 */
function barrierLoop(bars: readonly LabBar[], res: GenResult, trigger: (i: number) => { succ: number; fail: number; maxBars: number } | null): void {
  for (let i = 0; i < bars.length; i++) {
    const tr = trigger(i);
    if (!tr) continue;
    const C = bars[i].c;
    const lo = Math.min(tr.succ, tr.fail);
    const hi = Math.max(tr.succ, tr.fail);
    if (!(C > lo && C < hi)) continue; // bar już przeszedł barierę — rozstrzygnięte wewnątrz bara, pomijane
    if (!(hi - lo >= MIN_BAND_RANGES * medianRange(bars, i))) {
      res.dropped.narrow++;
      continue;
    }
    const p0 = Math.abs(C - tr.fail) / Math.abs(tr.succ - tr.fail);
    const end = record(bars, res, bars[i].t + H, firstPassage(bars, i, tr.succ, tr.fail, tr.maxBars), tr.succ, tr.fail, p0);
    if (end < 0) return;
    i = end; // następne zdarzenie dopiero po rozstrzygnięciu (pętla przesuwa na end + 1)
  }
}

const contiguous = (bars: readonly LabBar[], i: number) => i > 0 && bars[i].t === bars[i - 1].t + H;

/** Poziomy `offset + step·k`: opór (przebicie od dołu, sukces w dół), wsparcie (od góry, sukces w górę) albo oba. */
export function levelEvents(
  bars: readonly LabBar[],
  o: { step: number; offset: number; dir: 'res' | 'sup' | 'both'; dPct: number; maxBars: number }
): GenResult {
  const res = newResult();
  barrierLoop(bars, res, (i) => {
    if (!contiguous(bars, i)) return null;
    const pc = bars[i - 1].c;
    const b = bars[i];
    const up = o.offset + o.step * (Math.floor((pc - o.offset) / o.step) + 1);
    const dn = o.offset + o.step * (Math.ceil((pc - o.offset) / o.step) - 1);
    const res_ = o.dir !== 'sup' && b.h >= up;
    const sup = o.dir !== 'res' && b.l <= dn;
    if (res_ === sup) return null; // brak dotknięcia albo oba kierunki w jednym barze
    const L = res_ ? up : dn;
    const d = o.dPct * L;
    return res_ ? { succ: L - d, fail: L + d, maxBars: o.maxBars } : { succ: L + d, fail: L - d, maxBars: o.maxBars };
  });
  return res;
}

/** Indeksy barów pełnych dni UTC (24 kolejne bary od północy): dzień → indeks pierwszego bara. */
function fullDays(bars: readonly LabBar[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i + 23 < bars.length; i++) {
    if (bars[i].t % D !== 0) continue;
    if (bars[i + 23].t === bars[i].t + 23 * H) out.set(bars[i].t, i);
  }
  return out;
}

/**
 * Zebranie maksimum (pdh) / minimum (pdl) poprzedniego dnia UTC: pierwsze dotknięcie w danym dniu; bariery środek
 * zakresu poprzedniego dnia (sukces — powrót) i lustro po drugiej stronie poziomu.
 */
export function prevDayEvents(bars: readonly LabBar[], side: 'pdh' | 'pdl', maxBars: number): GenResult {
  const res = newResult();
  const days = fullDays(bars);
  const levels = new Map<number, { lvl: number; mid: number }>();
  for (const [day, k] of days) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = k; j < k + 24; j++) {
      hi = Math.max(hi, bars[j].h);
      lo = Math.min(lo, bars[j].l);
    }
    levels.set(day + D, { lvl: side === 'pdh' ? hi : lo, mid: (hi + lo) / 2 });
  }
  const touched = new Set<number>();
  barrierLoop(bars, res, (i) => {
    const day = Math.floor(bars[i].t / D) * D;
    const L = levels.get(day);
    if (!L || touched.has(day)) return null;
    const hit = side === 'pdh' ? bars[i].h >= L.lvl : bars[i].l <= L.lvl;
    if (!hit) return null;
    touched.add(day); // tylko pierwsze dotknięcie w dniu
    return { succ: L.mid, fail: 2 * L.lvl - L.mid, maxBars };
  });
  return res;
}

/**
 * Wybicie Initial Balance (bar 00:00–01:00 UTC): pierwsze wyjście poza IB w tym samym dniu; sukces = krawędź ± zakres IB
 * w stronę wybicia, porażka = przeciwna krawędź IB.
 */
export function ibBreakEvents(bars: readonly LabBar[], maxBars: number): GenResult {
  const res = newResult();
  const done = new Set<number>();
  barrierLoop(bars, res, (i) => {
    const day = Math.floor(bars[i].t / D) * D;
    if (done.has(day) || bars[i].t === day) return null;
    // Bar IB i ciągłość od niego do bieżącego
    const k = i - Math.round((bars[i].t - day) / H);
    if (k < 0 || bars[k].t !== day || bars[i].t - bars[k].t !== (i - k) * H) return null;
    const ibh = bars[k].h;
    const ibl = bars[k].l;
    const R = ibh - ibl;
    if (!(R > 0)) return null;
    // Pierwsze wyjście: wcześniejsze bary dnia w środku IB
    for (let j = k + 1; j < i; j++) if (bars[j].h > ibh || bars[j].l < ibl) return null;
    const up = bars[i].h > ibh;
    const dn = bars[i].l < ibl;
    if (!up && !dn) return null;
    done.add(day);
    if (up && dn) return null;
    return up ? { succ: ibh + R, fail: ibl, maxBars } : { succ: ibl - R, fail: ibh, maxBars };
  });
  return res;
}

/**
 * Powrót do VWAP: zamknięcie godziny poza VWAP ± 2σ sesji UTC (od 4. godziny; cena typowa ważona wolumenem, σ —
 * odchylenie ważone); sukces = dotknięcie VWAP, porażka = VWAP ± 4σ (zamrożone w chwili startu).
 */
export function vwapEvents(bars: readonly LabBar[], maxBars: number): GenResult {
  const res = newResult();
  // VWAP i σ narastająco w dniu (null = przerwa w danych w tym dniu)
  const stats: ({ vwap: number; sd: number; hour: number } | null)[] = [];
  let day = -1;
  let sv = 0;
  let spv = 0;
  let sp2v = 0;
  let broken = false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = Math.floor(b.t / D) * D;
    if (d !== day) {
      day = d;
      sv = spv = sp2v = 0;
      broken = b.t !== d;
    } else if (!contiguous(bars, i)) broken = true;
    const tp = (b.h + b.l + b.c) / 3;
    sv += b.v;
    spv += b.v * tp;
    sp2v += b.v * tp * tp;
    if (broken || !(sv > 0)) {
      stats.push(null);
      continue;
    }
    const vwap = spv / sv;
    stats.push({ vwap, sd: Math.sqrt(Math.max(0, sp2v / sv - vwap * vwap)), hour: Math.round((b.t - d) / H) });
  }
  barrierLoop(bars, res, (i) => {
    const s = stats[i];
    if (!s || s.hour < 3 || !(s.sd > 0)) return null;
    const c = bars[i].c;
    if (c > s.vwap + 2 * s.sd) return { succ: s.vwap, fail: s.vwap + 4 * s.sd, maxBars };
    if (c < s.vwap - 2 * s.sd) return { succ: s.vwap, fail: s.vwap - 4 * s.sd, maxBars };
    return null;
  });
  return res;
}

/** Czas letni w USA: od 2. niedzieli marca do 1. niedzieli listopada (zmiana o 2:00 czasu lokalnego). */
function usDst(y: number, m: number, d: number, hh: number): boolean {
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const start = nthSunday(3, 2);
  const end = nthSunday(11, 1);
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  if (m === 3) return d > start || (d === start && hh >= 2);
  return d < end || (d === end && hh < 2);
}

/** Pełna godzina czasu lokalnego (standard UTC−6 Chicago / UTC−5 Nowy Jork) → ms UTC. */
const localToUtc = (std: number) => (y: number, m: number, d: number, hh: number) => Date.UTC(y, m - 1, d, hh) + (std - (usDst(y, m, d, hh) ? 1 : 0)) * H;
export const chicagoToUtc = localToUtc(6);
export const newYorkToUtc = localToUtc(5);

/**
 * Luka CME (wyśrodkowana: p0 = 0,5; czasy nominalne kontraktów BTC — zamknięcie w piątek 16:00, otwarcie w niedzielę
 * 17:00 czasu Chicago, bez kalendarza świąt CME):
 * poziom luki G = zamknięcie HL na zamknięciu CME, start C = zamknięcie HL na otwarciu CME; |C − G| ≥ minGap·G.
 * Sukces = dotknięcie G, porażka = lustro 2C − G (p0 = 0,5); limit — piątkowe zamknięcie CME następnego tygodnia.
 */
export function cmeGapEvents(bars: readonly LabBar[], minGap: number): GenResult {
  const res = newResult();
  if (bars.length === 0) return res;
  const idx = new Map<number, number>(bars.map((b, i) => [b.t, i]));
  let resumeAt = -1;
  const first = new Date(Math.floor(bars[0].t / D) * D);
  const last = bars[bars.length - 1].t;
  for (let day = first.getTime(); day <= last; day += D) {
    const dt = new Date(day);
    if (dt.getUTCDay() !== 5) continue;
    const [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
    const close = chicagoToUtc(y, m, d, 16);
    const sun = new Date(day + 2 * D);
    const open = chicagoToUtc(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate(), 17);
    const nf = new Date(day + 7 * D);
    const nextClose = chicagoToUtc(nf.getUTCFullYear(), nf.getUTCMonth() + 1, nf.getUTCDate(), 16);
    const ig = idx.get(close - H);
    const ic = idx.get(open - H);
    if (ig === undefined || ic === undefined || ic <= resumeAt) continue;
    const G = bars[ig].c;
    const C = bars[ic].c;
    if (!(Math.abs(C - G) >= minGap * G)) continue;
    if (!(2 * Math.abs(C - G) >= MIN_BAND_RANGES * medianRange(bars, ic))) {
      res.dropped.narrow++;
      continue;
    }
    const end = record(bars, res, open, firstPassage(bars, ic, G, 2 * C - G, Math.round((nextClose - open) / H)), G, 2 * C - G, 0.5);
    if (end < 0) break;
    resumeAt = end;
  }
  return res;
}

/** Kwantyl empiryczny (interpolacja liniowa) posortowanej tablicy. */
function quantileSorted(s: readonly number[], q: number): number {
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Skrajne finansowanie: stawka w chwili t powyżej kwantyla 1 − pct z poprzednich `windowDays` dni i dodatnia (tłum
 * długich) → sukces = spadek o dPct przed wzrostem o dPct; lustrzanie dla ujemnej poniżej kwantyla pct. Start na
 * zamknięciu bara kończącego się w t; p0 = 0,5.
 */
export function fundingEvents(
  bars: readonly LabBar[],
  funding: readonly { t: number; rate: number }[],
  o: { pct: number; windowDays: number; dPct: number; maxBars: number }
): GenResult {
  const res = newResult();
  const f = [...funding].map((x) => ({ t: Math.floor(x.t / H) * H, rate: x.rate })).filter((x) => Number.isFinite(x.rate)).sort((a, b) => a.t - b.t);
  const idx = new Map<number, number>(bars.map((b, i) => [b.t, i]));
  const need = Math.floor(0.9 * o.windowDays * 24);
  let resumeAt = -1;
  let from = 0;
  // Okno [t − windowDays, t) utrzymywane posortowane przyrostowo (wyszukiwanie binarne) zamiast sortowania co godzinę
  const win: number[] = [];
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = win.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (win[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (let k = 0; k < f.length; k++) {
    const t = f[k].t;
    if (k > 0) win.splice(lowerBound(f[k - 1].rate), 0, f[k - 1].rate);
    while (from < k && f[from].t < t - o.windowDays * D) {
      win.splice(lowerBound(f[from].rate), 1);
      from++;
    }
    if (k - from < need) continue;
    const i = idx.get(t - H);
    if (i === undefined || i <= resumeAt) continue;
    const r = f[k].rate;
    let succUp: boolean | null = null;
    if (r > 0 && r > quantileSorted(win, 1 - o.pct)) succUp = false;
    else if (r < 0 && r < quantileSorted(win, o.pct)) succUp = true;
    if (succUp === null) continue;
    const C = bars[i].c;
    if (!(2 * o.dPct * C >= MIN_BAND_RANGES * medianRange(bars, i))) {
      res.dropped.narrow++;
      continue;
    }
    const up = C * (1 + o.dPct);
    const dn = C * (1 - o.dPct);
    const succ = succUp ? up : dn;
    const fail = succUp ? dn : up;
    const end = record(bars, res, t, firstPassage(bars, i, succ, fail, o.maxBars), succ, fail, 0.5);
    if (end < 0) break;
    resumeAt = end;
  }
  return res;
}

/** Zwroty logarytmiczne 24 godzin pełnego dnia UTC (z zamknięciem poprzedniego bara); null = brak danych. */
function dayReturns(bars: readonly LabBar[], k: number): number[] | null {
  if (k < 1 || bars[k].t !== bars[k - 1].t + H) return null;
  const out: number[] = [];
  for (let j = k; j < k + 24; j++) out.push(Math.log(bars[j].c / bars[j - 1].c));
  return out.every(Number.isFinite) ? out : null;
}

/**
 * „Dump o 10:00 w Nowym Jorku”: w dni robocze USA zwrot godziny 10:00–11:00 czasu NY w dolnej połowie 24 zwrotów
 * godzinowych dnia UTC. p0 = 0,5 z symetrii znaku (ranga nie zależy od trendu dnia).
 */
export function nyTenAmEvents(bars: readonly LabBar[]): GenResult {
  const res = newResult();
  for (const [day, k] of [...fullDays(bars)].sort((a, b) => a[0] - b[0])) {
    const dt = new Date(day);
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const r = dayReturns(bars, k);
    if (!r) continue;
    const h10 = Math.round((newYorkToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 10) - day) / H);
    const x = r[h10];
    const rank = 1 + r.filter((v) => v < x).length;
    res.events.push({ t0: day, t1: day + D, x: rank <= 12 ? 1 : 0, p0: 0.5 });
  }
  return res;
}

/** Momentum śróddzienne (Gao i in. 2018): znak ostatniej godziny dnia UTC = znak pierwszej. p0 = 0,5. */
export function intradayMomEvents(bars: readonly LabBar[]): GenResult {
  const res = newResult();
  for (const [day, k] of [...fullDays(bars)].sort((a, b) => a[0] - b[0])) {
    const r = dayReturns(bars, k);
    if (!r || r[0] === 0 || r[23] === 0) continue;
    res.events.push({ t0: day, t1: day + D, x: Math.sign(r[0]) === Math.sign(r[23]) ? 1 : 0, p0: 0.5 });
  }
  return res;
}

/**
 * Kontrola pozytywna (świece dzienne): tydzień pon–nd UTC; sukces = log-zakres soboty + niedzieli mniejszy niż środy
 * + czwartku. p0 = 0,5 z wymienialności dni pod H0.
 */
export function weekendEvents(daily: readonly LabBar[]): GenResult {
  const res = newResult();
  const byDay = new Map<number, LabBar>(daily.map((b) => [b.t, b]));
  for (const b of daily) {
    if (b.t % D !== 0 || new Date(b.t).getUTCDay() !== 1) continue;
    const week = Array.from({ length: 7 }, (_, i) => byDay.get(b.t + i * D));
    if (week.some((x) => !x || !(x.h > 0 && x.l > 0))) continue;
    const lr = week.map((x) => Math.log(x!.h / x!.l));
    res.events.push({ t0: b.t, t1: b.t + 7 * D, x: lr[5] + lr[6] < lr[2] + lr[3] ? 1 : 0, p0: 0.5 });
  }
  return res;
}
