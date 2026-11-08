import { afterEach, describe, expect, it } from 'vitest';
import { computeAuctionContext } from '../../src/state/useAuctionContext';
import { toVBars } from '../../src/utils/auction';
import { dayVwapOf, vwapSigma } from '../../src/utils/dayVwap';
import { type FourNumber, clarityNum, gotValue, hourWidth, hourWidthNum, liqFuel, nextSessionHour } from '../../src/utils/fourNumbers';
import { LIQ_MAP_RANGE } from '../../src/utils/liqMap';
import { isAbsent } from '../../src/utils/sessionText';
import { fourNumbers } from '../../src/views/before/fourInputs';
import { BLOCK_MARK, DISCLAIMER, type Envelope, type Num } from '../src/envelope';
import type { Sources } from '../src/sources';
import { ADDR, CLOSE, LIQ, LIQ_URL, M1, NOW, PREV, mapsJson, routes, siteInputs, todayMap } from './briefFixtures';
import { HL_INFO, MAPS_URL, MIN, type Route, asCandles, connect, testSources } from './helpers';

interface BriefItem {
  id: string;
  title: string;
  value: Num | null;
  text: string;
  badge: string;
  hint: string;
  note: string | null;
  flag: string | null;
  parts?: { below: Num; above: Num };
}
interface BriefLevel {
  label: string | null;
  labelWhy: string | null;
  price: Num;
  from: 'blog' | 'vah' | 'val' | 'poc';
}
interface BriefLevelCheck {
  price: number;
  fromPrice: { usd: Num; pct: Num };
  vwapDistance: Num;
  fuelToLevel: Num;
}
interface BriefData {
  four: BriefItem[];
  levels: BriefLevel[];
  session: { current: string | null; next: string | null; nextOpensAt: string | null };
  level?: BriefLevelCheck;
}

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function call(src: Sources, args: Record<string, unknown> = {}) {
  const c = await connect(src);
  close = c.close;
  const res = await c.client.callTool({ name: 'market_brief', arguments: args });
  return { res, env: res.structuredContent as unknown as Envelope<BriefData> };
}

const run = (r: Record<string, Route>, now = NOW, extra: Parameters<typeof testSources>[2] = {}) => call(testSources(r, now, extra).src);
/** Wywołanie z argumentem `level` (i innymi), z dostępem do żądań fałszywego `fetch`. */
async function runLevel(args: Record<string, unknown>, r: Record<string, Route> = routes()) {
  const s = testSources(r, NOW);
  return { ...(await call(s.src, args)), calls: s.calls };
}

/** Pozycja Czwórki strony w kształcie odpowiedzi (wartość strony to `text`). */
const fromSite = (n: FourNumber) => ({ id: n.id, title: n.title, text: n.value, badge: n.badge, hint: n.hint, note: n.note ?? null, flag: n.flag ?? null });
const shown = (i: BriefItem) => ({ id: i.id, title: i.title, text: i.text, badge: i.badge, hint: i.hint, note: i.note, flag: i.flag });

describe('market_brief', () => {
  it('tools/list: market_brief z opcjonalnym argumentem level (liczba dodatnia), z tytułem i opisem', async () => {
    const c = await connect(testSources({}, NOW).src);
    close = c.close;
    const { tools } = await c.client.listTools();
    const t = tools.find((x) => x.name === 'market_brief');
    expect(t?.title).toBeTruthy();
    expect(t?.description).toContain('nie porada inwestycyjna');
    expect(t?.description).toContain('level');
    expect(t?.description).not.toMatch(/bez argumentów/i);
    expect(Object.keys(t?.inputSchema.properties ?? {})).toEqual(['level']);
    expect(t?.inputSchema.properties?.level).toMatchObject({ type: 'number', exclusiveMinimum: 0 });
    expect(t?.inputSchema.required ?? []).toEqual([]);
  });

  it('Czwórka w kolejności strony: tytuł, tekst, plakietka i podpowiedź jak fourNumbers strony na tych samych świecach i plikach', async () => {
    const { res, env } = await run(routes());
    expect(res.isError).toBeFalsy();
    const site = fourNumbers(siteInputs(NOW)).items;
    expect(env.data.four.map((i) => i.id)).toEqual(['clarity', 'fuel', 'hourWidth', 'vwap']);
    expect(env.data.four.map(shown)).toEqual(site.map(fromSite));
    // Wszystkie cztery z liczbą (dane pełne): żadna nie jest „—”
    for (const i of env.data.four) expect(i.text).not.toBe('—');
  });

  it('tekst czytelności i szerokości godziny identyczny z clarityNum i hourWidthNum wywołanymi bezpośrednio', async () => {
    const { env } = await run(routes());
    const x = siteInputs(NOW);
    const [clarity, , width] = env.data.four;
    expect(clarity).toMatchObject({ title: clarityNum(x).title, text: clarityNum(x).value, badge: clarityNum(x).badge, hint: clarityNum(x).hint });
    expect(width).toMatchObject({ title: hourWidthNum(x).title, text: hourWidthNum(x).value, badge: 'MODEL', hint: hourWidthNum(x).hint });
    expect(clarity.text).toBe('trendowy · mapa 2/4');
    expect(width.text).toBe('100 USD');
  });

  it('liczby jako Num: szerokość godziny (USD, MODEL), odległość od VWAP (σ, LIVE), paliwo pod i nad ceną (USD, LIVE)', async () => {
    const { env } = await run(routes());
    const [clarity, fuel, width, vwap] = env.data.four;
    // Czytelność to opis (typ dnia i trafienia mapy), bez jednej liczby
    expect(clarity.value).toBeNull();
    const f = liqFuel(LIQ, CLOSE);
    expect(f.below).toBeGreaterThan(0);
    expect(f.above).toBeGreaterThan(0);
    expect(fuel.value).toBeNull();
    expect(fuel.parts?.below).toMatchObject({ value: f.below, unit: 'usd', badge: 'LIVE', why: null });
    expect(fuel.parts?.above).toMatchObject({ value: f.above, unit: 'usd', badge: 'LIVE', why: null });
    const x = siteInputs(NOW);
    expect(width.value).toMatchObject({ value: hourWidth(gotValue(x.bars1h) ?? [], nextSessionHour(NOW), NOW).median, unit: 'usd', badge: 'MODEL', method: 'mediana 20 dni' });
    expect(width.value?.value).toBe(100);
    const dv = dayVwapOf(asCandles(M1), NOW);
    if (isAbsent(dv)) throw new Error(dv.why);
    const z = vwapSigma(CLOSE, dv.vwap, dv.sd);
    expect(z).not.toBeNull();
    expect(vwap.value).toMatchObject({ value: z, unit: 'sigma', badge: 'LIVE', why: null });
  });

  it('poziomy: dzisiejsza Mapa dnia z bloga i VAH, POC, VAL poprzedniej sesji jak Kontekst aukcji, od najwyższej ceny', async () => {
    const { env } = await run(routes());
    const lv = env.data.levels;
    const blog = lv.filter((l) => l.from === 'blog');
    expect(blog.map((l) => [l.label, l.price.value])).toEqual([
      ['Szczyt NY', 101_400],
      ['Wsparcie', 100_500],
    ]);
    for (const l of blog) expect(l).toMatchObject({ labelWhy: null, price: { unit: 'price', badge: 'LIVE' } });
    // W Azji Kontekst aukcji pokazuje zamkniętą NY 6.11, a jej poprzednia sesja to NY 5.11
    const ctx = computeAuctionContext(toVBars(asCandles(M1)), [], NOW);
    expect(ctx.prev).not.toBeNull();
    const va = Object.fromEntries(lv.filter((l) => l.from !== 'blog').map((l) => [l.from, l]));
    expect(va.vah.price).toMatchObject({ value: ctx.prev!.vah, unit: 'price', badge: 'LIVE' });
    expect(va.poc.price.value).toBe(ctx.prev!.poc);
    expect(va.val.price.value).toBe(ctx.prev!.val);
    expect(va.vah.label).toBe('VAH poprz. sesji');
    expect(va.vah.price.note).toContain(new Date(PREV.start).toISOString());
    const prices = lv.map((l) => l.price.value as number);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('sesja: w Azji current null i najbliższe otwarcie (Londyn); koperta z czasem ISO, źródłami i stopką', async () => {
    const { env } = await run(routes());
    expect(env.data.session).toEqual({ current: null, next: 'london', nextOpensAt: '2026-11-07T08:00:00.000Z' });
    expect(env.tool).toBe('market_brief');
    expect(env.asOf).toBe('2026-11-07T06:30:00.000Z');
    expect(env.disclaimer).toBe(DISCLAIMER);
    expect(env.sources.map((s) => s.url)).toEqual([MAPS_URL, LIQ_URL, HL_INFO, HL_INFO]);
    for (const s of env.sources) expect(s.asOf).toMatch(/Z$/);
  });

  it('sesja NY w toku: current ny, Czwórka jak strona w tej chwili, poziomy z Mapy dnia tej doby', async () => {
    const now = Date.UTC(2026, 10, 6, 16, 0);
    const liq = { ...LIQ, asOf: now - 30_000, ctxAt: now - 30_000 };
    const r = routes({ liq: { json: liq }, clock: { now } });
    const { env } = await call(testSources(r, now).src);
    expect(env.data.session).toEqual({ current: 'ny', next: 'london', nextOpensAt: '2026-11-07T08:00:00.000Z' });
    expect(env.data.four.map(shown)).toEqual(fourNumbers(siteInputs(now, liq)).items.map(fromSite));
    expect(env.data.levels.filter((l) => l.from === 'blog').map((l) => l.price.value)).toEqual([102_000, 100_800, 100_300, 99_600]);
  });

  it('Hyperliquid nie odpowiada: cztery liczby „—” z powodem, value null z why, poziomy z bloga zostają, VA null z powodem', async () => {
    const { res, env } = await run(routes({ hl: new Error('ECONNRESET') }));
    expect(res.isError).toBeFalsy();
    for (const i of env.data.four) {
      expect(i.text).toBe('—');
      expect(i.hint).toContain('Hyperliquid');
    }
    const [, fuel, width, vwap] = env.data.four;
    for (const n of [fuel.parts!.below, fuel.parts!.above, width.value!, vwap.value!]) {
      expect(n.value).toBeNull();
      expect(n.why).toContain('Hyperliquid');
    }
    expect(env.data.levels.filter((l) => l.from === 'blog').map((l) => l.price.value)).toEqual([101_400, 100_500]);
    for (const l of env.data.levels.filter((x) => x.from !== 'blog')) {
      expect(l.price.value).toBeNull();
      expect(l.price.why).toContain('Hyperliquid');
    }
    expect(env.sources.filter((s) => s.url === HL_INFO).map((s) => s.asOf)).toEqual([null, null]);
  });

  it('źródła pobierane równolegle: jeden limit czasu na całość, nie suma czterech', async () => {
    // Każda trasa odpowiada dopiero, gdy przyszły wszystkie cztery żądania: pobieranie po kolei czekałoby do limitu czasu
    const seen = new Set<string>();
    let release = () => {};
    const all = new Promise<void>((resolve) => (release = resolve));
    const gate =
      (route: Route): Route =>
      async (req) => {
        seen.add(`${req.url}\n${req.body ?? ''}`);
        if (seen.size >= 4) release();
        await Promise.race([all, new Promise<never>((_, reject) => req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true }))]);
        return typeof route === 'function' ? route(req) : route;
      };
    const base = routes();
    const gated = Object.fromEntries(Object.entries(base).map(([url, r]) => [url, gate(r)]));
    const { res, env } = await run(gated, NOW, { timeoutMs: 2_000 });
    expect(res.isError).toBeFalsy();
    for (const i of env.data.four) expect(i.text).not.toBe('—');
    for (const s of env.sources) expect(s.asOf).not.toBeNull();
  });

  it('migawka skanera sprzed 5 min: paliwo LIVE z wiekiem w note; mapa opóźniona — „opóźnione”', async () => {
    const old = { ...LIQ, asOf: NOW - 5 * MIN, ctxAt: NOW - 5 * MIN };
    const { env } = await run(routes({ liq: { json: old } }));
    const fuel = env.data.four[1];
    expect(fuel).toMatchObject({ badge: 'LIVE', note: '5 min' });
    expect(fuel.text).not.toBe('—');
    expect(fuel.parts?.below).toMatchObject({ badge: 'LIVE' });
    expect(fuel.parts?.below.note).toContain('5 min');
    const delayed = { ...LIQ, ageMin: { ...LIQ.ageMin, ntlP50: 20 } };
    const d = await run(routes({ liq: { json: delayed } }));
    expect(d.env.data.four[1]).toMatchObject({ badge: 'LIVE', note: 'opóźnione' });
    expect(d.env.data.four[1].parts?.above.note).toBe('opóźnione');
  });

  it('brak mapy likwidacji (404): paliwo „—” z powodem strony, liczby null z kodem HTTP', async () => {
    const { res, env } = await run(routes({ liq: { status: 404, json: {} } }));
    expect(res.isError).toBeFalsy();
    const fuel = env.data.four[1];
    expect(fuel).toMatchObject({ text: '—', hint: 'Nie udało się pobrać mapy likwidacji' });
    expect(fuel.parts?.below).toMatchObject({ value: null, why: expect.stringContaining('HTTP 404') });
    expect(env.sources[1]).toMatchObject({ url: LIQ_URL, asOf: null });
  });

  it('brak pliku map z bloga: czytelność bez mapy, bez poziomów z bloga, value area zostaje, powód w uwagach', async () => {
    const { res, env } = await run(routes({ maps: { status: 404, json: {} } }));
    expect(res.isError).toBeFalsy();
    expect(env.data.four[0].text).toBe('trendowy · mapa —');
    expect(env.data.levels.map((l) => l.from)).toEqual(['vah', 'poc', 'val']);
    expect(env.notes.join(' ')).toContain('HTTP 404');
  });

  it('etykieta poziomu z radą: label null z powodem, cena i reszta odpowiedzi bez isError', async () => {
    const { res, env } = await run(routes({ maps: { json: mapsJson(todayMap(['Sell now', 'Wsparcie'])) } }));
    expect(res.isError).toBeFalsy();
    const blog = env.data.levels.filter((l) => l.from === 'blog');
    expect(blog[0]).toMatchObject({ label: null, price: { value: 101_400 } });
    expect(blog[0].labelWhy).toMatch(/^etykieta wstrzymana przez strażnika treści/);
    expect(blog[1]).toMatchObject({ label: 'Wsparcie', labelWhy: null });
    expect(env.data.four).toHaveLength(4);
    expect(JSON.stringify(res)).not.toMatch(/sell now/i);
  });

  it('paliwo w pełnych dolarach: liczby z liqFuel zaokrąglone, tekst karty bez zmian', async () => {
    const odd = { ...LIQ, shorts: LIQ.shorts.map((b) => ({ ...b, ntlUsd: b.ntlUsd + 0.37 })), longs: LIQ.longs.map((b) => ({ ...b, ntlUsd: b.ntlUsd + 0.41 })) };
    const { env } = await run(routes({ liq: { json: odd } }));
    const f = liqFuel(odd, CLOSE);
    expect(Number.isInteger(f.below) || Number.isInteger(f.above)).toBe(false);
    const fuel = env.data.four[1];
    expect(fuel.parts?.below.value).toBe(Math.round(f.below));
    expect(fuel.parts?.above.value).toBe(Math.round(f.above));
    expect(fuel.text).toBe(fourNumbers(siteInputs(NOW, odd)).items[1].value);
  });

  it('trafienie strażnika poza etykietą poziomu (identyfikator wpisu w uwagach): cała odpowiedź zablokowana', async () => {
    const today = { ...todayMap(), id: '2026-11-07-kup-teraz', url: 'blog/2026-11-07-kup-teraz/' };
    const { res } = await run(routes({ maps: { json: mapsJson(today) } }));
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(BLOCK_MARK);
    expect(JSON.stringify(res)).not.toContain('kup-teraz');
  });

  it('etykieta poziomu z adresem: label null z powodem, adresu nie ma w żadnym tekście odpowiedzi', async () => {
    const { res, env } = await run(routes({ maps: { json: mapsJson(todayMap([`opór ${ADDR}`, 'Wsparcie'])) } }));
    expect(res.isError).toBeFalsy();
    expect(env.data.levels.filter((l) => l.from === 'blog').map((l) => l.label)).toEqual([null, 'Wsparcie']);
    expect(JSON.stringify(res)).not.toContain(ADDR);
    expect(JSON.stringify(res)).not.toMatch(/[0-9a-fA-F]{20,}/);
  });
});

// ───────── market_brief z poziomem (level) ─────────

/** VWAP doby UTC ze świec fikstury (jak `dayVwapOf` w narzędziu). */
function fixtureVwap() {
  const dv = dayVwapOf(asCandles(M1), NOW);
  if (isAbsent(dv)) throw new Error(dv.why);
  return dv;
}

/** Żądania fałszywego `fetch` jako zbiór „URL + treść” (świece rozróżnia treść żądania). */
const requests = (calls: { url: string; body: string | null }[]) => calls.map((c) => `${c.url} ${c.body ?? ''}`).sort();

describe('market_brief z poziomem (level)', () => {
  it('poziom nad ceną: odległość od ceny, od VWAP w σ (vwapSigma) i paliwo do poziomu (liqFuel po stronie poziomu)', async () => {
    const level = CLOSE + 1_000;
    const { res, env } = await runLevel({ level });
    expect(res.isError).toBeFalsy();
    const l = env.data.level;
    expect(l?.price).toBe(level);
    expect(l?.fromPrice.usd).toMatchObject({ value: Math.round((level - CLOSE) * 100) / 100, unit: 'usd', badge: 'LIVE', why: null });
    expect(l?.fromPrice.pct).toMatchObject({ value: Math.round((level / CLOSE - 1) * 10_000) / 100, unit: 'pct', badge: 'LIVE', why: null });
    const dv = fixtureVwap();
    const z = vwapSigma(level, dv.vwap, dv.sd);
    expect(z).not.toBeNull();
    expect(l?.vwapDistance).toMatchObject({ value: z, unit: 'sigma', badge: 'LIVE', why: null });
    const f = liqFuel(LIQ, CLOSE, Math.abs(level / CLOSE - 1));
    expect(f.above).toBeGreaterThan(0);
    expect(l?.fuelToLevel).toMatchObject({ value: Math.round(f.above), unit: 'usd', badge: 'LIVE', why: null });
    expect(env.notes.join(' ')).toContain('fuelToLevel');
  });

  it('poziom pod ceną: paliwo z dolnej strony (liqFuel.below), odległości ujemne', async () => {
    const level = CLOSE - 1_500;
    const { env } = await runLevel({ level });
    const l = env.data.level;
    const f = liqFuel(LIQ, CLOSE, Math.abs(level / CLOSE - 1));
    expect(f.below).toBeGreaterThan(0);
    expect(f.below).not.toBe(f.above);
    expect(l?.fuelToLevel).toMatchObject({ value: Math.round(f.below), unit: 'usd', badge: 'LIVE', why: null });
    expect(l?.fromPrice.usd.value).toBeLessThan(0);
    expect(l?.fromPrice.pct.value).toBeLessThan(0);
    const dv = fixtureVwap();
    expect(l?.vwapDistance.value).toBe(vwapSigma(level, dv.vwap, dv.sd));
  });

  it('poziom nie zmienia reszty odpowiedzi i nie dodaje żadnego żądania sieci; bez poziomu brak pola level', async () => {
    const plain = await runLevel({});
    const withLevel = await runLevel({ level: CLOSE + 1_000 });
    expect(plain.env.data).not.toHaveProperty('level');
    expect(withLevel.env.data.four).toEqual(plain.env.data.four);
    expect(withLevel.env.data.levels).toEqual(plain.env.data.levels);
    expect(withLevel.env.data.session).toEqual(plain.env.data.session);
    expect(withLevel.env.sources).toEqual(plain.env.sources);
    expect(requests(withLevel.calls)).toEqual(requests(plain.calls));
  });

  it('poziom dalej niż 20% od ceny: paliwo null z powodem (nigdy 0), odległości zostają', async () => {
    const level = CLOSE * 1.25;
    const { res, env } = await runLevel({ level });
    expect(res.isError).toBeFalsy();
    const l = env.data.level;
    expect(l?.fuelToLevel).toMatchObject({ value: null, badge: null, unit: 'usd' });
    expect(l?.fuelToLevel.why).toContain('20%');
    expect(l?.fromPrice.usd.value).not.toBeNull();
    expect(l?.vwapDistance.value).not.toBeNull();
  });

  it('poziom w 20% od ceny, ale poza zakresem mapy likwidacji: paliwo null z powodem (nigdy 0)', async () => {
    const level = LIQ.markPx * (1 + LIQ_MAP_RANGE) + 1_000;
    expect(Math.abs(level / CLOSE - 1)).toBeLessThan(0.2);
    const { env } = await runLevel({ level });
    const fuel = env.data.level?.fuelToLevel;
    expect(fuel).toMatchObject({ value: null, badge: null });
    expect(fuel?.why).toContain('zakres');
    // Ten sam poziom pod ceną, poza dolną granicą mapy
    const low = LIQ.markPx * (1 - LIQ_MAP_RANGE) - 1_000;
    const below = (await runLevel({ level: low })).env.data.level?.fuelToLevel;
    expect(below).toMatchObject({ value: null, badge: null });
  });

  it('poziom równy cenie: paliwo null z powodem (brak pasma między ceną a poziomem)', async () => {
    const { env } = await runLevel({ level: CLOSE });
    expect(env.data.level?.fuelToLevel).toMatchObject({ value: null, badge: null });
    expect(env.data.level?.fuelToLevel.why).toBeTruthy();
    expect(env.data.level?.fromPrice.usd).toMatchObject({ value: 0, badge: 'LIVE' });
  });

  it('migawka skanera sprzed 5 min: paliwo do poziomu LIVE z wiekiem w note; mapa opóźniona — „opóźnione”', async () => {
    const old = { ...LIQ, asOf: NOW - 5 * MIN, ctxAt: NOW - 5 * MIN };
    const a = await runLevel({ level: CLOSE + 1_000 }, routes({ liq: { json: old } }));
    expect(a.env.data.level?.fuelToLevel).toMatchObject({ badge: 'LIVE' });
    expect(a.env.data.level?.fuelToLevel.note).toContain('5 min');
    const delayed = { ...LIQ, ageMin: { ...LIQ.ageMin, ntlP50: 20 } };
    const d = await runLevel({ level: CLOSE + 1_000 }, routes({ liq: { json: delayed } }));
    expect(d.env.data.level?.fuelToLevel.note).toBe('opóźnione');
  });

  it('brak mapy likwidacji (404): paliwo do poziomu null z kodem HTTP; odległości zostają', async () => {
    const { env } = await runLevel({ level: CLOSE + 1_000 }, routes({ liq: { status: 404, json: {} } }));
    expect(env.data.level?.fuelToLevel).toMatchObject({ value: null, why: expect.stringContaining('HTTP 404') });
    expect(env.data.level?.vwapDistance.value).not.toBeNull();
  });

  it('Hyperliquid nie odpowiada: wszystkie liczby poziomu null z powodem, bez isError', async () => {
    const { res, env } = await runLevel({ level: 101_500 }, routes({ hl: new Error('ECONNRESET') }));
    expect(res.isError).toBeFalsy();
    const l = env.data.level;
    expect(l?.price).toBe(101_500);
    for (const n of [l?.fromPrice.usd, l?.fromPrice.pct, l?.vwapDistance, l?.fuelToLevel]) {
      expect(n?.value).toBeNull();
      expect(n?.why).toContain('Hyperliquid');
    }
  });

  it('walidacja argumentu: zero, liczba ujemna i tekst odrzucone przed pobraniem danych', async () => {
    for (const level of [0, -100, 'abc']) {
      const { res, env, calls } = await runLevel({ level });
      expect(res.isError, String(level)).toBe(true);
      expect(JSON.stringify(res.content), String(level)).toContain('Input validation error');
      expect(env).toBeUndefined();
      expect(calls, String(level)).toEqual([]);
      await close?.();
      close = null;
    }
  });
});
