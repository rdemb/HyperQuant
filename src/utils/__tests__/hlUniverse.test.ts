import { describe, expect, it } from 'vitest';
import { chartMarketsOf, parsePerpDexs, universeOf, withUniverse } from '../hlUniverse';

const meta = (universe: unknown[], ctxs: unknown[]) => [{ universe }, ctxs];
const ctx = (markPx: string, oi: string, vol = '1000', funding = '0.0000125', oraclePx?: string) => ({ markPx, openInterest: oi, dayNtlVlm: vol, funding, oraclePx });

describe('uniwersum rynków Hyperliquid', () => {
  it('perpDexs: giełda główna (null) i nazwy HIP-3, bez duplikatów i złych nazw', () => {
    expect(parsePerpDexs([null, { name: 'xyz' }, { name: 'io' }, { name: 'xyz' }, { name: 'a b' }, 7])).toEqual(['', 'xyz', 'io']);
    expect(parsePerpDexs('zła odpowiedź')).toEqual(['']);
  });

  it('giełda główna: wycofane, bez ceny i z obcą nazwą pominięte; OI w USD z ceny mark', () => {
    const raw = meta(
      [
        { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
        { name: 'OLD', szDecimals: 0, maxLeverage: 3, isDelisted: true },
        { name: 'ZERO', szDecimals: 0, maxLeverage: 3 },
        { name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 10 },
      ],
      [ctx('60000', '30000', '3.5e9', '0.0000125', '59990'), ctx('1', '0'), ctx('0', '5'), ctx('180', '100')]
    );
    expect(universeOf('', raw)).toEqual([{ coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, markPx: 60_000, oiUsd: 1.8e9, volume24hUsd: 3.5e9, funding: 0.0000125, oraclePx: 59_990 }]);
  });

  it('giełda HIP-3: tylko nazwy z jej prefiksem; brak finansowania — null', () => {
    const raw = meta(
      [
        { name: 'xyz:TSLA', szDecimals: 3, maxLeverage: 10 },
        { name: 'io:TSLA', szDecimals: 3, maxLeverage: 10 },
      ],
      [{ markPx: '400', openInterest: '10' }, ctx('400', '1')]
    );
    expect(universeOf('xyz', raw)).toEqual([{ coin: 'xyz:TSLA', dex: 'xyz', szDecimals: 3, maxLeverage: 10, markPx: 400, oiUsd: 4000, volume24hUsd: 0, funding: null, oraclePx: null }]);
    expect(universeOf('xyz', null)).toEqual([]);
  });

  it('lista wykresu: rynki uniwersum według OI z poziomem none; rejestr ma pierwszeństwo (poziom skanera, klasa)', () => {
    const uni = chartMarketsOf([
      { coin: 'DOGE', dex: '', szDecimals: 0, maxLeverage: 10, markPx: 0.2, oiUsd: 5e7, volume24hUsd: 0, funding: null, oraclePx: null },
      { coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, markPx: 6e4, oiUsd: 2e9, volume24hUsd: 0, funding: null, oraclePx: null },
    ]);
    expect(uni.map((m) => [m.coin, m.scanner, m.oiUsd7d])).toEqual([
      ['BTC', 'none', 2e9],
      ['DOGE', 'none', 5e7],
    ]);
    const registry = [{ coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, scanner: 'full' as const, class: 'crypto' as const }];
    const merged = withUniverse(registry, uni);
    expect(merged.map((m) => [m.coin, m.scanner])).toEqual([
      ['BTC', 'full'],
      ['DOGE', 'none'],
    ]);
    expect(withUniverse(registry, [])).toBe(registry);
  });
});
