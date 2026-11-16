import { describe, expect, it } from 'vitest';
import { historyDir, historyPath } from '../tapeHistory';
import { dayProfilePath } from '../dayProfile';

const T = Date.UTC(2026, 9, 24, 13, 5, 0);
const D = Date.UTC(2026, 9, 24);

describe('katalog rynku w gałęzi historii (projekt 60, R2)', () => {
  it('rynki desku z konfiguracji, inne bez dwukropka; BTC bez zmian', () => {
    expect(historyDir('BTC')).toBe('BTC');
    expect(historyDir('xyz:GOLD')).toBe('xyz-GOLD');
    expect(historyDir('xyz:SP500')).toBe('xyz-SP500');
    // Spoza konfiguracji: ta sama zamiana co nazwa bazy IndexedDB taśmy
    expect(historyDir('xyz:NVDA')).toBe('xyz-NVDA');
    expect(historyDir('ETH')).toBe('ETH');
  });

  it('ścieżki plików taśmy, arkusza, kontekstu i profilu doby idą przez katalog rynku', () => {
    expect(historyPath('BTC', T, 'trades', true)).toBe('BTC/2026-10-24/13-05.trades.json.gz');
    expect(historyPath('xyz:GOLD', T, 'trades', false)).toBe('xyz-GOLD/2026-10-24/13.trades.json.gz');
    expect(historyPath('xyz:GOLD', T, 'book', true)).toBe('xyz-GOLD/2026-10-24/13-05.book.json.gz');
    expect(historyPath('xyz:SP500', T, 'ctx', false)).toBe('xyz-SP500/2026-10-24/13.ctx.json.gz');
    expect(dayProfilePath('BTC', D)).toBe('BTC/2026-10-24/profile.json.gz');
    expect(dayProfilePath('xyz:SP500', D)).toBe('xyz-SP500/2026-10-24/profile.json.gz');
    for (const p of [historyPath('xyz:GOLD', T, 'trades', true), dayProfilePath('xyz:GOLD', D)]) expect(p).not.toContain(':');
  });
});
