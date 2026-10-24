import { describe, expect, it } from 'vitest';
import { isUsableHash, num, parseAssetCtx, parseBook, parseCandle, parseCandles, parseFill, parseFundingHistory, pickAssetCtx } from '../hl/parse';

describe('num', () => {
  it('przyjmuje liczby i tekst liczbowy, resztę zamienia na NaN', () => {
    expect(num('81234.5')).toBe(81234.5);
    expect(num(3)).toBe(3);
    expect(num('')).toBeNaN();
    expect(num('abc')).toBeNaN();
    expect(num(null)).toBeNaN();
    expect(num(Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe('parseFill', () => {
  const raw = {
    coin: 'BTC',
    side: 'B',
    px: '81250.0',
    sz: '0.01234',
    time: 1792850000123,
    hash: '0xabc1',
    tid: 123456789,
    users: ['0x00000000000000000000000000000000000000b1', '0x00000000000000000000000000000000000000a1'],
  };

  it('B = agresywne kupno, biorcą jest kupujący (users[0])', () => {
    expect(parseFill(raw, 'BTC')).toEqual({
      time: 1792850000123,
      px: 81250,
      sz: 0.01234,
      side: 1,
      tid: 123456789,
      hash: '0xabc1',
      taker: '0x00000000000000000000000000000000000000b1',
      maker: '0x00000000000000000000000000000000000000a1',
    });
  });

  it('A = agresywna sprzedaż, biorcą jest sprzedający (users[1]), makerem kupujący', () => {
    const f = parseFill({ ...raw, side: 'A' }, 'BTC');
    expect(f?.side).toBe(-1);
    expect(f?.taker).toBe('0x00000000000000000000000000000000000000a1');
    expect(f?.maker).toBe('0x00000000000000000000000000000000000000b1');
  });

  it('odrzuca inną monetę, nieznaną stronę i niedodatnie wartości', () => {
    expect(parseFill({ ...raw, coin: 'ETH' }, 'BTC')).toBeNull();
    expect(parseFill({ ...raw, side: 'X' }, 'BTC')).toBeNull();
    expect(parseFill({ ...raw, sz: '0' }, 'BTC')).toBeNull();
    expect(parseFill({ ...raw, px: 'x' }, 'BTC')).toBeNull();
    expect(parseFill({ ...raw, tid: undefined }, 'BTC')).toBeNull();
  });

  it('bez pola users biorca jest pusty (zlecenia nie da się złożyć dokładnie)', () => {
    const { users: _u, ...rest } = raw;
    expect(parseFill(rest, 'BTC')?.taker).toBe('');
  });
});

describe('isUsableHash', () => {
  it('hash zerowy (np. TWAP) nie identyfikuje zlecenia', () => {
    expect(isUsableHash('0x' + '0'.repeat(64))).toBe(false);
    expect(isUsableHash('')).toBe(false);
    expect(isUsableHash('0x1f')).toBe(true);
  });
});

describe('parseCandle(s)', () => {
  const c = { t: 1792850000000, T: 1792850059999, s: 'BTC', i: '1m', o: '81000', c: '81010', h: '81020', l: '80990', v: '12.5', n: 321 };

  it('zamienia pola tekstowe na liczby', () => {
    expect(parseCandle(c)).toEqual({ t: 1792850000000, o: 81000, h: 81020, l: 80990, c: 81010, v: 12.5, n: 321 });
  });

  it('odrzuca świecę z high < low albo bez ceny; brak n = NaN', () => {
    expect(parseCandle({ ...c, h: '80000' })).toBeNull();
    expect(parseCandle({ ...c, o: undefined })).toBeNull();
    expect(parseCandle({ ...c, n: undefined })?.n).toBeNaN();
  });

  it('sortuje po czasie i usuwa duplikaty (późniejszy rekord wygrywa)', () => {
    const out = parseCandles([{ ...c, t: 3 }, { ...c, t: 1 }, { ...c, t: 3, c: '81015' }, 'śmieci']);
    expect(out.map((x) => x.t)).toEqual([1, 3]);
    expect(out[1].c).toBe(81015);
    expect(parseCandles(null)).toEqual([]);
  });
});

describe('parseBook', () => {
  it('czyta poziomy z liczbą zleceń n', () => {
    const b = parseBook(
      {
        coin: 'BTC',
        time: 5,
        levels: [
          [{ px: '81000', sz: '1.5', n: 3 }],
          [{ px: '81001', sz: '0.2', n: 1 }],
        ],
      },
      'BTC'
    );
    expect(b).toEqual({ time: 5, bids: [{ px: 81000, sz: 1.5, n: 3 }], asks: [{ px: 81001, sz: 0.2, n: 1 }] });
  });

  it('pusty arkusz albo inna moneta → null', () => {
    expect(parseBook({ coin: 'BTC', time: 5, levels: [[], []] }, 'BTC')).toBeNull();
    expect(parseBook({ coin: 'ETH', time: 5, levels: [[{ px: '1', sz: '1', n: 1 }], []] }, 'BTC')).toBeNull();
  });
});

describe('kontekst rynku', () => {
  const ctx = { funding: '0.0000125', openInterest: '25000.5', oraclePx: '81000', markPx: '81005', midPx: '81004.5', premium: '0.0001', dayNtlVlm: '2500000000', prevDayPx: '80000' };

  it('parseAssetCtx wymaga ceny mark', () => {
    expect(parseAssetCtx(ctx)?.funding).toBeCloseTo(0.0000125);
    expect(parseAssetCtx({ ...ctx, markPx: '0' })).toBeNull();
  });

  it('pickAssetCtx bierze indeks monety z universe', () => {
    const res = [{ universe: [{ name: 'ETH' }, { name: 'BTC' }] }, [{ ...ctx, markPx: '3000' }, ctx]];
    expect(pickAssetCtx(res, 'BTC')?.markPx).toBe(81005);
    expect(pickAssetCtx(res, 'SOL')).toBeNull();
    expect(pickAssetCtx({}, 'BTC')).toBeNull();
  });
});

describe('parseFundingHistory', () => {
  it('sortuje i pomija niepełne punkty', () => {
    const out = parseFundingHistory([
      { coin: 'BTC', fundingRate: '0.00002', premium: '0.0001', time: 2 },
      { coin: 'BTC', fundingRate: 'x', premium: '0', time: 3 },
      { coin: 'BTC', fundingRate: '-0.00001', premium: '0', time: 1 },
    ]);
    expect(out.map((p) => p.time)).toEqual([1, 2]);
    expect(out[0].rate).toBeCloseTo(-0.00001);
  });
});
