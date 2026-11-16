import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorSettings } from '../chart/IndicatorSettings';
import { type SmcHigherFeed, SmcLayer, type SmcStyle, smcLegend } from '../chart/smcLayer';
import { SMC_OBJECTS_MAX, SMC_PHONE_OBJECTS_MAX, selectSmc } from '../chart/smcSelect';
import { selectSmcMtf } from '../chart/smcMtfSelect';
import { SMC_HTF_OFF, pickHtf, smcMtf } from '../core/smcMtf';
import { type SBar, smcStructure } from '../core/smcStructure';
import { fmtDayTime } from '../core/time';
import { indicatorDef, indicatorLabel, indicatorsFromLink } from '../indicators/registry';

/** SMC z wyższego interwału w warstwie: legenda (interwał albo powód braku), krzyż nad elementem, limit obiektów, parametr. */

const MIN = 60_000;
const M15 = 15 * MIN;
const H4 = 4 * 60 * MIN;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 10, 16, 0, 0);
const fmt = (p: number) => String(p);
const BANNED = /sygna[łl]|\bsignals?\b|wzrośnie|spadnie|kupuj|sprzedawaj|wejdź|smart money|instytucj|institution|\bbuy\b|\bsell\b/i;

/** Błądzenie losowe z ziarnem (mulberry32). */
function walk(n: number, ms: number, seed = 5): SBar[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: SBar[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.round((o + (rnd() - 0.5) * 1.2) * 100) / 100;
    out.push({ t: T0 + i * ms, o, h: Math.round((Math.max(o, c) + rnd() * 0.3) * 100) / 100, l: Math.round((Math.min(o, c) - rnd() * 0.3) * 100) / 100, c });
  }
  return out;
}

function aggregate(ltf: readonly SBar[], ms: number): SBar[] {
  const out: SBar[] = [];
  for (const x of ltf) {
    const t = Math.floor(x.t / ms) * ms;
    const cur = out[out.length - 1];
    if (!cur || cur.t !== t) out.push({ ...x, t });
    else {
      cur.h = Math.max(cur.h, x.h);
      cur.l = Math.min(cur.l, x.l);
      cur.c = x.c;
    }
  }
  return out;
}

const source = (bars: readonly SBar[]) => bars.map((b) => ({ t: b.t, candle: { ...b, v: 1, n: 1 } }));
const style = (higher: number): SmcStyle => ({ alpha: 1, width: 1, internalLen: 3, swingLen: 10, higher });

/** Warstwa bez wykresu (wybór i legenda): świece wykresu `ms`, świece wyższego interwału z magazynu `feed`. */
function layer(ltf: readonly SBar[], ms: number, higher: number, feed: SmcHigherFeed | null) {
  const l = new SmcLayer(() => style(higher));
  let objects = -1;
  l.onObjects = (n) => (objects = n);
  const now = ltf[ltf.length - 1].t + ms;
  l.setData(source(ltf), ms, now, feed);
  const text = l
    .legend(null, fmt)
    .map((p) => p.text)
    .join(' ');
  return { l, text, objects: () => objects };
}

describe('legenda wyższego interwału', () => {
  const ltf = walk(1600, M15);
  const h4 = aggregate(ltf, H4);

  it('interwał w użyciu (auto) ze stanem struktury obu skal i liczbą otwartych FVG; bez zakazanych słów', () => {
    const { l, text } = layer(ltf, M15, 0, { ms: H4, candles: h4 });
    const s = l.higher()?.sel;
    expect(s).toBeTruthy();
    expect(text).toMatch(/· wyższy interwał 4H \(auto\): wewn\. (wzrostowa \(HH i HL\)|spadkowa \(LH i LL\)|mieszana) · swing\. (wzrostowa|spadkowa|mieszana)[^·]* · FVG \d+/);
    expect(text).toContain(`· FVG ${s?.active.fvg}`);
    // Wiersz wyższego interwału stoi przed brakiem częstości bazowych
    expect(text.indexOf('wyższy interwał')).toBeLessThan(text.indexOf('częstości bazowe'));
    expect(text).not.toMatch(BANNED);
  });

  it('ręczny wybór bez „(auto)”; świece innego interwału (zmiana parametru przed wczytaniem) nie wchodzą', () => {
    expect(layer(ltf, M15, 1440, { ms: DAY, candles: aggregate(ltf, DAY) }).text).toContain('· wyższy interwał 1D: ');
    const stale = layer(ltf, M15, 1440, { ms: H4, candles: h4 });
    expect(stale.text).toContain('· wyższy interwał 1D: czekam na świece 1D…');
    expect(stale.l.higher()?.sel).toBeNull();
  });

  it('powody braku: brak wyższego dla 1D, wyłączony, nie wyższy od wykresu, w drodze, błąd pobrania, za mało świec', () => {
    const d1 = walk(60, DAY);
    expect(layer(d1, DAY, 0, null).text).toContain('· wyższy interwał: —, brak wyższego interwału dla 1D');
    expect(layer(ltf, M15, SMC_HTF_OFF, null).text).toContain('· wyższy interwał: —, wyłączony w parametrach');
    expect(layer(walk(200, 60 * MIN), 60 * MIN, 60, null).text).toContain('· wyższy interwał: —, 1H nie jest wyższy od interwału wykresu 1H');
    expect(layer(ltf, M15, 0, { ms: H4, candles: undefined }).text).toContain('· wyższy interwał 4H (auto): czekam na świece 4H…');
    expect(layer(ltf, M15, 0, { ms: H4, candles: { why: 'Nie udało się pobrać świec 4h' } }).text).toContain('· wyższy interwał 4H (auto): —, Nie udało się pobrać świec 4h');
    const few = ltf.slice(0, 16 * 12);
    expect(layer(few, M15, 0, { ms: H4, candles: aggregate(few, H4) }).text).toMatch(/· wyższy interwał 4H \(auto\): —, za mało zamkniętych świec 4H do struktury \(12 z 30\) · FVG \d+/);
  });

  it('świeca 4H w toku (ostatnia z magazynu) nie wchodzi do modelu warstwy', () => {
    const part = ltf.slice(0, 16 * 50 + 5);
    const { l } = layer(part, M15, 0, { ms: H4, candles: aggregate(part, H4) });
    expect(l.higher()?.sel?.closed).toBe(50);
  });

  it('łączny limit: rysunek wykresu i wyższego interwału razem najwyżej 25 obiektów', () => {
    let max = 0;
    for (let n = 400; n <= ltf.length; n += 50) {
      const part = ltf.slice(0, n);
      const { l, objects } = layer(part, M15, 0, { ms: H4, candles: aggregate(part, H4) });
      expect(objects()).toBeLessThanOrEqual(SMC_OBJECTS_MAX);
      if ((l.higher()?.sel?.fvgs.length ?? 0) > 0) max = Math.max(max, objects());
    }
    expect(max).toBeGreaterThan(0);
  });

  it('telefon: razem najwyżej 10 obiektów; luka wyższego interwału tylko w miejscu, które zostawia rysunek wykresu', () => {
    let shown = 0;
    for (let n = 400; n <= ltf.length; n += 50) {
      const part = ltf.slice(0, n);
      const l = new SmcLayer(() => style(0));
      l.setPhone(true);
      let objects = -1;
      l.onObjects = (k) => (objects = k);
      l.setData(source(part), M15, part[part.length - 1].t + M15, { ms: H4, candles: aggregate(part, H4) });
      const base = l.selection();
      const hs = l.higher()?.sel;
      expect(objects).toBeLessThanOrEqual(SMC_PHONE_OBJECTS_MAX);
      expect(hs?.breaks).toEqual([]);
      expect(hs?.fvgs.length ?? 0).toBeLessThanOrEqual(1);
      if (base && hs && base.labels.length + base.breaks.length + base.fvgs.length < SMC_PHONE_OBJECTS_MAX && hs.active.fvg > 0) expect(hs.fvgs).toHaveLength(1);
      shown += hs?.fvgs.length ?? 0;
    }
    expect(shown).toBeGreaterThan(0);
  });
});

describe('krzyż nad elementem wyższego interwału', () => {
  // Wykres bez własnych elementów (płaskie świece 15m), luka 4H w górę [100,5; 102] znana od zamknięcia świecy 21
  const flat = Array.from({ length: 16 * 30 }, (_, i): SBar => ({ t: T0 + i * M15, o: 101, h: 101.5, l: 100.5, c: 101 }));
  const rows: [number, number, number, number][] = [...Array.from({ length: 20 }, () => [100, 100.5, 99.5, 100] as [number, number, number, number]), [100, 102, 99.8, 101.8], [102.2, 103, 102, 102.8]];
  const h4 = rows.map(([o, h, l, c], i): SBar => ({ t: T0 + i * H4, o, h, l, c }));
  const known = T0 + 22 * H4;
  const asOf = flat[flat.length - 1].t + M15;
  const sel = selectSmc(smcStructure(flat, M15), flat, asOf, { phone: false, history: false });
  const pick = pickHtf(M15, 0);
  const hsel = selectSmcMtf(smcMtf(h4, H4, asOf), asOf, sel.close, { phone: false, room: 25 });
  const text = (t: number, p: number) =>
    smcLegend(sel, M15, { t, p }, fmt, { pick, sel: hsel, why: null })
      .map((x) => x.text)
      .join(' ');

  it('luka 4H: podpis interwału, wypełnienie na zamkniętych świecach 4H i chwila „znana od” (zamknięcie świecy 4H)', () => {
    expect(hsel.fvgs.map((v) => v.f.known)).toEqual([known]);
    expect(text(known + M15, 101)).toContain(`· 4H FVG (luka po ruchu w górę) 100.5–102: wypełnienie 0% na zamkniętych świecach 4H, bez dotknięcia środka luki (CE), znana od ${fmtDayTime(known, asOf)}`);
    // Przed zamknięciem świecy 4H krzyż nic o niej nie dopisuje
    expect(text(known - M15, 101)).not.toContain('4H FVG');
  });
});

describe('parametr „Wyższy interwał”', () => {
  const def = indicatorDef('smc');

  it('lista: auto (domyślnie), wyłączony, 15m, 30m, 1H, 4H, 1D, 1W; w nazwie instancji podpis zamiast liczby', () => {
    const p = def.params.find((x) => x.key === 'higher');
    expect(p).toMatchObject({ def: 0, options: [0, -1, 15, 30, 60, 240, 1440, 10080] });
    expect(p?.options?.map((v) => p.optionLabel?.(v))).toEqual(['auto', 'wył.', '15m', '30m', '1H', '4H', '1D', '1W']);
    expect(indicatorLabel(indicatorsFromLink('smc()')[0])).toBe('SMC+HL 3 10 auto');
    expect(indicatorsFromLink('smc(3,10,240)')[0].params.higher).toBe(240);
    expect(indicatorsFromLink('smc(3,10,-1)')[0].params.higher).toBe(-1);
    expect(indicatorsFromLink('smc(3,10,120)')[0].params.higher).toBe(0);
  });

  it('okno ustawień: wybór z listy z podpisami', () => {
    const html = renderToStaticMarkup(<IndicatorSettings x={indicatorsFromLink('smc()')[0]} loaded={100} chart="5m" onChange={() => {}} onClose={() => {}} />);
    expect(html).toMatch(/<select aria-label="Wyższy interwał"[^>]*><option value="0" selected="">auto<\/option><option value="-1">wył\.<\/option>.*<option value="240">4H<\/option>/);
  });
});
