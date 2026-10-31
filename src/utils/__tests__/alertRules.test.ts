import { describe, expect, it } from 'vitest';
import {
  AlertEngine,
  type AlertEvent,
  type AlertRule,
  type AlertTrade,
  EVENT_TYPES,
  defaultDir,
  endsAlert,
  eventBody,
  eventText,
  eventTitle,
  factsText,
  fmtLevel,
  isZeroHash,
  knownKind,
  parseEvent,
  parseRules,
  ruleText,
  tradeKey,
} from '../alertRules';

const T0 = Date.UTC(2026, 9, 29, 7, 0); // 08:00 PL, początek świecy 15m
const M = 60_000;

const rule = (p: Partial<AlertRule>): AlertRule => ({
  id: 'a',
  coin: 'BTC',
  price: 64_670,
  kind: 'touch',
  dir: -1,
  iv: '15m',
  closes: 1,
  delta: false,
  from: 0,
  until: Number.MAX_SAFE_INTEGER,
  pair: '',
  note: '',
  after: '',
  created: T0,
  armed: false,
  streak: 0,
  ...p,
});

let tid = 0;
const tr = (time: number, px: number, sz = 1, side: 1 | -1 = 1, key = String(tid++)): AlertTrade => ({ time, px, sz, side, key });

/** Transakcje po jednej, jak z kolejnych wiadomości WebSocket; zwraca zdarzenia i końcową listę alarmów. */
function run(e: AlertEngine, rules: AlertRule[], trades: AlertTrade[]) {
  let list = rules;
  const events = [];
  for (const t of trades) {
    const r = e.onTrades(list, 'BTC', [t]);
    if (r.rules) list = r.rules;
    events.push(...r.events);
  }
  return { list, events };
}

describe('alarmy: dotknięcie', () => {
  it('knot między próbkami też uruchamia alarm (każda transakcja), cena i chwila z transakcji', () => {
    const e = new AlertEngine();
    const { list, events } = run(e, [rule({ dir: -1 })], [tr(T0 + 1000, 64_900), tr(T0 + 1200, 64_668), tr(T0 + 1400, 64_850)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fire', at: T0 + 1200, px: 64_668 });
    expect(list).toEqual([]);
  });

  it('transakcje sprzed ustawienia i spoza okna czasu nie liczą się', () => {
    const e = new AlertEngine();
    const r = rule({ dir: 1, price: 65_490, created: T0 + 5000, from: T0 + 60_000 });
    const { events } = run(e, [r], [tr(T0 + 1000, 65_500), tr(T0 + 30_000, 65_495), tr(T0 + 61_000, 65_491)]);
    expect(events.map((x) => x.at)).toEqual([T0 + 61_000]);
  });

  it('kierunek domyślny: dotknięcie i zamknięcie po stronie poziomu, powrót po przeciwnej', () => {
    expect(defaultDir('touch', 64_670, 64_880)).toBe(-1);
    expect(defaultDir('close', 65_490, 64_880)).toBe(1);
    expect(defaultDir('reclaim', 64_670, 64_880)).toBe(1);
    expect(defaultDir('reclaim', 65_490, 64_880)).toBe(-1);
  });
});

describe('alarmy: zamknięcie świecy', () => {
  it('świeca 15m zamknięta pod poziomem: zamknięcie = ostatnia transakcja przed końcem, alarm przy pierwszej po nim', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660 });
    const { events } = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 14 * M, 64_640), tr(T0 + 15 * M - 1, 64_642), tr(T0 + 15 * M + 500, 64_700)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fire', at: T0 + 15 * M, px: 64_642 });
  });

  it('knot pod poziomem bez zamknięcia pod nim nie uruchamia alarmu', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660 });
    const { events, list } = run(e, [r], [tr(T0 + M, 64_600), tr(T0 + 15 * M - 1, 64_700), tr(T0 + 15 * M + 1, 64_700)]);
    expect(events).toEqual([]);
    expect(list).toHaveLength(1);
  });

  it('świeca zamknięta przed ustawieniem alarmu się nie liczy, ta w trakcie — tak', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660, created: T0 + 15 * M + 10 });
    const { events } = run(e, [r], [tr(T0 + 14 * M, 64_600), tr(T0 + 15 * M + 1, 64_600), tr(T0 + 30 * M + 1, 64_610)]);
    expect(events.map((x) => x.at)).toEqual([T0 + 30 * M]);
  });

  it('dwa zamknięcia z rzędu: drugie uruchamia, zamknięcie z powrotem zeruje serię', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660, closes: 2 });
    const bars = [64_640, 64_700, 64_650, 64_630].map((px, i) => tr(T0 + i * 15 * M + 14 * M, px));
    const { events, list } = run(e, [r], [...bars.slice(0, 3), tr(T0 + 45 * M + 1, 64_640)]);
    expect(events).toEqual([]);
    expect(list[0].streak).toBe(1);
    const more = run(e, list, [bars[3], tr(T0 + 60 * M + 1, 64_620)]);
    expect(more.events).toHaveLength(1);
    expect(more.events[0]).toMatchObject({ at: T0 + 60 * M, px: 64_630 });
  });

  it('po przerwie w strumieniu nie zgadujemy zamknięcia świecy z luki', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660 });
    run(e, [r], [tr(T0 + 10 * M, 64_640)]);
    e.gap('BTC');
    const { events } = run(e, [r], [tr(T0 + 16 * M, 64_640), tr(T0 + 31 * M, 64_640)]);
    expect(events.map((x) => x.at)).toEqual([T0 + 30 * M]);
    expect(events[0].facts?.partial).toBe(true);
  });
});

describe('alarmy: luka w taśmie (serwer uzupełnia ją świecami 1m z API)', () => {
  const candle = (t: number, h: number, l: number, c = (h + l) / 2) => ({ t, h, l, c });
  /** Silnik serwera z luką w taśmie od transakcji `from` do pierwszej po przerwie `to` (obie po `px`). */
  function withHole(rules: AlertRule[], from: number, to: number, px = 64_700) {
    const e = new AlertEngine(true);
    let { list } = run(e, rules, [tr(from, px)]);
    e.gap('BTC');
    ({ list } = run(e, list, [tr(to, px)]));
    return { e, list };
  }

  it('dotknięcie w luce: alarm odpala raz ze świecy 1m, transakcje z migawki sprzed przerwy się nie liczą, po luce bez powtórki', () => {
    const e = new AlertEngine(true);
    const r = rule({ price: 64_670, dir: -1 });
    let res = run(e, [r], [tr(T0 + 2 * M + 5000, 64_700)]);
    expect(e.gap('BTC')).toBe(T0 + 2 * M + 5000);
    expect(e.hole('BTC')).toBeNull();
    // Migawka po powrocie połączenia: transakcja sprzed przerwy (i ta sama ostatnia) pominięta, luka do pierwszej nowej
    res = run(e, res.list, [tr(T0 + 2 * M + 1000, 64_700), tr(T0 + 2 * M + 5000, 64_700), tr(T0 + 5 * M + 10_000, 64_690)]);
    expect(e.hole('BTC')).toEqual({ from: T0 + 2 * M + 5000, to: T0 + 5 * M + 10_000 });
    const g = e.fillGap(res.list, 'BTC', T0 + 5 * M + 10_000, [candle(T0 + 2 * M, 64_710, 64_690), candle(T0 + 3 * M, 64_700, 64_660), candle(T0 + 4 * M, 64_680, 64_650)]);
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toMatchObject({ type: 'fire', at: T0 + 3 * M, px: 64_670, gap: true, facts: null });
    expect(g.rules).toEqual([]);
    expect(e.hole('BTC')).toBeNull();
    expect(run(e, g.rules!, [tr(T0 + 6 * M, 64_640)]).events).toEqual([]);
    expect(eventBody(g.events[0], 'pl')).toBe(`${eventText(g.events[0], 'pl')}. Dotknięcie w czasie przerwy w połączeniu z giełdą (świeca 1m).`);
    expect(eventBody(g.events[0], 'en')).toMatch(/Touched while the connection to the exchange was down/);
  });

  it('dotknięcie: liczy się tylko minuta w całości po ustawieniu alarmu i w jego oknie', () => {
    const set = rule({ id: 'set', created: T0 + 3 * M + 20_000 }); // ustawiony w środku minuty 3
    const win = rule({ id: 'win', from: T0, until: T0 + 3 * M + 30_000 }); // okno kończy się w środku minuty 3
    const { e, list } = withHole([set, win], T0 + 3 * M + 25_000, T0 + 3 * M + 29_000);
    const g = e.fillGap(list, 'BTC', T0 + 3 * M + 29_000, [candle(T0 + 3 * M, 64_700, 64_600)]);
    expect(g.events).toEqual([]);
    expect(g.rules).toBeNull();
  });

  it('para: dotknięcie z luki kasuje drugi alarm pary', () => {
    const up = rule({ id: 'up', price: 64_800, dir: 1, pair: 'p' });
    const down = rule({ id: 'down', price: 64_500, dir: -1, pair: 'p' });
    const { e, list } = withHole([up, down], T0 + 10_000, T0 + M + 50_000);
    const g = e.fillGap(list, 'BTC', T0 + M + 50_000, [candle(T0 + M, 64_810, 64_700)]);
    expect(g.events.map((x) => [x.type, x.rule.id])).toEqual([
      ['fire', 'up'],
      ['cancel', 'down'],
    ]);
  });

  it('przerwa na granicy świecy 5m: zamknięcie z luki dzwoni ze świec 1m; przy filtrze delty dopisek, że delty nie sprawdzono', () => {
    const c = rule({ id: 'c', kind: 'close', iv: '5m', dir: -1, price: 64_660 });
    const d = rule({ id: 'd', kind: 'close', iv: '5m', dir: -1, price: 64_660, delta: true });
    const e = new AlertEngine(true);
    let res = run(e, [c, d], [tr(T0 + M, 64_700), tr(T0 + 5 * M - 100, 64_650, 1, -1)]);
    e.gap('BTC');
    res = run(e, res.list, [tr(T0 + 5 * M + 3000, 64_655)]);
    expect(res.events).toEqual([]);
    expect(e.hole('BTC')).toEqual({ from: T0 + 5 * M - 100, to: T0 + 5 * M + 3000 });
    const g = e.fillGap(res.list, 'BTC', T0 + 5 * M + 3000, [candle(T0 + 4 * M, 64_700, 64_640, 64_650), candle(T0 + 5 * M, 64_660, 64_650, 64_655)]);
    expect(g.events.map((x) => [x.type, x.rule.id, x.at, x.px, x.gap])).toEqual([
      ['fire', 'c', T0 + 5 * M, 64_650, true],
      ['fire', 'd', T0 + 5 * M, 64_650, true],
    ]);
    expect(eventBody(g.events[0], 'pl')).toMatch(/: świeca 5m zamknięta pod 64\u00a0660 \(64\u00a0650\)\. Zamknięcie świecy w czasie przerwy w połączeniu z giełdą \(ze świec 1m\)\.$/);
    expect(eventBody(g.events[1], 'pl')).toMatch(/\(ze świec 1m\)\. Delta nieznana \(przerwa\), filtr delty niesprawdzony\.$/);
    expect(eventBody(g.events[1], 'en')).toMatch(/Delta unknown \(gap\), the delta filter was not checked\.$/);
    // Powiadomienie po dłuższej chwili mówi, ile minęło
    expect(eventBody(g.events[0], 'pl', T0 + 25 * M)).toMatch(/ 20 min przed tym powiadomieniem\.$/);
    expect(eventBody(g.events[0], 'pl', T0 + 5 * M + 30_000)).not.toMatch(/przed tym powiadomieniem/);
    // Strona (bez uzupełniania luk) tego zamknięcia nie zna: seria liczy się od świecy po luce
    const page = new AlertEngine();
    let p = run(page, [c], [tr(T0 + M, 64_700), tr(T0 + 5 * M - 100, 64_650)]);
    page.gap('BTC');
    p = run(page, p.list, [tr(T0 + 5 * M + 3000, 64_655)]);
    expect(p.events).toEqual([]);
    expect(page.hole('BTC')).toBeNull();
  });

  it('seria przez lukę: zamknięcia z taśmy po luce czekają na nią, świeca z luki po złej stronie przerywa serię', () => {
    const r = rule({ kind: 'close', iv: '5m', dir: -1, price: 64_660, closes: 2 });
    const tape = (e: AlertEngine) => {
      let res = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 4 * M, 64_650), tr(T0 + 5 * M + 1000, 64_650)]);
      expect(res.list[0].streak).toBe(1);
      e.gap('BTC');
      // Po luce taśma zamyka świecę 10–15 za poziomem, zanim przyjdą świece z API: wynik czeka
      res = run(e, res.list, [tr(T0 + 10 * M + 2000, 64_640), tr(T0 + 14 * M, 64_640), tr(T0 + 15 * M + 500, 64_640)]);
      expect(res.events).toEqual([]);
      return res.list;
    };
    const minutes = (last: number) => [5, 6, 7, 8, 9].map((k) => candle(T0 + k * M, 64_710, 64_640, k === 9 ? last : 64_650));
    const back = new AlertEngine(true);
    const list = tape(back);
    const g1 = back.fillGap(list, 'BTC', T0 + 10 * M + 2000, minutes(64_700));
    expect(g1.events).toEqual([]);
    // Świeca 5–10 (z luki) nad poziomem zeruje serię, świeca 10–15 (z taśmy, po niej) zaczyna nową
    expect((g1.rules ?? list)[0].streak).toBe(1);
    const on = new AlertEngine(true);
    const g2 = on.fillGap(tape(on), 'BTC', T0 + 10 * M + 2000, minutes(64_650));
    expect(g2.events.map((x) => [x.type, x.at, x.px, x.gap])).toEqual([['fire', T0 + 10 * M, 64_650, true]]);
  });

  it('koniec okna w luce: wygaśnięcie dopiero po uzupełnieniu, zamknięcie świecy dokładnie o „do” dzwoni', () => {
    const r = rule({ kind: 'close', dir: -1, price: 64_660, until: T0 + 15 * M });
    const tape = (e: AlertEngine) => {
      let res = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 14 * M + 50_000, 64_650)]);
      e.gap('BTC');
      res = run(e, res.list, [tr(T0 + 15 * M + 20_000, 64_650)]);
      expect(res.events).toEqual([]);
      return res.list;
    };
    const fire = new AlertEngine(true);
    const g1 = fire.fillGap(tape(fire), 'BTC', T0 + 15 * M + 20_000, [candle(T0 + 14 * M, 64_700, 64_640, 64_650)]);
    expect(g1.events.map((x) => [x.type, x.at])).toEqual([['fire', T0 + 15 * M]]);
    const off = new AlertEngine(true);
    const g2 = off.fillGap(tape(off), 'BTC', T0 + 15 * M + 20_000, [candle(T0 + 14 * M, 64_700, 64_640, 64_680)]);
    expect(g2.events.map((x) => [x.type, x.at])).toEqual([['expire', T0 + 15 * M]]);
  });

  it('powrót: zejście pod poziom w luce uzbraja alarm, zamknięcie z powrotem z taśmy po luce go uruchamia', () => {
    const r = rule({ kind: 'reclaim', iv: '15m', dir: 1, price: 64_670 });
    const { e, list } = withHole([r], T0 + M, T0 + 3 * M + 30_000);
    const g = e.fillGap(list, 'BTC', T0 + 3 * M + 30_000, [candle(T0 + 2 * M, 64_700, 64_620, 64_690)]);
    expect(g.rules?.[0].armed).toBe(true);
    const res = run(e, g.rules!, [tr(T0 + 14 * M, 64_690), tr(T0 + 15 * M + 1, 64_700)]);
    expect(res.events.map((x) => [x.type, x.at, x.px])).toEqual([['fire', T0 + 15 * M, 64_690]]);
  });

  it('API bez świec: „krok” z informacją o niesprawdzonej luce (alarm pilnuje dalej), seria zamknięć od nowa', () => {
    const t = rule({ id: 't', price: 64_500 });
    const c = rule({ id: 'c', kind: 'close', iv: '5m', dir: -1, price: 64_660, closes: 2, streak: 1 });
    const h = rule({ id: 'h', kind: 'close', iv: '1h', dir: -1, price: 64_660 }); // żadna świeca 1h nie skończyła się w luce
    const x = rule({ id: 'x', price: 64_000, after: 't' });
    const { e, list } = withHole([t, c, h, x], T0 + 3 * M, T0 + 7 * M);
    const g = e.fillGap(list, 'BTC', T0 + 7 * M, null);
    expect(g.events.map((v) => [v.type, v.rule.id, v.hole])).toEqual([
      ['step', 't', { from: T0 + 3 * M, to: T0 + 7 * M }],
      ['step', 'c', { from: T0 + 3 * M, to: T0 + 7 * M }],
    ]);
    expect(g.rules?.map((v) => [v.id, v.streak, v.after])).toEqual([
      ['t', 0, ''],
      ['c', 0, ''],
      ['h', 0, ''],
      ['x', 0, 't'],
    ]);
    expect(e.hole('BTC')).toBeNull();
    expect(eventText(g.events[0], 'pl')).toBe('Alarm BTC 64\u00a0500 nadal działa, ale nie sprawdził 4 min przerwy w danych z giełdy (API nie dało świec)');
    expect(eventText(g.events[0], 'en')).toBe('BTC alert at 64,500 is still on, but could not check a 4 min gap in the exchange data (no candles from the API)');
    expect(eventTitle(g.events[0], 'pl')).toBe('BTC · alarm 64\u00a0500: przerwa w danych niesprawdzona');
  });

  it('druga przerwa przed uzupełnieniem wydłuża lukę; odpowiedź do starego końca zostawia resztę', () => {
    const r = rule({ kind: 'close', iv: '5m', dir: -1, price: 64_660 });
    const e = new AlertEngine(true);
    let res = run(e, [r], [tr(T0 + M, 64_700)]);
    e.gap('BTC');
    res = run(e, res.list, [tr(T0 + 2 * M, 64_700)]);
    e.gap('BTC');
    res = run(e, res.list, [tr(T0 + 7 * M, 64_700)]);
    expect(e.hole('BTC')).toEqual({ from: T0 + M, to: T0 + 7 * M });
    const part = e.fillGap(res.list, 'BTC', T0 + 2 * M, [candle(T0 + M, 64_710, 64_690)]);
    expect(part.events).toEqual([]);
    expect(e.hole('BTC')).toEqual({ from: T0 + 2 * M, to: T0 + 7 * M });
    const rest = e.fillGap(res.list, 'BTC', T0 + 7 * M, [2, 3, 4, 5, 6].map((k) => candle(T0 + k * M, 64_700, 64_640, 64_650)));
    expect(rest.events.map((x) => [x.type, x.at])).toEqual([['fire', T0 + 5 * M]]);
    expect(e.hole('BTC')).toBeNull();
  });

  it('stan do zapisu: ostatnia transakcja rynku, przy luce jej początek; po restarcie luka od zapisanej chwili', () => {
    const e = new AlertEngine(true);
    run(e, [rule({})], [tr(T0 + M, 64_700)]);
    expect(e.lastTrades()).toEqual({ BTC: T0 + M });
    e.gap('BTC');
    run(e, [rule({})], [tr(T0 + 3 * M, 64_700)]);
    expect(e.lastTrades()).toEqual({ BTC: T0 + M });
    const fresh = new AlertEngine(true);
    fresh.gap('BTC', T0 + M);
    run(fresh, [rule({})], [tr(T0 + M, 64_700), tr(T0 + 2 * M, 64_700)]);
    expect(fresh.hole('BTC')).toEqual({ from: T0 + M, to: T0 + 2 * M });
    fresh.reset('BTC');
    expect(fresh.lastTrades()).toEqual({});
  });
});

describe('alarmy: zamknięcie o końcu okna (bez luki)', () => {
  it('świeca kończąca się dokładnie o „do” uruchamia alarm zamiast wygaśnięcia', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660, until: T0 + 15 * M });
    const { events } = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 14 * M, 64_650), tr(T0 + 15 * M + 500, 64_640)]);
    expect(events.map((x) => [x.type, x.at])).toEqual([['fire', T0 + 15 * M]]);
    // Następna świeca jest już po oknie
    const late = rule({ kind: 'close', dir: -1, price: 64_660, until: T0 + 14 * M });
    expect(run(new AlertEngine(), [late], [tr(T0 + M, 64_700), tr(T0 + 14 * M - 1, 64_650), tr(T0 + 15 * M + 500, 64_640)]).events.map((x) => x.type)).toEqual(['expire']);
  });
});

describe('alarmy: zgodność w przód i „krok”', () => {
  it('rodzaj i pola z nowszej wersji zostają w zapisie; alarm bez rodzaju z poprzedniej wersji to dotknięcie', () => {
    const raw = [
      { id: 'n', coin: 'BTC', price: 64_700, kind: 'time', dir: 1, created: T0, mins: 45, fillBy: T0 + 5 * M, label: 'wyjście', bad: { x: 1 }, 'x-y': 1 },
      { id: 'o', coin: 'BTC', price: 64_700, dir: 1, created: T0 },
    ];
    const [n, o] = parseRules(JSON.parse(JSON.stringify(raw)), T0);
    expect(n).toMatchObject({ kind: 'time', mins: 45, fillBy: T0 + 5 * M, label: 'wyjście' });
    expect(n).not.toHaveProperty('bad');
    expect(n).not.toHaveProperty('x-y');
    expect(parseRules([n], T0)).toEqual([n]);
    expect(o.kind).toBe('touch');
    expect(knownKind('time')).toBe(false);
    expect(ruleText(n, 'pl')).toBe('alarm z nowszej wersji strony');
  });

  it('silnik pomija nieznany rodzaj (bez strumienia, bez zdarzeń, bez wygaśnięcia), para i łańcuch działają', () => {
    const e = new AlertEngine();
    const future = rule({ id: 'f', kind: 'time', until: T0 + M });
    expect(e.intervals([future], 'BTC')).toEqual([]);
    expect(run(e, [future], [tr(T0 + 2 * M, 1)]).events).toEqual([]);
    const touch = rule({ id: 't', price: 64_600, pair: 'p' });
    const paired = rule({ id: 'g', kind: 'time', pair: 'p' });
    const child = rule({ id: 'c', kind: 'time', after: 't' });
    const { events, list } = run(new AlertEngine(), [touch, paired, child], [tr(T0 + 1000, 64_590)]);
    expect(events.map((x) => [x.type, x.rule.id])).toEqual([
      ['fire', 't'],
      ['cancel', 'g'],
    ]);
    expect(list).toEqual([expect.objectContaining({ id: 'c', after: '', created: T0 + 1000 })]);
    expect(eventText({ type: 'fire', rule: future, at: 0, px: 64_000, facts: null }, 'pl')).toBe('Alarm BTC 64\u00a0670 zadziałał (64\u00a0000)');
  });

  it('krok nie kończy alarmu i nie rusza łańcucha; zdarzenia czytane z sieci zachowują lukę i jej informację', () => {
    expect(EVENT_TYPES.filter((t) => endsAlert({ type: t }))).toEqual(['fire', 'expire', 'cancel']);
    const step = { type: 'step', rule: rule({}), at: T0, px: 64_700, facts: null, hole: { from: T0 - M, to: T0 } };
    expect(parseEvent(JSON.parse(JSON.stringify(step)), T0)).toEqual(step);
    expect(parseEvent({ ...step, type: 'later' }, T0)).toBeNull();
    expect(parseEvent({ ...step, type: 'fire', hole: undefined, gap: true }, T0)).toMatchObject({ type: 'fire', gap: true });
  });
});

describe('alarmy: hash zerowy i tytuł powiadomienia', () => {
  it('wypełnienia z hashem zerowym liczą się każde osobno w największych zleceniach, ich suma osobno', () => {
    const Z = `0x${'0'.repeat(64)}`;
    expect(tradeKey(Z, 7)).toBe('t7');
    expect(tradeKey('0xab12', 7)).toBe('0xab12');
    expect(tradeKey(undefined, 7)).toBe('t7');
    expect(isZeroHash(Z)).toBe(true);
    expect(isZeroHash('0xab12')).toBe(false);
    const e = new AlertEngine();
    const r = rule({ kind: 'close', dir: -1, price: 64_660 });
    const z = (time: number, tid: number): AlertTrade => ({ time, px: 64_650, sz: 0.5, side: -1, key: tradeKey(Z, tid), zero: true });
    run(e, [r], [tr(T0 - 1, 64_700), z(T0 + M, 1), z(T0 + 2 * M, 2), z(T0 + 3 * M, 3), tr(T0 + 4 * M, 64_640, 0.4, -1, '0xab12'), tr(T0 + 4 * M, 64_640, 0.3, -1, '0xab12')]);
    const f = run(e, [r], [tr(T0 + 15 * M + 1, 64_640)]).events[0].facts!;
    expect(f.maxSell).toBeCloseTo(0.7 * 64_640);
    expect(f.noHashUsd).toBeCloseTo(1.5 * 64_650);
    expect(factsText(f, 'BTC', 'pl')).toMatch(/, wypełnienia z hashem zerowym \(m\.in\. TWAP\) 97 tys\. \$/);
    expect(factsText(f, 'BTC', 'en')).toMatch(/, zero-hash fills \(incl\. TWAP\) \$97K/);
    expect(factsText({ ...f, noHashUsd: undefined }, 'BTC', 'pl')).not.toMatch(/hashem/);
  });

  it('tytuł: rynek i co się stało (PL/EN)', () => {
    const ev = (p: Partial<AlertRule>, type: AlertEvent['type'] = 'fire'): AlertEvent => ({ type, rule: rule(p), at: T0, px: 64_650, facts: null });
    expect(eventTitle(ev({}), 'pl')).toBe('BTC · cena doszła do 64\u00a0670');
    expect(eventTitle(ev({}), 'en')).toBe('BTC · price at 64,670');
    expect(eventTitle(ev({ kind: 'close', price: 64_660 }), 'pl')).toBe('BTC · zamknięcie 15m pod 64\u00a0660');
    expect(eventTitle(ev({ kind: 'reclaim', dir: 1, iv: '5m' }), 'en')).toBe('BTC · back above 64,670 (5m)');
    expect(eventTitle(ev({ kind: 'squeeze', dir: 1, price: 1 }), 'pl')).toBe('BTC · wyciskanie shortów');
    expect(eventTitle(ev({ kind: 'squeeze', price: 1 }, 'expire'), 'en')).toBe('BTC · squeeze alert expired');
    expect(eventTitle(ev({}, 'expire'), 'pl')).toBe('BTC · alarm 64\u00a0670 wygasł');
    expect(eventTitle(ev({ kind: 'time' }), 'pl')).toBe('BTC · alarm 64\u00a0670');
  });
});

describe('alarmy: wybicie i powrót', () => {
  it('zejście pod poziom i zamknięcie z powrotem nad nim w tej samej świecy', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'reclaim', dir: 1, price: 64_670 });
    const { events } = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 5 * M, 64_610, 3, -1), tr(T0 + 14 * M, 64_702, 5, 1), tr(T0 + 15 * M + 1, 64_705)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fire', px: 64_702, at: T0 + 15 * M });
  });

  it('bez zejścia pod poziom zamknięcie nad nim nic nie znaczy; zejście jest zapamiętane w alarmie', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'reclaim', dir: 1, price: 64_670 });
    let res = run(e, [r], [tr(T0 + M, 64_700), tr(T0 + 15 * M + 1, 64_700)]);
    expect(res.events).toEqual([]);
    res = run(e, res.list, [tr(T0 + 20 * M, 64_650)]);
    expect(res.list[0].armed).toBe(true);
    res = run(e, res.list, [tr(T0 + 29 * M, 64_660), tr(T0 + 30 * M + 1, 64_690)]);
    expect(res.events).toEqual([]);
  });

  it('filtr delty: zamknięcie nad poziomem przy ujemnej delcie nie uruchamia, przy dodatniej — tak', () => {
    const e = new AlertEngine();
    const r = rule({ kind: 'reclaim', dir: 1, price: 64_670, delta: true });
    let res = run(e, [r], [tr(T0 + M, 64_600, 1, 1), tr(T0 + 14 * M, 64_690, 4, -1), tr(T0 + 15 * M + 1, 64_690, 1, 1)]);
    expect(res.events).toEqual([]);
    res = run(e, res.list, [tr(T0 + 29 * M, 64_700, 6, 1), tr(T0 + 30 * M + 1, 64_700, 1, 1)]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].facts?.delta).toBeGreaterThan(0);
  });
});

describe('alarmy: wygaśnięcie i para scenariuszy', () => {
  it('po końcu okna alarm wygasa jednym zdarzeniem', () => {
    const e = new AlertEngine();
    const { events, list } = run(e, [rule({ until: T0 + 10 * M })], [tr(T0 + 5 * M, 64_900), tr(T0 + 11 * M, 64_600)]);
    expect(events).toEqual([expect.objectContaining({ type: 'expire', at: T0 + 10 * M })]);
    expect(list).toEqual([]);
  });

  it('pierwszy uruchomiony alarm z pary kasuje drugi', () => {
    const e = new AlertEngine();
    const short = rule({ id: 's', kind: 'close', dir: -1, price: 64_660, pair: 'p' });
    const long = rule({ id: 'l', kind: 'reclaim', dir: 1, price: 64_670, pair: 'p' });
    const other = rule({ id: 'o', price: 63_000 });
    const { events, list } = run(e, [short, long, other], [tr(T0 + M, 64_700), tr(T0 + 14 * M, 64_640), tr(T0 + 15 * M + 1, 64_640)]);
    expect(events.map((x) => [x.type, x.rule.id])).toEqual([
      ['fire', 's'],
      ['cancel', 'l'],
    ]);
    expect(list.map((r) => r.id)).toEqual(['o']);
    expect(eventText(events[1], 'pl')).toBe('Alarm BTC 64 670 anulowany: zadziałał alarm z pary');
  });
});

describe('alarmy: łańcuch', () => {
  it('alarm po innym czeka na jego uruchomienie i liczy świece od tej chwili', () => {
    const e = new AlertEngine();
    const breakout = rule({ id: 'b', kind: 'close', dir: 1, price: 65_500 });
    const exit = rule({ id: 'x', kind: 'close', dir: -1, price: 65_400, after: 'b' });
    // Świeca zamknięta pod 65 400, zanim wybicie się zdarzyło, nie liczy się dla wyjścia
    let res = run(e, [breakout, exit], [tr(T0 + 14 * M, 65_300), tr(T0 + 15 * M + 1, 65_450), tr(T0 + 29 * M, 65_520), tr(T0 + 30 * M + 1, 65_510)]);
    expect(res.events.map((x) => [x.type, x.rule.id])).toEqual([['fire', 'b']]);
    expect(res.list).toEqual([expect.objectContaining({ id: 'x', after: '', created: T0 + 30 * M })]);
    res = run(e, res.list, [tr(T0 + 44 * M, 65_390), tr(T0 + 45 * M + 1, 65_380)]);
    expect(res.events.map((x) => [x.type, x.rule.id, x.at])).toEqual([['fire', 'x', T0 + 45 * M]]);
  });

  it('wygasły alarm zabiera ze sobą alarm, który na niego czekał', () => {
    const e = new AlertEngine();
    const first = rule({ id: 'f', until: T0 + 5 * M });
    const next = rule({ id: 'n', price: 81_000, after: 'f' });
    const { events, list } = run(e, [first, next], [tr(T0 + 6 * M, 64_900)]);
    expect(events.map((x) => [x.type, x.rule.id])).toEqual([
      ['expire', 'f'],
      ['cancel', 'n'],
    ]);
    expect(list).toEqual([]);
    expect(eventText(events[1], 'pl')).toBe('Alarm BTC 81 000 anulowany: alarm, na który czekał, nie zadziałał');
    expect(eventText(events[1], 'en')).toBe('BTC alert at 81,000 cancelled: the alert it was waiting for did not fire');
  });
});

describe('alarmy: wyciskanie', () => {
  const S = 1000;
  /** Transakcje z otwartymi pozycjami przed każdą (jak kontekst rynku z WebSocket). */
  function runOi(e: AlertEngine, rules: AlertRule[], steps: [number, number, number][]) {
    let list = rules;
    const events = [];
    for (const [time, px, oi] of steps) {
      e.onOi('BTC', oi);
      const r = e.onTrades(list, 'BTC', [tr(time, px)]);
      if (r.rules) list = r.rules;
      events.push(...r.events);
    }
    return { list, events };
  }
  const squeeze = (p: Partial<AlertRule> = {}) => rule({ id: 's', kind: 'squeeze', dir: 1, price: 1, ...p });

  it('wzrost o próg w 10 min przy ubywających pozycjach: od dołka okna, z OI od początku okna', () => {
    const e = new AlertEngine();
    const { list, events } = runOi(e, [squeeze()], [
      [T0 + S, 64_100, 1000],
      [T0 + 2 * M, 64_000, 1001],
      [T0 + 5 * M, 64_500, 997],
      [T0 + 6 * M, 64_600, 995],
      [T0 + 6 * M + 10 * S, 64_700, 994],
    ]);
    expect(events.map((x) => [x.type, x.rule.id, x.px])).toEqual([['fire', 's', 64_700]]);
    expect(events[0].facts?.move).toEqual({ from: 64_000, at: T0 + 2 * M, oiPct: expect.closeTo(-0.6, 5) });
    expect(Number.isNaN(events[0].facts?.oiPct)).toBe(true);
    expect(list).toEqual([]);
    expect(eventText(events[0], 'pl')).toBe('Wyciskanie shortów BTC: +1,09% w 4 min (z 64\u00a0000 do 64\u00a0700), OI −0,6%');
    expect(eventText(events[0], 'en')).toBe('BTC short squeeze: +1.09% in 4 min (from 64,000 to 64,700), OI −0.6%');
  });

  it('pozycje znane dopiero po pierwszych transakcjach (alarm ustawiony na rynku bez innych alarmów)', () => {
    const e = new AlertEngine();
    let list = [squeeze()];
    const r1 = e.onTrades(list, 'BTC', [tr(T0 + S, 64_000)]);
    if (r1.rules) list = r1.rules;
    const { events } = runOi(e, list, [
      [T0 + 2 * S, 64_010, 1000],
      [T0 + 4 * M, 64_700, 994],
    ]);
    expect(events.map((x) => [x.type, x.px])).toEqual([['fire', 64_700]]);
  });

  it('ten sam ruch przy przybywających pozycjach to nie wyciskanie', () => {
    const e = new AlertEngine();
    const { events } = runOi(e, [squeeze()], [
      [T0 + S, 64_000, 1000],
      [T0 + 4 * M, 64_700, 1005],
    ]);
    expect(events).toEqual([]);
  });

  it('ruch rozłożony na dłużej niż 10 min nie przechodzi progu', () => {
    const e = new AlertEngine();
    const { events } = runOi(e, [squeeze()], [
      [T0 + S, 64_000, 1000],
      [T0 + 6 * M, 64_330, 998],
      [T0 + 12 * M, 64_700, 990],
    ]);
    expect(events).toEqual([]);
  });

  it('spadek przy zamykanych longach i tylko od chwili ustawienia alarmu', () => {
    const e = new AlertEngine();
    const steps: [number, number, number][] = [
      [T0 + S, 65_000, 1000],
      [T0 + 3 * M, 64_700, 998],
      [T0 + 5 * M, 64_300, 995],
    ];
    // Szczyt 65 000 sprzed ustawienia alarmu się nie liczy: od 64 700 to tylko −0,62%
    expect(runOi(e, [squeeze({ dir: -1, created: T0 + 2 * M })], steps).events).toEqual([]);
    const fresh = new AlertEngine();
    const { events } = runOi(fresh, [squeeze({ dir: -1 })], steps);
    expect(events.map((x) => [x.type, x.px])).toEqual([['fire', 64_300]]);
    expect(eventText(events[0], 'pl')).toMatch(/^Wyciskanie longów BTC: −1,08% w 5 min/);
  });

  it('opis warunku i świece: bez linii poziomu, fakty z bieżącej minuty', () => {
    const r = squeeze({ price: 1.2 });
    expect(ruleText(r, 'pl')).toBe('wyciskanie shortów: wzrost o 1,2% w 10 min, OI w dół co najmniej 0,3%');
    expect(ruleText({ ...r, dir: -1 }, 'en')).toBe('long squeeze: drop of 1.2% within 10 min, OI down at least 0.3%');
    expect(new AlertEngine().intervals([r], 'BTC')).toEqual(['1m']);
    expect(eventText({ type: 'expire', rule: r, at: 0, px: 64_000, facts: null }, 'pl')).toBe('Alarm wyciskania BTC wygasł bez uruchomienia');
    expect(eventText({ type: 'expire', rule: r, at: 0, px: 64_000, facts: null }, 'en')).toBe('BTC squeeze alert expired without triggering');
  });
});

describe('alarmy: fakty ze świecy', () => {
  it('delta, wolumen wobec średniej, OI i największe zlecenia (wypełnienia jednego zlecenia razem)', () => {
    const e = new AlertEngine();
    e.seedVolumes('BTC', '15m', [10, 20, 30, 40, 50].map((v, i) => ({ t: T0 - (5 - i) * 15 * M, v })), T0);
    e.onOi('BTC', 1000);
    const r = rule({ kind: 'close', dir: -1, price: 64_660 });
    const { events } = run(e, [r], [tr(T0 - 1, 64_700), tr(T0 + M, 64_650, 2, -1, 'x'), tr(T0 + 2 * M, 64_640, 3, -1, 'x'), tr(T0 + 3 * M, 64_645, 1, 1, 'y')]);
    e.onOi('BTC', 990);
    const done = run(e, [r], [tr(T0 + 15 * M + 1, 64_640)]);
    expect(events).toEqual([]);
    const f = done.events[0].facts!;
    expect(f).toMatchObject({ iv: '15m', delta: -4, vol: 6, partial: false });
    expect(f.volX).toBeCloseTo(6 / 30);
    expect(f.oiPct).toBeCloseTo(-1);
    expect(f.maxSell).toBeCloseTo(2 * 64_650 + 3 * 64_640);
    expect(f.maxBuy).toBeCloseTo(64_645);
  });
});

describe('alarmy: opisy PL/EN', () => {
  it('warunek, zdarzenie i fakty w obu językach z formatem liczb strony', () => {
    const r = rule({ kind: 'reclaim', dir: 1, price: 64_670, delta: true });
    expect(ruleText(r, 'pl')).toBe('zejście pod 64 670, potem świeca 15m zamknięta z powrotem nad · delta dodatnia');
    expect(ruleText(r, 'en')).toBe('dip below 64,670, then a 15m close back above · positive delta');
    expect(ruleText(rule({ kind: 'close', closes: 2 }), 'pl')).toBe('2 świece 15m z rzędu zamknięte pod 64 670');
    expect(eventText({ type: 'fire', rule: rule({ kind: 'close', price: 64_660 }), at: 0, px: 64_642, facts: null }, 'en')).toBe('BTC: 15m candle closed below 64,660 (64,642)');
    expect(fmtLevel(2950.55, 'pl')).toBe('2 950,6');
    const facts = { iv: '15m', delta: -320.4, vol: 1240, volX: 1.94, oiPct: -0.6, maxBuy: 812_000, maxSell: 1_230_000, partial: false, touch: false };
    expect(factsText(facts, 'BTC', 'pl')).toBe(
      'Świeca 15m: delta −320 BTC, wolumen 1 240 BTC (1,9× średnia), OI −0,6%, największe zlecenia: kupno 812 tys. $, sprzedaż 1,2 mln $.'
    );
    expect(factsText(facts, 'BTC', 'en')).toBe('15m candle: delta −320 BTC, volume 1,240 BTC (1.9× average), OI −0.6%, largest orders: buy $812K, sell $1.2M.');
    expect(factsText({ ...facts, iv: '1m', volX: Number.NaN }, 'BTC', 'pl')).toMatch(/^Świeca 1m: /);
    expect(factsText({ ...facts, iv: '1m', volX: Number.NaN, touch: true }, 'BTC', 'en')).toMatch(/^This minute: /);
  });
});
