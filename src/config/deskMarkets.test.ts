import { describe, expect, it } from 'vitest';
import { DESK_MARKETS, ENABLED_MARKETS, deskLabels, deskMarketOf, deskPhrase, marketLabel } from './deskMarkets';
import { APP_MARKETS, DEFAULT_MARKETS } from '../utils/marketRegistry';

describe('rynki desku', () => {
  it('każdy wpis ma komplet pól, bezpieczny slug i katalog historii bez dwukropka', () => {
    for (const m of DESK_MARKETS) {
      expect(m.slug).toMatch(/^[a-z0-9-]+$/);
      expect(m.historyDir).not.toContain(':');
      expect(m.coin.startsWith(m.dex ? `${m.dex}:` : '')).toBe(true);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.quality.markOracleOkBp).toBeLessThan(m.quality.markOracleBadBp);
      expect(m.quality.spreadOkBp).toBeLessThan(m.quality.spreadBadBp);
    }
  });

  it('włączone: BTC, złoto i S&P 500; Brent wyłączony', () => {
    expect(ENABLED_MARKETS.map((m) => m.coin)).toEqual(['BTC', 'xyz:GOLD', 'xyz:SP500']);
    expect(deskMarketOf('xyz:BRENTOIL')?.enabled).toBe(false);
  });

  it('rynki aplikacji pochodzą z konfiguracji', () => {
    expect(APP_MARKETS.map((m) => m.coin)).toEqual(ENABLED_MARKETS.map((m) => m.coin));
    expect(APP_MARKETS.find((m) => m.coin === 'xyz:SP500')).toMatchObject({ dex: 'xyz', szDecimals: 3, maxLeverage: 50, scanner: 'none', class: 'index' });
    // Lista domyślna rejestru zostaje osobna (rynki skanera i pomiaru)
    expect(DEFAULT_MARKETS[0].coin).toBe('BTC');
  });

  it('fraza z nazw: 1, 2 i 3 rynki, oba przypadki i angielski', () => {
    const [btc, gold, sp] = ENABLED_MARKETS;
    expect(deskPhrase('pl', 'nom', [btc])).toBe('BTC');
    expect(deskPhrase('pl', 'nom', [btc, gold])).toBe('BTC i złoto');
    expect(deskPhrase('pl', 'nom')).toBe('BTC, złoto i S&P 500');
    expect(deskPhrase('pl', 'gen')).toBe('BTC, złota i S&P 500');
    expect(deskPhrase('en')).toBe('BTC, gold and the S&P 500');
    expect(deskPhrase('en', 'nom', [btc, sp])).toBe('BTC and the S&P 500');
    expect(deskLabels()).toBe('BTC · GOLD · S&P 500');
  });

  it('etykieta rynku: z konfiguracji albo bez przedrostka giełdy', () => {
    expect(marketLabel('xyz:SP500')).toBe('S&P 500');
    expect(marketLabel('xyz:NVDA')).toBe('NVDA');
    expect(marketLabel('ETH')).toBe('ETH');
  });
});
