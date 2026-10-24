import { describe, expect, it } from 'vitest';
import { Tape } from '../core/tape';

const row = (t: number, px: number, sz: number, side: 1 | -1, tid: number) => ({ t, px, sz, side, tid });

describe('Tape', () => {
  it('trzyma kolejność czasu w minucie, także po wstawieniu spóźnionej transakcji', () => {
    const tape = new Tape();
    tape.insert([row(60_010, 100, 1, 1, 1), row(60_030, 101, 1, -1, 2)]);
    tape.insert([row(60_020, 102, 1, 1, 3)]);
    const seen: number[] = [];
    tape.forEach(60_000, 120_000, (t) => seen.push(t));
    expect(seen).toEqual([60_010, 60_020, 60_030]);
    expect(tape.count).toBe(3);
    expect(tape.lastPx).toBe(101);
  });

  it('odrzuca duplikat tid w tej samej milisekundzie, a różne tid w tej samej ms przyjmuje', () => {
    const tape = new Tape();
    tape.insert([row(1000, 100, 1, 1, 7), row(1000, 100, 2, 1, 8)]);
    const { accepted, touched } = tape.insert([row(1000, 100, 1, 1, 7)]);
    expect(accepted).toHaveLength(0);
    expect(touched.size).toBe(0);
    expect(tape.count).toBe(2);
  });

  it('forEach respektuje granice zakresu [from, to)', () => {
    const tape = new Tape();
    tape.insert([row(59_999, 1, 1, 1, 1), row(60_000, 2, 1, 1, 2), row(119_999, 3, 1, 1, 3), row(120_000, 4, 1, 1, 4)]);
    const px: number[] = [];
    tape.forEach(60_000, 120_000, (_t, p) => px.push(p));
    expect(px).toEqual([2, 3]);
    expect(tape.hasAny(60_000, 120_000)).toBe(true);
    expect(tape.hasAny(180_000, 240_000)).toBe(false);
  });

  it('podpis zmienia się po dopisaniu transakcji w zakresie', () => {
    const tape = new Tape();
    tape.insert([row(1000, 1, 1, 1, 1)]);
    const a = tape.signature(0, 60_000);
    tape.insert([row(2000, 1, 1, 1, 2)]);
    expect(tape.signature(0, 60_000)).not.toBe(a);
    expect(tape.signature(60_000, 120_000)).toBe('0:0');
  });

  it('prune usuwa stare minuty i przelicza licznik', () => {
    const tape = new Tape();
    tape.insert([row(1000, 1, 1, 1, 1), row(61_000, 1, 1, 1, 2), row(125_000, 1, 1, 1, 3)]);
    tape.prune(60_000);
    expect(tape.count).toBe(2);
    expect(tape.firstTime).toBe(61_000);
    expect(tape.minutes()).toEqual([60_000, 120_000]);
  });
});
