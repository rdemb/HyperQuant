import { describe, expect, it } from 'vitest';
import { buildEntryMap, isEntryMap } from '../entryMap';
import type { ScannedPosition } from '../liqMap';

const NOW = Date.UTC(2026, 10, 15, 9);
const pos = (szi: number, entryPx: number, liqPx: number | null = null, ageMin = 1): ScannedPosition => ({ szi, entryPx, liqPx, scannedAt: NOW - ageMin * 60_000 });
const opts = { coin: 'BTC', markPx: 64_000, oiBtc: 100, asOf: NOW, addresses: 7 };

describe('mapa uwięzionych pozycji', () => {
  it('kubełki cen wejścia co ~0,25% ceny, osobno longi i shorty, ważone wartością wejścia', () => {
    const m = buildEntryMap([pos(1, 64_150), pos(2, 64_190), pos(3, 64_100), pos(-1, 63_000)], opts);
    expect(m.stepUsd).toBe(200);
    // Trzy longi w kubełku 64 000–64 200: dokładna wartość (n = 3)
    expect(m.longs).toEqual([{ px: 64_000, ntlUsd: 64_150 + 2 * 64_190 + 3 * 64_100, n: 3 }]);
    // Jeden short: wartość zaokrąglona do 2 cyfr znaczących (prywatność pojedynczej pozycji)
    expect(m.shorts).toEqual([{ px: 63_000, ntlUsd: 63_000, n: 1 }]);
  });

  it('pod wodą: long z wejściem nad ceną, short z wejściem pod ceną; udział strony ważony wartością', () => {
    const m = buildEntryMap([pos(1, 66_000), pos(1, 62_000), pos(-2, 60_000), pos(-1, 65_000)], opts);
    expect(m.long.underwaterUsd).toBe(66_000);
    expect(m.long.underwaterShare).toBeCloseTo(66_000 / 128_000, 10);
    expect(m.short.underwaterUsd).toBe(120_000);
    expect(m.short.underwaterShare).toBeCloseTo(120_000 / 185_000, 10);
  });

  it('odległość do likwidacji w % ceny, kwartyle ważone wartością; nieaktualny odczyt po złej stronie pominięty', () => {
    const m = buildEntryMap([pos(1, 64_000, 57_600), pos(1, 64_000, 60_800), pos(1, 64_000, 65_000), pos(-1, 64_000, 70_400)], opts);
    expect(m.long.liqDistPct).toEqual({ p25: 5, p50: 5, p75: 10 });
    expect(m.short.liqDistPct).toEqual({ p25: 10, p50: 10, p75: 10 });
    expect(buildEntryMap([pos(1, 64_000, null)], opts).long.liqDistPct).toBeNull();
  });

  it('wejścia poza zakresem ±15% liczą się do wartości i „pod wodą”, ale nie do kubełków; pokrycie jak w mapie likwidacji', () => {
    const m = buildEntryMap([pos(1, 90_000), pos(1, 64_000)], opts);
    expect(m.longs).toHaveLength(1);
    expect(m.long.outsideUsd).toBe(90_000);
    expect(m.long.underwaterUsd).toBe(90_000);
    expect(m.coverage).toMatchObject({ positions: 2, addresses: 7, scannedBtc: 2, oiBtc: 100, share: 0.01 });
  });

  it('w pliku tylko agregaty: żadnych pól pozycji ani adresów; walidacja kształtu', () => {
    const m = buildEntryMap([pos(1, 64_000), pos(-1, 63_000)], opts);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/szi|entryPx|liqPx|scannedAt|0x[0-9a-f]{6}/i);
    expect(isEntryMap(JSON.parse(json))).toBe(true);
    expect(isEntryMap({ ...m, longs: [{ px: 1 }] })).toBe(false);
    expect(isEntryMap(null)).toBe(false);
  });
});
