import type { Lang } from '../i18n.ts';

/**
 * Reguły alarmów cenowych wspólne dla strony i serwera powiadomień (bez importów wykonywalnych; uruchamiane także
 * natywnie przez Node 24). Silnik dostaje transakcje rynku po kolei i sprawdza warunki tak, jak trader zapisuje plan
 * sesji: dotknięcie poziomu, zamknięcie świecy za poziomem (także kilka z rzędu), wybicie i powrót, z filtrem delty,
 * oknem czasu, wygaśnięciem i parą scenariuszy, oraz wyciskanie (gwałtowny ruch przy spadku otwartych pozycji).
 * Zamknięcie świecy to ostatnia transakcja przed jej końcem — tak samo liczy je Hyperliquid. Przy uruchomieniu alarm niesie fakty ze świecy (delta, wolumen, OI, największe zlecenia),
 * policzone z tej samej taśmy. Opis faktów, nie sygnał.
 */

export type AlertKind = 'touch' | 'close' | 'reclaim' | 'squeeze';

export const ALERT_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h'] as const;
/** Rynki z alarmami (perpy Hyperliquid z widoku Wykresy). */
export const ALERT_MARKETS = ['BTC', 'ETH', 'SOL', 'HYPE'] as const;
const MIN = 60_000;
const IV_MS: Record<string, number> = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': 60 * MIN, '4h': 240 * MIN };
export const ivMs = (iv: string): number => IV_MS[iv] ?? 15 * MIN;

/** Najwięcej zamknięć z rzędu w warunku. */
export const MAX_CLOSES = 3;
/** Alarm bez wybranego końca wygasa po tygodniu. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * MIN;
/** Najdłuższy własny opis alarmu. */
export const NOTE_MAX = 60;
/** Tyle poprzednich świec daje średni wolumen do porównania. */
const VOL_BARS = 20;
/** Wyciskanie: okno ruchu ceny i zmiany otwartych pozycji. */
export const SQUEEZE_MS = 10 * MIN;
/** Wyciskanie: tyle co najmniej % otwartych pozycji ubywa w oknie (pozycje zamykane, a nie otwierane). */
export const SQUEEZE_OI_PCT = 0.3;

export interface AlertRule {
  id: string;
  coin: string;
  /** Poziom ceny; przy wyciskaniu próg ruchu ceny w % w oknie `SQUEEZE_MS`. */
  price: number;
  kind: AlertKind;
  /**
   * Dotknięcie: 1 = cena ma wzrosnąć do poziomu, −1 = spaść do niego. Zamknięcie: 1 = nad poziomem, −1 = pod nim.
   * Powrót: 1 = po zejściu pod poziom zamknięcie z powrotem nad nim, −1 = po wyjściu nad poziom zamknięcie pod nim.
   * Wyciskanie: 1 = wzrost (zamykane shorty), −1 = spadek (zamykane longi).
   */
  dir: 1 | -1;
  /** Interwał świecy warunku (zamknięcie i powrót). */
  iv: string;
  /** Tyle zamknięć z rzędu za poziomem (zamknięcie) albo z powrotem (powrót) uruchamia alarm. */
  closes: number;
  /** Świeca, która spełnia warunek, musi mieć deltę agresorów w kierunku `dir`. */
  delta: boolean;
  /** Okno czasu [from, until) w zegarze giełdy (ms): poza nim alarm milczy, po `until` wygasa. */
  from: number;
  until: number;
  /** Para scenariuszy: pierwszy uruchomiony alarm kasuje pozostałe z tym samym znacznikiem ('' = bez pary). */
  pair: string;
  /** Własny opis (np. scenariusz z planu), na początku komunikatu; '' = bez opisu. */
  note: string;
  /** Łańcuch: alarm czeka, aż uruchomi się alarm o tym id (np. unieważnienie po wybiciu); '' = aktywny od razu. */
  after: string;
  /** Chwila ustawienia (zegar giełdy): liczą się transakcje i świece zamknięte od niej. */
  created: number;
  /** Powrót: cena była już po drugiej stronie poziomu. */
  armed: boolean;
  /** Kolejne zamknięcia za poziomem (albo z powrotem) do tej chwili. */
  streak: number;
}

/** Transakcja w zegarze giełdy: strona agresora 1 = kupno, −1 = sprzedaż; `key` łączy wypełnienia jednego zlecenia. */
export interface AlertTrade {
  time: number;
  px: number;
  sz: number;
  side: 1 | -1;
  key: string;
}

/** Fakty świecy z chwili alarmu (przy dotknięciu: bieżąca minuta). */
export interface AlertFacts {
  iv: string;
  /** Delta agresorów i wolumen w jednostkach rynku. */
  delta: number;
  vol: number;
  /** Wolumen świecy wobec średniej z poprzednich świec (NaN bez historii albo przy dotknięciu). */
  volX: number;
  /** Zmiana otwartych pozycji od początku świecy, % (NaN bez danych). */
  oiPct: number;
  /** Największe zlecenie agresora po każdej stronie, USD. */
  maxBuy: number;
  maxSell: number;
  /** Świeca widziana od środka (strona otwarta albo połączenie wróciło w trakcie). */
  partial: boolean;
  /** Fakty z bieżącej minuty przy dotknięciu (świeca jeszcze trwa). */
  touch: boolean;
  /** Wyciskanie: cena i chwila początku ruchu, zmiana otwartych pozycji w oknie (%). */
  move?: { from: number; at: number; oiPct: number };
}

export interface AlertEvent {
  type: 'fire' | 'expire' | 'cancel';
  rule: AlertRule;
  /** Chwila zdarzenia: transakcja albo koniec świecy (zegar giełdy). */
  at: number;
  /** Cena transakcji albo zamknięcia świecy (przy wygaśnięciu i anulowaniu: ostatnia cena). */
  px: number;
  facts: AlertFacts | null;
}

interface Bar {
  start: number;
  delta: number;
  vol: number;
  buys: Map<string, number>;
  sells: Map<string, number>;
  oi0: number;
  partial: boolean;
}

/** Sekunda taśmy do wyciskania: skrajne ceny i otwarte pozycje na jej początku. */
interface Tick {
  t: number;
  hi: number;
  lo: number;
  oi: number;
}

interface CoinState {
  px: number;
  t: number;
  oi: number;
  bars: Map<string, Bar>;
  vols: Map<string, number[]>;
  /** Ostatnie `SQUEEZE_MS` taśmy po sekundzie (tylko przy alarmie wyciskania). */
  ticks: Tick[];
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Alarmy z zapisu przeglądarki albo z sieci: uszkodzone wpisy odpadają, brakujące pola dostają wartości domyślne
 * (alarmy z poprzedniej wersji strony to samo dotknięcie). `now` — chwila ustawienia alarmu bez zapisanej.
 */
export function parseRules(raw: unknown, now: number): AlertRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AlertRule[] = [];
  for (const v of raw) {
    const a = v as Partial<AlertRule> | null;
    if (!a || typeof a.id !== 'string' || typeof a.coin !== 'string' || !(typeof a.price === 'number' && a.price > 0 && a.price < 1e9)) continue;
    if (a.dir !== 1 && a.dir !== -1) continue;
    const created = num(a.created, 0) || now;
    out.push({
      id: a.id.slice(0, 40),
      coin: a.coin,
      price: a.price,
      kind: a.kind === 'close' || a.kind === 'reclaim' || a.kind === 'squeeze' ? a.kind : 'touch',
      dir: a.dir,
      iv: (ALERT_INTERVALS as readonly string[]).includes(a.iv ?? '') ? (a.iv as string) : '15m',
      closes: Math.min(MAX_CLOSES, Math.max(1, Math.round(num(a.closes, 1)))),
      delta: a.delta === true,
      from: num(a.from, 0),
      until: num(a.until, 0) > 0 ? (a.until as number) : created + DEFAULT_TTL_MS,
      pair: typeof a.pair === 'string' ? a.pair.slice(0, 40) : '',
      note: typeof a.note === 'string' ? a.note.slice(0, NOTE_MAX) : '',
      after: typeof a.after === 'string' ? a.after.slice(0, 40) : '',
      created,
      armed: a.armed === true,
      streak: Math.max(0, Math.round(num(a.streak, 0))),
    });
  }
  return out;
}

/** Kierunek domyślny z położenia poziomu względem ceny: dotknięcie i zamknięcie po tej stronie, powrót po przeciwnej. */
export function defaultDir(kind: AlertKind, price: number, current: number): 1 | -1 {
  const side: 1 | -1 = price >= current ? 1 : -1;
  return kind === 'reclaim' ? (side === 1 ? -1 : 1) : side;
}

const beyond = (r: AlertRule, px: number): boolean => (r.dir === 1 ? px > r.price : px < r.price);
const inWindow = (r: AlertRule, t: number): boolean => t >= r.from && t < r.until;
const maxOf = (m: Map<string, number>): number => {
  let v = 0;
  for (const x of m.values()) if (x > v) v = x;
  return v;
};

/** Transakcja do sekund wyciskania; sekundy starsze niż okno odpadają. */
function tick(s: CoinState, tr: AlertTrade): void {
  const t = Math.floor(tr.time / 1000) * 1000;
  const last = s.ticks[s.ticks.length - 1];
  if (last && last.t === t) {
    last.hi = Math.max(last.hi, tr.px);
    last.lo = Math.min(last.lo, tr.px);
  } else s.ticks.push({ t, hi: tr.px, lo: tr.px, oi: s.oi });
  let k = 0;
  while (k < s.ticks.length && s.ticks[k].t <= tr.time - SQUEEZE_MS) k++;
  if (k > 0) s.ticks.splice(0, k);
}

/**
 * Wyciskanie: od skrajnej ceny okna (od ustawienia alarmu) cena przeszła próg `r.price` % w kierunku `dir`, a otwartych
 * pozycji od początku okna ubyło co najmniej `SQUEEZE_OI_PCT` %. Bez danych o pozycjach — nic.
 */
function squeezeMove(s: CoinState, r: AlertRule, px: number): { from: number; at: number; oiPct: number } | null {
  let first = -1;
  for (let k = 0; k < s.ticks.length; k++)
    if (s.ticks[k].t >= r.created - 999) {
      first = k;
      break;
    }
  if (first < 0) return null;
  // Pozycje z pierwszej sekundy, która je zna (kontekst rynku przychodzi osobno, czasem po pierwszych transakcjach)
  let base = Number.NaN;
  for (let k = first; k < s.ticks.length && !(base > 0); k++) base = s.ticks[k].oi;
  if (!(base > 0 && s.oi > 0)) return null;
  const oiPct = ((s.oi - base) / base) * 100;
  if (oiPct > -SQUEEZE_OI_PCT) return null;
  let ext = s.ticks[first];
  for (let k = first + 1; k < s.ticks.length; k++) {
    const x = s.ticks[k];
    if (r.dir === 1 ? x.lo < ext.lo : x.hi > ext.hi) ext = x;
  }
  const from = r.dir === 1 ? ext.lo : ext.hi;
  return ((px - from) / from) * 100 * r.dir >= r.price ? { from, at: ext.t, oiPct } : null;
}

/** Silnik alarmów: stan świec każdego rynku z alarmem, wspólny dla wszystkich alarmów tego rynku. */
export class AlertEngine {
  private readonly coins = new Map<string, CoinState>();

  private state(coin: string): CoinState {
    let s = this.coins.get(coin);
    if (!s) this.coins.set(coin, (s = { px: 0, t: 0, oi: Number.NaN, bars: new Map(), vols: new Map(), ticks: [] }));
    return s;
  }

  /** Przerwa w strumieniu: zamknięcie świecy z luki byłoby zgadywaniem, więc świece zaczynają się od nowa. */
  gap(coin: string): void {
    const s = this.state(coin);
    s.px = 0;
    s.t = 0;
    s.bars.clear();
    s.ticks = [];
  }

  /** Otwarte pozycje rynku (kontekst z WebSocket). */
  onOi(coin: string, oi: number): void {
    if (!(oi > 0)) return;
    const s = this.state(coin);
    s.oi = oi;
    for (const b of s.bars.values()) if (Number.isNaN(b.oi0)) b.oi0 = oi;
  }

  /** Wolumeny zamkniętych świec z API (zastępują historię, bo API jest pełniejsze niż taśma od otwarcia strony). */
  seedVolumes(coin: string, iv: string, candles: readonly { t: number; v: number }[], now: number): void {
    const ms = ivMs(iv);
    const v = candles.filter((c) => c.t + ms <= now && c.v >= 0).map((c) => c.v);
    this.state(coin).vols.set(iv, v.slice(-VOL_BARS));
  }

  /** Interwały, których świece są potrzebne: alarmów rynku i minuta do faktów przy dotknięciu. */
  intervals(rules: readonly AlertRule[], coin: string): string[] {
    const set = new Set<string>();
    for (const r of rules) if (r.coin === coin) set.add(r.kind === 'touch' || r.kind === 'squeeze' ? '1m' : r.iv);
    return [...set];
  }

  /**
   * Transakcje rynku (dowolna kolejność) przeciw alarmom. Zwraca zdarzenia i nową listę alarmów wszystkich rynków
   * (null, gdy nic się nie zmieniło) — uruchomione, wygasłe i anulowane znikają, stan powrotu i serii jest zapisany.
   */
  onTrades(rules: readonly AlertRule[], coin: string, trades: readonly AlertTrade[]): { rules: AlertRule[] | null; events: AlertEvent[] } {
    const events: AlertEvent[] = [];
    const s = this.state(coin);
    const work = rules.filter((r) => r.coin === coin).map((r) => ({ ...r }));
    const ivs = this.intervals(work, coin);
    for (const iv of [...s.bars.keys()]) if (!ivs.includes(iv)) s.bars.delete(iv);
    const done = new Set<string>();
    const sorted = trades.length > 1 ? [...trades].sort((a, b) => a.time - b.time) : trades;
    const squeeze = work.some((r) => r.kind === 'squeeze');
    if (!squeeze && s.ticks.length > 0) s.ticks = [];

    for (const tr of sorted) {
      // Starsze niż ostatnia przetworzona (migawka po ponownym połączeniu) — już policzone albo sprzed przerwy
      if (tr.time < s.t) continue;
      for (const iv of ivs) {
        const ms = ivMs(iv);
        let b = s.bars.get(iv);
        if (b && tr.time >= b.start + ms) {
          this.closeBar(s, iv, b, work, done, events);
          b = undefined;
        }
        if (!b) {
          const start = Math.floor(tr.time / ms) * ms;
          b = { start, delta: 0, vol: 0, buys: new Map(), sells: new Map(), oi0: s.oi, partial: !(s.t > 0 && s.t < start) };
          s.bars.set(iv, b);
        }
        b.delta += tr.side * tr.sz;
        b.vol += tr.sz;
        const book = tr.side === 1 ? b.buys : b.sells;
        book.set(tr.key, (book.get(tr.key) ?? 0) + tr.px * tr.sz);
      }
      if (squeeze) tick(s, tr);
      for (const r of work) {
        if (done.has(r.id) || r.after || tr.time < r.created) continue;
        if (tr.time >= r.until) {
          done.add(r.id);
          events.push({ type: 'expire', rule: r, at: r.until, px: tr.px, facts: null });
        } else if (r.kind === 'touch' && inWindow(r, tr.time) && (r.dir === 1 ? tr.px >= r.price : tr.px <= r.price)) {
          done.add(r.id);
          const m = s.bars.get('1m');
          events.push({ type: 'fire', rule: r, at: tr.time, px: tr.px, facts: m ? this.facts(s, '1m', m, true) : null });
        } else if (r.kind === 'reclaim' && !r.armed && (r.dir === 1 ? tr.px < r.price : tr.px > r.price)) r.armed = true;
        else if (r.kind === 'squeeze' && inWindow(r, tr.time)) {
          const move = squeezeMove(s, r, tr.px);
          if (!move) continue;
          done.add(r.id);
          const m = s.bars.get('1m');
          const facts = m ? { ...this.facts(s, '1m', m, true), oiPct: Number.NaN, move } : null;
          events.push({ type: 'fire', rule: r, at: tr.time, px: tr.px, facts });
        }
      }
      s.px = tr.px;
      s.t = tr.time;
    }

    // Para scenariuszy: uruchomiony alarm kasuje pozostałe ze swojej pary
    const pairs = new Set(events.filter((e) => e.type === 'fire' && e.rule.pair).map((e) => e.rule.pair));
    for (const r of work)
      if (!done.has(r.id) && pairs.has(r.pair)) {
        done.add(r.id);
        events.push({ type: 'cancel', rule: r, at: s.t, px: s.px, facts: null });
      }
    // Łańcuch: alarm po uruchomionym startuje od tej chwili, po wygasłym albo anulowanym — znika razem z nim
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      for (const r of work) {
        if (r.after !== e.rule.id || done.has(r.id)) continue;
        if (e.type === 'fire') {
          r.after = '';
          r.created = e.at;
          r.from = Math.max(r.from, e.at);
        } else {
          done.add(r.id);
          events.push({ type: 'cancel', rule: r, at: e.at, px: e.px, facts: null });
        }
      }
    }

    const byId = new Map(work.map((r) => [r.id, r]));
    const changed =
      done.size > 0 ||
      rules.some((r) => {
        const w = byId.get(r.id);
        return w !== undefined && (w.armed !== r.armed || w.streak !== r.streak || w.after !== r.after);
      });
    if (!changed) return { rules: null, events };
    const next: AlertRule[] = [];
    for (const r of rules) {
      if (done.has(r.id)) continue;
      const w = byId.get(r.id);
      next.push(w ? { ...r, armed: w.armed, streak: w.streak, after: w.after, created: w.created, from: w.from } : r);
    }
    return { rules: next, events };
  }

  /** Koniec świecy `iv`: zamknięcie = ostatnia transakcja przed jej końcem. */
  private closeBar(s: CoinState, iv: string, b: Bar, work: AlertRule[], done: Set<string>, events: AlertEvent[]): void {
    const ms = ivMs(iv);
    const end = b.start + ms;
    const close = s.px;
    let facts: AlertFacts | null = null;
    for (const r of work) {
      if (done.has(r.id) || r.after || r.kind === 'touch' || r.kind === 'squeeze' || r.iv !== iv || end <= r.created) continue;
      if (r.kind === 'reclaim' && !r.armed) continue;
      if (!beyond(r, close)) {
        r.streak = 0;
        continue;
      }
      r.streak++;
      if (r.streak < r.closes || !inWindow(r, end) || (r.delta && Math.sign(b.delta) !== r.dir)) continue;
      done.add(r.id);
      facts ??= this.facts(s, iv, b, false);
      events.push({ type: 'fire', rule: r, at: end, px: close, facts });
    }
    if (!b.partial) {
      const hist = s.vols.get(iv) ?? [];
      hist.push(b.vol);
      s.vols.set(iv, hist.slice(-VOL_BARS));
    }
  }

  private facts(s: CoinState, iv: string, b: Bar, touch: boolean): AlertFacts {
    const hist = s.vols.get(iv) ?? [];
    const avg = hist.length >= 5 ? hist.reduce((a, v) => a + v, 0) / hist.length : Number.NaN;
    return {
      iv,
      delta: b.delta,
      vol: b.vol,
      volX: touch || !(avg > 0) ? Number.NaN : b.vol / avg,
      oiPct: b.oi0 > 0 && s.oi > 0 ? ((s.oi - b.oi0) / b.oi0) * 100 : Number.NaN,
      maxBuy: maxOf(b.buys),
      maxSell: maxOf(b.sells),
      partial: b.partial,
      touch,
    };
  }
}

// ───────────────────────── opisy (PL/EN, ten sam tekst na stronie i w powiadomieniu z serwera) ─────────────────────────

const grouped = (s: string, lang: Lang): string => (lang === 'en' ? s : s.replace(/,/g, ' ').replace(/\./g, ','));
const fixed = (v: number, d: number, lang: Lang): string =>
  grouped(v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }), lang).replace(/^-/, '−');

/** Cena z dokładnością ticku Hyperliquid (5 cyfr znaczących: BTC bez miejsc po przecinku, ETH z jednym). */
export const fmtLevel = (p: number, lang: Lang): string => fixed(p, Math.max(0, 4 - Math.floor(Math.log10(Math.abs(p) || 1))), lang);

const signed = (v: number, d: number, lang: Lang): string => `${v > 0 ? '+' : ''}${fixed(v, d, lang)}`;
const sizeDigits = (v: number): number => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
const usd = (v: number, lang: Lang): string => {
  const unit = v >= 1e6 ? 1e6 : v >= 1e3 ? 1e3 : 1;
  const n = fixed(v / unit, unit === 1e6 ? 1 : 0, lang);
  if (lang === 'en') return `$${n}${unit === 1e6 ? 'M' : unit === 1e3 ? 'K' : ''}`;
  return `${n}${unit === 1e6 ? ' mln' : unit === 1e3 ? ' tys.' : ''} $`;
};

/** Warunek alarmu jednym zdaniem (lista, podgląd, opis linii). */
export function ruleText(r: Pick<AlertRule, 'kind' | 'dir' | 'price' | 'iv' | 'closes' | 'delta'>, lang: Lang): string {
  const L = fmtLevel(r.price, lang);
  const iv = r.iv;
  const en = lang === 'en';
  const up = r.dir === 1;
  let t: string;
  if (r.kind === 'touch') t = en ? `${up ? 'rise' : 'drop'} to ${L}` : `${up ? 'wzrost' : 'spadek'} do ${L}`;
  else if (r.kind === 'squeeze') {
    const p = fixed(r.price, 1, lang);
    const oi = fixed(SQUEEZE_OI_PCT, 1, lang);
    t = en
      ? `${up ? 'short' : 'long'} squeeze: ${up ? 'rise' : 'drop'} of ${p}% within 10 min, OI down at least ${oi}%`
      : `wyciskanie ${up ? 'shortów' : 'longów'}: ${up ? 'wzrost' : 'spadek'} o ${p}% w 10 min, OI w dół co najmniej ${oi}%`;
  } else if (r.kind === 'close') {
    const side = en ? (up ? 'above' : 'below') : up ? 'nad' : 'pod';
    t =
      r.closes > 1
        ? en ? `${r.closes} ${iv} candles in a row close ${side} ${L}` : `${r.closes} świece ${iv} z rzędu zamknięte ${side} ${L}`
        : en ? `${iv} candle closes ${side} ${L}` : `świeca ${iv} zamknięta ${side} ${L}`;
  } else {
    const back = r.closes > 1 ? (en ? `${r.closes} ${iv} closes` : `${r.closes} świece ${iv} zamknięte`) : en ? `a ${iv} close` : `świeca ${iv} zamknięta`;
    t = en
      ? `${up ? 'dip below' : 'move above'} ${L}, then ${back} back ${up ? 'above' : 'below'}`
      : `${up ? 'zejście pod' : 'wyjście nad'} ${L}, potem ${back} z powrotem ${up ? 'nad' : 'pod'}`;
  }
  if (r.delta && (r.kind === 'close' || r.kind === 'reclaim')) t += en ? ` · ${up ? 'positive' : 'negative'} delta` : ` · delta ${up ? 'dodatnia' : 'ujemna'}`;
  return t;
}

/** Co się stało (pierwsze zdanie komunikatu i powiadomienia). */
export function eventText(e: AlertEvent, lang: Lang): string {
  const r = e.rule;
  const en = lang === 'en';
  const L = fmtLevel(r.price, lang);
  const C = fmtLevel(e.px, lang);
  const iv = r.iv;
  // Alarm wyciskania nie ma poziomu ceny (pole `price` to próg w %)
  const name = r.kind === 'squeeze' ? (en ? `${r.coin} squeeze alert` : `Alarm wyciskania ${r.coin}`) : en ? `${r.coin} alert at ${L}` : `Alarm ${r.coin} ${L}`;
  if (e.type === 'expire') return en ? `${name} expired without triggering` : `${name} wygasł bez uruchomienia`;
  // Anulowany alarm z łańcucha wciąż czeka (`after`): alarm przed nim wygasł albo został anulowany
  if (e.type === 'cancel')
    return r.after
      ? en ? `${name} cancelled: the alert it was waiting for did not fire` : `${name} anulowany: alarm, na który czekał, nie zadziałał`
      : en ? `${name} cancelled: its paired alert fired` : `${name} anulowany: zadziałał alarm z pary`;
  if (r.kind === 'touch') return en ? `${r.coin} price reached ${L}` : `Cena ${r.coin} doszła do ${L}`;
  if (r.kind === 'squeeze') {
    const m = e.facts?.move;
    const what = en ? `${r.coin} ${r.dir === 1 ? 'short' : 'long'} squeeze` : `Wyciskanie ${r.dir === 1 ? 'shortów' : 'longów'} ${r.coin}`;
    if (!m) return `${what} (${C})`;
    const mins = Math.max(1, Math.round((e.at - m.at) / MIN));
    const pct = signed(((e.px - m.from) / m.from) * 100, 2, lang);
    return en
      ? `${what}: ${pct}% in ${mins} min (from ${fmtLevel(m.from, lang)} to ${C}), OI ${signed(m.oiPct, 1, lang)}%`
      : `${what}: ${pct}% w ${mins} min (z ${fmtLevel(m.from, lang)} do ${C}), OI ${signed(m.oiPct, 1, lang)}%`;
  }
  const side = en ? (r.dir === 1 ? 'above' : 'below') : r.dir === 1 ? 'nad' : 'pod';
  if (r.kind === 'close')
    return r.closes > 1
      ? en ? `${r.coin}: ${r.closes} ${iv} candles in a row closed ${side} ${L} (${C})` : `${r.coin}: ${r.closes}. świeca ${iv} z rzędu zamknięta ${side} ${L} (${C})`
      : en ? `${r.coin}: ${iv} candle closed ${side} ${L} (${C})` : `${r.coin}: świeca ${iv} zamknięta ${side} ${L} (${C})`;
  return en ? `${r.coin} back ${side} ${L}: ${iv} candle closed at ${C}` : `Cena ${r.coin} wróciła ${side} ${L}: świeca ${iv} zamknięta na ${C}`;
}

/** Fakty ze świecy alarmu jednym zdaniem. */
export function factsText(f: AlertFacts, coin: string, lang: Lang): string {
  const en = lang === 'en';
  const head = f.touch ? (en ? 'This minute' : 'W tej minucie') : en ? `${f.iv} candle` : `Świeca ${f.iv}`;
  const parts = [
    `delta ${signed(f.delta, sizeDigits(f.delta), lang)} ${coin}`,
    `${en ? 'volume' : 'wolumen'} ${fixed(f.vol, sizeDigits(f.vol), lang)} ${coin}${f.volX > 0 ? ` (${fixed(f.volX, 1, lang)}× ${en ? 'average' : 'średnia'})` : ''}`,
  ];
  if (Number.isFinite(f.oiPct)) parts.push(`OI ${signed(f.oiPct, 1, lang)}%`);
  if (f.maxBuy > 0 || f.maxSell > 0)
    parts.push(en ? `largest orders: buy ${usd(f.maxBuy, lang)}, sell ${usd(f.maxSell, lang)}` : `największe zlecenia: kupno ${usd(f.maxBuy, lang)}, sprzedaż ${usd(f.maxSell, lang)}`);
  return `${head}: ${parts.join(', ')}${f.partial ? (en ? ' (part of the candle)' : ' (część świecy)') : ''}.`;
}

/** Pełna treść komunikatu i powiadomienia: opis z planu, co się stało, fakty ze świecy (wygaśnięcie: jaki był warunek). */
export function eventBody(e: AlertEvent, lang: Lang): string {
  const head = `${e.rule.note ? `${e.rule.note} · ` : ''}${eventText(e, lang)}`;
  if (e.type === 'expire') return `${head}: ${ruleText(e.rule, lang)}.`;
  return e.facts ? `${head}. ${factsText(e.facts, e.rule.coin, lang)}` : `${head}.`;
}
