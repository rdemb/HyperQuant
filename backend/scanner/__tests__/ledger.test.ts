import { describe, expect, it } from 'vitest';
import { GENESIS, canonicalJson, makeLine, verifyLines } from '../ledger.ts';

describe('dziennik — kanoniczny JSON i łańcuch hashy', () => {
  it('kanoniczny JSON: klucze posortowane rekurencyjnie, bez spacji', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('linia zawiera prev i hash; hash = sha256(kanoniczny JSON z prev, bez hash); łańcuch weryfikuje się od GENESIS', () => {
    const a = makeLine(GENESIS, { k: 'f', id: 'x', t: 1, h: 60, q: [0.1, -0.2] }); // h = horyzont prognozy, nie pole łańcucha
    const b = makeLine(a.hash, { k: 'r', id: 'x', t: 2, y: 0.01 });
    expect(JSON.parse(a.line)).toMatchObject({ prev: GENESIS, hash: a.hash, h: 60 });
    expect(() => makeLine(GENESIS, { hash: 'x' })).toThrow();
    const v = verifyLines([a.line, b.line], GENESIS);
    expect(v).toEqual({ ok: true, n: 2, head: b.hash, badLine: null });
  });

  it('zmiana jednej liczby wstecz, usunięcie albo zamiana kolejności linii psuje łańcuch', () => {
    const a = makeLine(GENESIS, { k: 'f', id: 'x', t: 1, q: [0.1] });
    const b = makeLine(a.hash, { k: 'r', id: 'x', t: 2, y: 0.01 });
    const c = makeLine(b.hash, { k: 'f', id: 'y', t: 3, q: [0.2] });
    const tampered = a.line.replace('0.1', '0.15');
    expect(verifyLines([tampered, b.line, c.line], GENESIS)).toMatchObject({ ok: false, badLine: 0 });
    expect(verifyLines([a.line, c.line], GENESIS)).toMatchObject({ ok: false, badLine: 1 });
    expect(verifyLines([b.line, a.line], GENESIS)).toMatchObject({ ok: false, badLine: 0 });
    expect(verifyLines(['nie-json'], GENESIS)).toMatchObject({ ok: false, badLine: 0 });
  });
});
