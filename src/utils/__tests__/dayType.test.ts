import { describe, expect, it } from 'vitest';
import { classifyDay, vaMigration } from '../dayType';

// IB 100…200 (IBr = 100)
const ib = { ibHi: 200, ibLo: 100 };

describe('classifyDay', () => {
  it('unknown przy IB ≤ 0 albo braku liczb', () => {
    expect(classifyDay({ ibHi: 100, ibLo: 100, hi: 110, lo: 90, close: 100 })).toBe('unknown');
    expect(classifyDay({ ...ib, hi: 210, lo: 100, close: Number.NaN })).toBe('unknown');
  });
  it('neutral, gdy wybito obie strony IB', () => {
    expect(classifyDay({ ...ib, hi: 260, lo: 60, close: 150 })).toBe('neutral');
  });
  it('normal: zakres w IB', () => {
    expect(classifyDay({ ...ib, hi: 190, lo: 110, close: 150 })).toBe('normal');
  });
  it('granica R = 1,15·IBr to jeszcze normal, nieco powyżej — normal-variation', () => {
    expect(classifyDay({ ...ib, hi: 215, lo: 100, close: 160 })).toBe('normal');
    expect(classifyDay({ ...ib, hi: 215.5, lo: 100, close: 160 })).toBe('normal-variation');
  });
  it('trend w górę i w dół: R ≥ 2·IBr i zamknięcie w skrajnych 20%', () => {
    expect(classifyDay({ ...ib, hi: 300, lo: 100, close: 290 })).toBe('trend');
    expect(classifyDay({ ibHi: 200, ibLo: 100, hi: 200, lo: 0, close: 10 })).toBe('trend');
  });
  it('dokładna krawędź 20%: close = hi − 0,2·R to trend, tuż przed nią normal-variation', () => {
    const hi = 300;
    const lo = 100;
    const edge = hi - 0.2 * (hi - lo);
    expect(classifyDay({ ...ib, hi, lo, close: edge })).toBe('trend');
    expect(classifyDay({ ...ib, hi, lo, close: edge - 1e-6 })).toBe('normal-variation');
    // Wybicie w dół: krawędź dolnych 20% to lo + 0,2·R
    const down = { ibHi: 200, ibLo: 100, hi: 200, lo: 0 };
    const edgeDown = down.lo + 0.2 * (down.hi - down.lo);
    expect(classifyDay({ ...down, close: edgeDown })).toBe('trend');
    expect(classifyDay({ ...down, close: edgeDown + 1e-6 })).toBe('normal-variation');
  });
  it('szeroki zakres bez zamknięcia przy skraju — normal-variation', () => {
    expect(classifyDay({ ...ib, hi: 300, lo: 100, close: 200 })).toBe('normal-variation');
    expect(classifyDay({ ...ib, hi: 250, lo: 100, close: 240 })).toBe('normal-variation');
  });
});

describe('vaMigration', () => {
  const prev = { val: 100, vah: 200 };
  it('higher / lower bez nakładania', () => {
    expect(vaMigration({ val: 210, vah: 300 }, prev)).toBe('higher');
    expect(vaMigration({ val: 20, vah: 90 }, prev)).toBe('lower');
  });
  it('overlap-higher / overlap-lower przy częściowym nakładaniu', () => {
    expect(vaMigration({ val: 150, vah: 260 }, prev)).toBe('overlap-higher');
    expect(vaMigration({ val: 40, vah: 150 }, prev)).toBe('overlap-lower');
    expect(vaMigration({ val: 200, vah: 260 }, prev)).toBe('overlap-higher');
  });
  it('brak liczby albo odwrócona value area — unknown', () => {
    expect(vaMigration({ val: Number.NaN, vah: 300 }, prev)).toBe('unknown');
    expect(vaMigration({ val: 120, vah: 180 }, { val: 100, vah: Number.POSITIVE_INFINITY })).toBe('unknown');
    expect(vaMigration({ val: 300, vah: 200 }, prev)).toBe('unknown');
    expect(vaMigration({ val: 120, vah: 180 }, { val: 200, vah: 100 })).toBe('unknown');
  });
  it('inside i outside', () => {
    expect(vaMigration({ val: 120, vah: 180 }, prev)).toBe('inside');
    expect(vaMigration({ val: 50, vah: 250 }, prev)).toBe('outside');
  });
});
