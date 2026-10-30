import { describe, expect, it } from 'vitest';
import { AlertEngine, type AlertRule, type AlertTrade, defaultDir, eventBody, eventText, factsText, fmtLevel, ruleText } from '../alertRules';

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

describe('alarmy: dotknięcie w czasie przerwy w połączeniu', () => {
  const candle = (t: number, h: number, l: number) => ({ t, h, l });

  it('przerwa, w świecy 1m z API cena przechodzi przez poziom: alarm odpala raz, transakcje po powrocie go nie powtarzają', () => {
    const e = new AlertEngine();
    const r = rule({ price: 64_670, dir: -1 });
    run(e, [r], [tr(T0 + 2 * M + 5000, 64_700)]);
    const from = e.gap('BTC');
    expect(from).toBe(T0 + 2 * M + 5000);
    const g = e.onGapCandles([r], 'BTC', [candle(T0 + 2 * M, 64_710, 64_690), candle(T0 + 3 * M, 64_700, 64_660), candle(T0 + 4 * M, 64_680, 64_650)]);
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toMatchObject({ type: 'fire', at: T0 + 3 * M, px: 64_670, gap: true, facts: null });
    expect(g.rules).toEqual([]);
    expect(run(e, g.rules!, [tr(T0 + 5 * M, 64_640)]).events).toEqual([]);
    expect(eventBody(g.events[0], 'pl')).toBe(`${eventText(g.events[0], 'pl')}. Dotknięcie w czasie przerwy w połączeniu z giełdą (świeca 1m).`);
    expect(eventBody(g.events[0], 'en')).toMatch(/Touched while the connection to the exchange was down/);
  });

  it('liczy się tylko świeca w całości po ustawieniu alarmu i w jego oknie; inne warunki niż dotknięcie — bez zmian', () => {
    const e = new AlertEngine();
    const set = rule({ id: 'set', created: T0 + 3 * M + 20_000 }); // ustawiony w środku minuty 3
    const win = rule({ id: 'win', from: T0, until: T0 + 3 * M + 30_000 }); // okno kończy się w środku minuty 3
    const close = rule({ id: 'close', kind: 'close', iv: '1m' });
    const g = e.onGapCandles([set, win, close], 'BTC', [candle(T0 + 3 * M, 64_700, 64_600)]);
    expect(g.events).toEqual([]);
    expect(g.rules).toBeNull();
  });

  it('para: dotknięcie z przerwy kasuje drugi alarm pary', () => {
    const e = new AlertEngine();
    const up = rule({ id: 'up', price: 64_800, dir: 1, pair: 'p' });
    const down = rule({ id: 'down', price: 64_500, dir: -1, pair: 'p' });
    const g = e.onGapCandles([up, down], 'BTC', [candle(T0 + M, 64_810, 64_700)]);
    expect(g.events.map((x) => [x.type, x.rule.id])).toEqual([
      ['fire', 'up'],
      ['cancel', 'down'],
    ]);
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
