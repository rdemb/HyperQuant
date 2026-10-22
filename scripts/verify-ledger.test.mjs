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
    const ok = { k: 'r', id: 'a', c0: 100, c1: 100 * Math.exp(0.001), y: 0.001, crps: Math.round(crps * 1e6) / 1e6, in90: 1 };
    expect(checkResolutions([f, ok])).toEqual([]);
    expect(checkResolutions([f, { ...ok, crps: ok.crps * 2 }]).length).toBe(1);
    expect(checkResolutions([f, { ...ok, in90: 0 }]).length).toBe(1);
  });
  it('wynik związany z cenami źródłowymi: y = ln(c1/c0); yv z max/min okna; brak cen = problem', () => {
    const f = { k: 'f', id: 'a', kind: 'ret', h: 60, taus, q, bq: q, aci: 0.1 };
    const base = { k: 'r', id: 'a', c0: 100, c1: 100 * Math.exp(0.001), y: 0.001 };
    expect(checkResolutions([f, base])).toEqual([]);
    expect(checkResolutions([f, { ...base, y: 0.002 }]).join(' ')).toMatch(/ln\(c1\/c0\)/);
    expect(checkResolutions([f, { k: 'r', id: 'a', y: 0.001 }]).join(' ')).toMatch(/cen źródłowych/);
    const ft = { k: 'f', id: 'b', kind: 'touch', h: 120, px0: 100, lv: { pdh: 102, pdl: 97, deq: 99 }, p: { pdh: 0.2, pdl: 0.1, deq: 0.5 } };
    const rt = { k: 'r', id: 'b', hi: 101, lo: 98.5, yv: { pdh: 0, pdl: 0, deq: 1 } };
    expect(checkResolutions([ft, rt])).toEqual([]);
    expect(checkResolutions([ft, { ...rt, yv: { pdh: 1, pdl: 0, deq: 1 } }]).join(' ')).toMatch(/pdh/);
    expect(checkResolutions([ft, { k: 'r', id: 'b', yv: rt.yv }]).join(' ')).toMatch(/cen źródłowych/);
    expect(checkResolutions([f, { k: 'r', id: 'a', void: 'no-data' }])).toEqual([]); // unieważnienie — bez cen
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

import { bitcoinTime, checkMarket, checkOrdering, checkReceipts, otsAttestations } from './verify-ledger.mjs';
import { OTS_MAGIC, varbytes, varuint } from '../backend/scanner/ots.ts';
import { createHash as hashOf } from 'node:crypto';

describe('verify-ledger — kolejność, pokwitowania, Bitcoin, rynek', () => {
  const M = 60_000;
  const S = 15 * M;
  const T = Date.UTC(2026, 9, 22, 12, 0, 0);
  const f = (over = {}) => ({ k: 'f', id: `${T}-ret60`, slot: T, ti: T + 20_000, t: T + M, kind: 'ret', h: 60, ...over });

  it('checkOrdering: poprawna sekwencja bez zastrzeżeń', () => {
    expect(checkOrdering([f(), { k: 'r', id: `${T}-ret60`, t: T + 62 * M }, { k: 's', slot: T + S, reason: 'outage' }])).toEqual([]);
  });
  it('checkOrdering: slot niezgodny z chwilą wydania, t ≠ pełna minuta po wydaniu, duplikat, rozstrzygnięcie przed horyzontem, cofnięty czas', () => {
    expect(checkOrdering([f({ slot: T - S })]).join(' ')).toMatch(/slot/);
    expect(checkOrdering([f({ t: T })]).join(' ')).toMatch(/pełną minutą/);
    expect(checkOrdering([f(), f()]).join(' ')).toMatch(/powtórzon/);
    expect(checkOrdering([f(), { k: 'r', id: `${T}-ret60`, t: T + 30 * M }]).join(' ')).toMatch(/przed końcem horyzontu/);
    expect(checkOrdering([f(), f({ id: 'b', ti: T + 10_000, slot: T, t: T + M })]).join(' ')).toMatch(/cofnięty/);
    expect(checkOrdering([f(), { k: 's', slot: T, reason: 'x' }]).join(' ')).toMatch(/jednocześnie/);
  });

  it('checkReceipts: brak pokwitowania slotu = problem; skrót musi być hashem ostatniej prognozy slotu', () => {
    const recs = [{ ...f(), hash: 'aa'.repeat(32) }, { ...f({ id: `${T}-ret240`, h: 240 }), hash: 'bb'.repeat(32) }];
    const digest = (hex) => buildOtsFile(new Uint8Array(Buffer.from(hex, 'hex')), new Uint8Array(16), [new Uint8Array([0xf1, 1, 7, 0x08, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 2, 1, 0x61])]);
    expect(checkReceipts(recs, () => null).join(' ')).toMatch(/brak pokwitowania/);
    expect(checkReceipts(recs, () => digest('aa'.repeat(32))).join(' ')).toMatch(/skrót/);
    expect(checkReceipts(recs, () => digest('bb'.repeat(32)))).toEqual([]);
  });

  it('otsAttestations: przelicza operacje drzewa do poświadczenia Bitcoin (wysokość bloku i wiadomość)', () => {
    const d = new Uint8Array(32).fill(5);
    const nonce = new Uint8Array(16).fill(1);
    const arg = new Uint8Array([9, 9, 9]);
    const resp = new Uint8Array([0xf0, ...varbytes(arg), 0x08, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, ...varbytes(new Uint8Array(varuint(800_000)))]);
    const att = otsAttestations(buildOtsFile(d, nonce, [resp]));
    const m1 = hashOf('sha256').update(Buffer.concat([Buffer.from(d), Buffer.from(nonce)])).digest();
    const m2 = hashOf('sha256').update(Buffer.concat([m1, Buffer.from(arg)])).digest();
    expect(att).toEqual([{ kind: 'bitcoin', height: 800_000, msg: m2.toString('hex') }]);
  });

  it('otsAttestations: SHA-1, RIPEMD-160, reverse, hexlify (dowody kalendarzy); Keccak — gałąź bez wiadomości', () => {
    const d = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(16).fill(2);
    const btc = [0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, ...varbytes(new Uint8Array(varuint(358_391)))];
    // Plik złożony ręcznie: drzewo z gałęzią SHA-1 → RIPEMD-160 → reverse → hexlify i gałęzią Keccak
    const file = new Uint8Array([...OTS_MAGIC, 0x01, 0x08, ...d, 0xf0, ...varbytes(nonce), 0x08, 0xff, 0x02, 0x03, 0xf2, 0xf3, ...btc, 0x67, ...btc]);
    const att = otsAttestations(file);
    const m0 = hashOf('sha256').update(Buffer.concat([Buffer.from(d), Buffer.from(nonce)])).digest();
    const rip = hashOf('ripemd160').update(hashOf('sha1').update(m0).digest()).digest();
    const want = Buffer.from(Buffer.from(rip).reverse().toString('hex'), 'ascii');
    expect(att).toEqual([
      { kind: 'bitcoin', height: 358_391, msg: want.toString('hex') },
      { kind: 'bitcoin', height: 358_391, msg: null },
    ]);
  });

  it('checkMarket: ceny źródłowe zgodne ze świecami 1m; zmyślone — wykryte', () => {
    const candles = Array.from({ length: 130 }, (_, i) => ({ time: T + i * M, high: 100 + i, low: 90 + i, close: 95 + i }));
    const fr = { k: 'f', id: 'a', kind: 'ret', t: T + M, h: 60 };
    const ft = { k: 'f', id: 'b', kind: 'touch', t: T + M, h: 120 };
    const good = [fr, { k: 'r', id: 'a', c0: 95, c1: 155 }, ft, { k: 'r', id: 'b', hi: 100 + 120, lo: 90 + 1 }];
    expect(checkMarket(good, candles)).toEqual({ problems: [], checked: 2, eligible: 2 });
    expect(checkMarket([fr, { k: 'r', id: 'a', c0: 95, c1: 999 }], candles).problems.length).toBe(1);
    // poza zakresem świec — nie sprawdzone (licznik to pokazuje, a nie „✓”)
    expect(checkMarket([{ ...fr, t: T - 10 * 24 * 60 * M }, { k: 'r', id: 'a', c0: 1, c1: 2 }], candles)).toEqual({ problems: [], checked: 0, eligible: 1 });
    // unieważnienie mimo kompletu świec = problem (wybiórcze pomijanie wyników)
    expect(checkMarket([fr, { k: 'r', id: 'a', void: 'no-data' }], candles).problems.join(' ')).toMatch(/unieważnion/);
  });

  it('checkOrdering: unieważnienie dopiero 6 h po horyzoncie; tryb szybki — rozstrzygnięcia prognoz sprzed pobranych dni', () => {
    const v = (dt) => ({ k: 'r', id: `${T}-ret60`, t: T + M + 60 * M + dt, void: 'no-data' });
    expect(checkOrdering([f(), v(60 * M)]).join(' ')).toMatch(/unieważnienie przed/);
    expect(checkOrdering([f(), v(6 * 60 * M)])).toEqual([]);
    const orphan = { k: 'r', id: `${T - 24 * 60 * M}-ret240`, t: T + 5 * M, c0: 1, c1: 1, y: 0 };
    expect(checkOrdering([orphan]).join(' ')).toMatch(/bez wcześniejszej prognozy/);
    expect(checkOrdering([orphan], { since: T })).toEqual([]);
    expect(checkOrdering([{ ...orphan, id: `${T + S}-ret60` }], { since: T }).join(' ')).toMatch(/bez wcześniejszej prognozy/);
  });

  it('recompute: rekord zakresowy liczony jako wszystkie jego sloty', () => {
    expect(recompute([{ k: 's', slot: T, until: T + 3 * S, reason: 'outage' }, { k: 's', slot: T + 5 * S, reason: 'no-model' }]).skipped).toBe(5);
  });

  it('bitcoinTime: uszkodzony plik .ots → null (bez przerwania całej weryfikacji)', async () => {
    const broken = new Uint8Array([...OTS_MAGIC, 0x01, 0x08, ...new Uint8Array(32), 0x55]);
    await expect(bitcoinTime(broken)).resolves.toBeNull();
  });
});
