import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { decodeBook, decodeTrades, historyPath } from '../../../src/utils/tapeHistory.ts';
import { dayProfilePath } from '../../../src/utils/dayProfile.ts';
import { MarketRecorder, SETTLE_MS, historyIndex } from '../history.ts';
import type { HlTrade } from '../hl.ts';

/**
 * Atrapa systemu plików bez `:` w nazwach (checkout gałęzi `history` na Windows, projekt 60 R2): każdy zapis, katalog
 * i zmiana nazwy ze ścieżką z dwukropkiem (poza literą dysku) kończy się błędem, jak na NTFS.
 */
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const colon = (p: unknown) => String(p).replace(/^[A-Za-z]:[\\/]/, '').includes(':');
  const guard =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      for (const p of a.slice(0, fn === (fs.renameSync as unknown) ? 2 : 1)) if (colon(p)) throw Object.assign(new Error(`EINVAL: dwukropek w ścieżce ${String(p)}`), { code: 'EINVAL' });
      return fn(...a);
    };
  const mocked = { ...fs, writeFileSync: guard(fs.writeFileSync), mkdirSync: guard(fs.mkdirSync), renameSync: guard(fs.renameSync) };
  return { ...mocked, default: mocked };
});

const T0 = Date.UTC(2026, 9, 24, 13, 0, 0);
const MIN = 60_000;
const A = (k: number) => `0x${String(k).padStart(40, '0')}`;
const HASH = (k: number) => `0x${String(k).padStart(64, '1')}`;
const lv = (px: number, sz: number, n: number) => ({ px: String(px), sz: String(sz), n });
const trade = (coin: string, t: number, tid: number, px: number): HlTrade => ({ coin, side: 'B', px: String(px), sz: '1', time: t, tid, hash: HASH(tid), users: [A(1), A(2)] });

/** Wszystkie ścieżki pod katalogiem (względne). */
function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(join(dir, r)).isDirectory() ? [r, ...walk(dir, r)] : [r];
  });
}

const gz = (dir: string, rel: string) => JSON.parse(gunzipSync(readFileSync(join(dir, rel))).toString('utf8'));

describe('rejestrator historii rynku HIP-3 (xyz:GOLD) na systemie plików bez dwukropka', () => {
  it('części, plik godzinowy, arkusz dokładny i profil doby w katalogu `xyz-GOLD`; spis z kluczem rynku i polem `dir`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hip3-'));
    const r = new MarketRecorder('xyz:GOLD', dir);
    expect(r.exactBook()).toBe(true);
    r.onCtx({ markPx: 3840, oiBtc: 1000, dayNtlVlm: 1e8, funding: 1e-5 }, T0);
    r.onState(true, T0);
    r.onTrades([trade('xyz:GOLD', T0 + 1000, 1, 3840)]);
    r.onTrades([trade('xyz:GOLD', T0 + 2000, 2, 3840.5)]);
    r.onBook(T0 + 3000, [[lv(3840, 1, 1), lv(3839, 2, 2)], [lv(3841, 1, 1)]]); // bliska (krok 1)
    r.onBook(T0 + 4000, [[lv(3840.1, 1, 1), lv(3840, 1, 1)], [lv(3840.3, 1, 1)]]); // dokładny (krok 0,1)
    expect(r.flush(T0 + 5 * MIN + SETTLE_MS)).toBeGreaterThan(0);
    // Godzina zamknięta: części połączone w plik godzinowy
    r.flush(T0 + 60 * MIN + SETTLE_MS);
    const t = decodeTrades(gz(dir, historyPath('xyz:GOLD', T0, 'trades', false)))!;
    expect(t.coin).toBe('xyz:GOLD');
    expect(t.trades.map((x) => x.px)).toEqual([3840, 3840.5]);
    const b = decodeBook(gz(dir, historyPath('xyz:GOLD', T0, 'book', false)))!;
    expect(b.frames.map((f) => [f.step, f.exact ?? false])).toEqual([
      [1, false],
      [0.1, true],
    ]);
    // Profil zamkniętej doby
    expect(r.profiles(T0 + 86_400_000)).toBe(1);
    expect(readdirSync(join(dir, 'xyz-GOLD', '2026-10-24'))).toContain('profile.json.gz');
    expect(dayProfilePath('xyz:GOLD', Date.UTC(2026, 9, 24))).toBe('xyz-GOLD/2026-10-24/profile.json.gz');
    // Żadna nazwa w drzewie nie ma dwukropka
    expect(walk(dir).filter((p) => p.includes(':'))).toEqual([]);
    expect(readdirSync(dir)).toEqual(['xyz-GOLD']);
    // Spis: klucz to nazwa rynku, katalog w polu `dir`; rynek z listy bez katalogu — bez wpisu (R5)
    const idx = historyIndex(dir, ['BTC', 'xyz:GOLD'], 7, T0 + 86_400_000);
    expect(Object.keys(idx.markets)).toEqual(['xyz:GOLD']);
    expect(idx.markets['xyz:GOLD']).toMatchObject({ dir: 'xyz-GOLD', hours: [T0], parts: [], days: [Date.UTC(2026, 9, 24)] });
  });

  it('arkusz dokładny z konfiguracji desku: BTC, złoto i S&P 500 tak; ETH i Brent (wyłączony) nie (R4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hip3-'));
    expect(['BTC', 'xyz:GOLD', 'xyz:SP500', 'ETH', 'xyz:BRENTOIL'].map((c) => new MarketRecorder(c, dir).exactBook())).toEqual([true, true, true, false, false]);
  });
});
