// Weryfikacja krzyżowa: linie z modułu skanera (backend/scanner/ledger.ts) sprawdzane niezależnym skryptem dla użytkowników.
import { describe, expect, it } from 'vitest';
import { GENESIS, makeLine } from '../backend/scanner/ledger.ts';
import { canonical, recompute, verifyChain } from './verify-ledger.mjs';

describe('verify-ledger — niezależna implementacja zgodna ze skanerem', () => {
  const a = makeLine(GENESIS, { k: 'f', id: 'x', t: 1, kind: 'ret', h: 60, q: [0.1, -0.2] });
  const b = makeLine(a.hash, { k: 'r', id: 'x', t: 2, y: 0.01, crps: 0.002, crpsB: 0.004, in90: 1 });

  it('ten sam kanoniczny JSON', () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 1 }] })).toBe('{"a":[{"c":1,"d":2}],"b":1}');
  });
  it('łańcuch ze skanera przechodzi; zmiana treści albo kolejności — nie', () => {
    expect(verifyChain([a.line, b.line], GENESIS)).toMatchObject({ ok: true, head: b.hash });
    expect(verifyChain([a.line.replace('0.1', '0.3'), b.line], GENESIS)).toMatchObject({ ok: false, badLine: 0 });
    expect(verifyChain([b.line, a.line], GENESIS)).toMatchObject({ ok: false, badLine: 0 });
  });
  it('przeliczenie wyników z rekordów', () => {
    const r = recompute([JSON.parse(a.line), JSON.parse(b.line)]);
    expect(r.ret['60']).toMatchObject({ n: 1, crps: 0.002, cov90: 1 });
    expect(r.ret['60'].crpss).toBeCloseTo(0.5, 9);
  });
});
