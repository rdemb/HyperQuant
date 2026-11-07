import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pulseTiles } from '../FlowColumn';
import type { FlowColumnData } from '../useFlowColumn';
import type { TwapData } from '../TwapPanel';
import type { WhoData } from '../WhoPanel';

const text = (n: React.ReactNode) => renderToStaticMarkup(<>{n}</>).replace(/<[^>]+>/g, '');

const flow = (usd1m: number): FlowColumnData =>
  ({
    store: { head: {} },
    hist: null,
    pace: { usd1m, buyShare: Number.NaN, median: 50_000, minutes: 58 },
    walls: { fates: [] },
  }) as unknown as FlowColumnData;

const twap = (live: boolean, net: number): TwapData => ({ live, net, known: 0 }) as unknown as TwapData;
const who = null as unknown as WhoData;

describe('Pulse: brak taśmy na żywo to „—” z powodem, prawdziwe zero zostaje', () => {
  it('taśma bez nagrania ostatniej minuty: tempo „—”, nie 0,0×', () => {
    const [, tape] = pulseTiles(flow(Number.NaN), null, true);
    expect(text(tape.value)).toBe('—');
    expect(text(tape.sub)).toContain('brak taśmy na żywo');
    // Nagranie jest, minuta bez transakcji: prawdziwe 0,0×
    const [, quiet] = pulseTiles(flow(0), null, true);
    expect(text(quiet.value)).toBe('0,0×');
  });

  it('TWAP bez taśmy na żywo: „—” z powodem zamiast 0; z taśmą prawdziwe 0 zostaje', () => {
    const off = pulseTiles(flow(Number.NaN), { who, twap: twap(false, 0) }, true)[4];
    expect(text(off.value)).toBe('—');
    expect(text(off.sub)).toContain('brak taśmy na żywo');
    const on = pulseTiles(flow(10_000), { who, twap: twap(true, 0) }, true)[4];
    expect(text(on.value)).toBe('0');
  });
});
