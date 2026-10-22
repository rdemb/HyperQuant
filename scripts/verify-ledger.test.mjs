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
  it('przeliczenie wyników z rekordów (CRPS z kwantyli i zwrotu, nie z zapisu)', () => {
    const taus = [0.05, 0.5, 0.95];
    const f = { k: 'f', id: 'z', kind: 'ret', h: 60, taus, q: [-0.01, 0, 0.01], bq: [-0.02, 0, 0.02] };
    const r = recompute([f, { k: 'r', id: 'z', y: 0, crps: 999, in90: 1 }]);
    expect(r.ret['60'].n).toBe(1);
    expect(r.ret['60'].crps).toBeLessThan(1); // zapisane 999 zignorowane
    expect(r.ret['60'].crpss).toBeGreaterThan(0); // węższy rozkład trafiający y = 0 lepszy od szerszego benchmarku
    expect(r.ret['60'].cov90).toBe(1);
  });
});

import { checkResolutions, otsDigestHex } from './verify-ledger.mjs';
import { buildOtsFile } from '../backend/scanner/ots.ts';

describe('verify-ledger — przeliczanie wyników i pokwitowania', () => {
  const taus = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
  const q = taus.map((t) => (t - 0.5) * 0.02);
  it('zapisany CRPS / pokrycie zgodne z przeliczonymi z (kwantyle, y) → brak rozbieżności; zmieniony → wykryty', () => {
    // CRPS dla y = 0.001 przy tej siatce (trapezy na 2·QS)
    const pin = (qq, y, t) => (y >= qq ? t * (y - qq) : (1 - t) * (qq - y));
    let crps = 0;
    for (let i = 1; i < taus.length; i++) crps += ((pin(q[i - 1], 0.001, taus[i - 1]) + pin(q[i], 0.001, taus[i])) / 2) * (taus[i] - taus[i - 1]);
    crps *= 2;
    const f = { k: 'f', id: 'a', kind: 'ret', h: 60, taus, q, bq: q, aci: 0.1 };
    const ok = { k: 'r', id: 'a', y: 0.001, crps: Math.round(crps * 1e6) / 1e6, in90: 1 };
    expect(checkResolutions([f, ok])).toEqual([]);
    expect(checkResolutions([f, { ...ok, crps: ok.crps * 2 }]).length).toBe(1);
    expect(checkResolutions([f, { ...ok, in90: 0 }]).length).toBe(1);
  });
  it('otsDigestHex odczytuje skrót z pliku .ots (nagłówek, wersja, sha256)', () => {
    const digest = new Uint8Array(32).fill(9);
    const resp = new Uint8Array([0xf1, 4, 1, 1, 1, 1, 0x08, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 3, 2, 0x61, 0x62]);
    expect(otsDigestHex(buildOtsFile(digest, new Uint8Array(16), [resp]))).toBe('09'.repeat(32));
    expect(otsDigestHex(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('linia niekanoniczna (inna kolejność kluczy) jest wykrywana mimo poprawnego hasha treści', () => {
    const a = makeLine(GENESIS, { k: 'f', id: 'x', t: 1 });
    const o = JSON.parse(a.line);
    const reordered = JSON.stringify({ t: o.t, k: o.k, id: o.id, prev: o.prev, hash: o.hash });
    expect(verifyChain([reordered], GENESIS)).toMatchObject({ ok: false, reason: expect.stringMatching(/kanoniczn/) });
  });
});
