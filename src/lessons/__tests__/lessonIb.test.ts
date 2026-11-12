import { describe, expect, it } from 'vitest';
import type { Candle } from '../../charts/pro/hl/parse';
import { type IndicatorBar, initialBalances } from '../../charts/pro/core/indicators';
import { ibLines } from '../chart/model';

const M5 = 300_000;
// 23.10.2026: Nowy Jork 13:30 UTC
const NY = Date.UTC(2026, 9, 23, 13, 30);
const bar = (t: number, c: number): IndicatorBar => ({ t, candle: { t, o: 100, h: Math.max(c, 105), l: Math.min(c, 95), c, v: 1, n: 1 } as Candle });
const bars = (close: (t: number) => number) => Array.from({ length: 48 }, (_, i) => bar(NY + i * M5, close(NY + i * M5)));

describe('rycina lekcji: zakres początkowy jak na wykresie (wspólna zasada z ibSelect)', () => {
  const up = NY + 90 * 60_000 - M5; // świeca zamykająca się o 15:00 (pełne pół godziny)
  const b = bars((t) => (t === up ? 107 : 100));
  const ib = initialBalances(b, M5)[0];

  it('przed pierwszym zamknięciem poza zakresem — tylko szczyt i dołek, bez rozszerzeń', () => {
    expect(ibLines(ib, b, M5, up + 1).map((l) => l.label)).toEqual(['IBH', 'IBL']);
  });

  it('po zamknięciu nad zakresem — rozszerzenia tylko w górę, od chwili tego zamknięcia', () => {
    const lines = ibLines(ib, b, M5, up + M5);
    expect(lines.map((l) => l.label)).toEqual(['IBH', 'IBL', 'IBH +50%', 'IBH +100%']);
    expect(lines.map((l) => l.from)).toEqual([ib.end, ib.end, up + M5, up + M5]);
    expect(lines[2].px).toBe(105 + 0.5 * 10);
  });
});
