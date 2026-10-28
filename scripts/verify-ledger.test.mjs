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
    expect(checkMarket(good, candles)).toEqual({ problems: [], checked: 2, eligible: 2, hourFeatures: 0 });
    expect(checkMarket([fr, { k: 'r', id: 'a', c0: 95, c1: 999 }], candles).problems.length).toBe(1);
    // poza zakresem świec — nie sprawdzone (licznik to pokazuje, a nie „✓”)
    expect(checkMarket([{ ...fr, t: T - 10 * 24 * 60 * M }, { k: 'r', id: 'a', c0: 1, c1: 2 }], candles)).toEqual({ problems: [], checked: 0, eligible: 1, hourFeatures: 0 });
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

describe('verify-ledger — model vs rynek (HIP-4)', () => {
  const M = 60_000;
  const T = Date.UTC(2026, 9, 22, 12, 0, 0);
  const fm = { k: 'f', id: `${T}-mkt7`, slot: T, ti: T + 6 * M, t: T + 7 * M, kind: 'mkt', h: 8, outcome: 7, K: 100_000, expiry: T + 15 * M, bid: 0.45, ask: 0.5, liquid: true, p: 0.6 };

  it('checkResolutions: y = [c1 ≥ K], „blisko progu” z c1; brak c1 = problem', () => {
    expect(checkResolutions([fm, { k: 'r', id: fm.id, c1: 100_100, y: 1, near: 0 }])).toEqual([]);
    expect(checkResolutions([fm, { k: 'r', id: fm.id, c1: 100_100, y: 0, near: 0 }]).join(' ')).toMatch(/y/);
    expect(checkResolutions([fm, { k: 'r', id: fm.id, c1: 100_010, y: 1, near: 0 }]).join(' ')).toMatch(/near/);
    expect(checkResolutions([fm, { k: 'r', id: fm.id, y: 1, near: 0 }]).join(' ')).toMatch(/cen źródłowych/);
  });

  it('checkMarket: c1 = zamknięcie świecy 1m kończącej się w terminie', () => {
    const candles = [{ time: T + 14 * M, high: 1, low: 1, close: 100_100 }];
    expect(checkMarket([fm, { k: 'r', id: fm.id, c1: 100_100, y: 1, near: 0 }], candles)).toMatchObject({ problems: [], checked: 1 });
    expect(checkMarket([fm, { k: 'r', id: fm.id, c1: 99_000, y: 0, near: 0 }], candles).problems.length).toBe(1);
  });

  it('checkReceipts: osobne pokwitowanie partii „m” (skrót = hash rekordu rynku), główna partia bez zmian', () => {
    const recs = [
      { k: 'f', id: `${T}-ret60`, slot: T, kind: 'ret', hash: 'aa'.repeat(32) },
      { ...fm, hash: 'cc'.repeat(32) },
    ];
    const digest = (hex) => buildOtsFile(new Uint8Array(Buffer.from(hex, 'hex')), new Uint8Array(16), [new Uint8Array([0xf1, 1, 7, 0x08, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 2, 1, 0x61])]);
    const files = { [`${T}`]: digest('aa'.repeat(32)), [`${T}-m`]: digest('cc'.repeat(32)) };
    expect(checkReceipts(recs, (slot, batch) => files[`${slot}${batch ? `-${batch}` : ''}`] ?? null)).toEqual([]);
    expect(checkReceipts(recs, (slot, batch) => (batch ? null : files[`${slot}`])).join(' ')).toMatch(/brak pokwitowania/);
  });

  it('recompute: Brier modelu i rynku (płynne, z dala od progu)', () => {
    const r = recompute([fm, { k: 'r', id: fm.id, c1: 100_100, y: 1, near: 0 }]);
    expect(r.market.n).toBe(1);
    expect(r.market.brierModel).toBeCloseTo(0.16, 12);
    expect(r.market.brierMarket).toBeCloseTo(0.525 ** 2, 12);
  });
});

describe('verify-ledger — model vs rynek: niezmienniki rekordu i płynność', () => {
  const M = 60_000;
  const T = Date.UTC(2026, 9, 22, 12, 0, 0);
  const base = { k: 'f', id: `${T}-mkt7`, slot: T, ti: T + 6 * M, t: T + 7 * M, kind: 'mkt', h: 8, outcome: 7, K: 100_000, expiry: T + 15 * M, bid: 0.45, ask: 0.5, depthBid: 80, depthAsk: 60, liquid: true, p: 0.6 };
  const res = { k: 'r', id: base.id, c1: 100_100, y: 1, near: 0 };

  it('pasmo „blisko progu” 5 bp', () => {
    expect(checkResolutions([base, { ...res, c1: 100_040, near: 1 }])).toEqual([]);
    expect(checkResolutions([base, { ...res, c1: 100_040, near: 0 }]).join(' ')).toMatch(/near/);
  });
  it('płynność przeliczana ze spreadu i głębokości; t + h = termin = koniec slotu; bid ≤ ask; 0 ≤ p ≤ 1', () => {
    expect(checkResolutions([base, res])).toEqual([]);
    expect(checkResolutions([{ ...base, depthAsk: 10 }, res]).join(' ')).toMatch(/liquid/);
    // Spread równo 5 centów z zapisu 23.10: skaner liczy bez tolerancji (0,553 − 0,503 > 0,05 w liczbach zmiennoprzecinkowych)
    expect(checkResolutions([{ ...base, bid: 0.503, ask: 0.553, liquid: false }, res])).toEqual([]);
    expect(checkResolutions([{ ...base, h: 9 }, res]).join(' ')).toMatch(/termin/);
    expect(checkResolutions([{ ...base, expiry: T + 30 * M, h: 23 }, res]).join(' ')).toMatch(/koniec slotu/);
    expect(checkResolutions([{ ...base, bid: 0.6 }, res]).join(' ')).toMatch(/bid/);
    expect(checkResolutions([{ ...base, p: 1.2 }, res]).join(' ')).toMatch(/p /);
  });
  it('recompute: poziom ścisły i „wąski spread”', () => {
    const thin = { ...base, id: 'b', depthAsk: 5, liquid: false };
    const r = recompute([base, res, thin, { ...res, id: 'b' }]);
    expect(r.market.n).toBe(1);
    expect(r.marketTight.n).toBe(2);
  });
});

import { checkPreregs } from './verify-ledger.mjs';

describe('prerejestracje katalogów (rekordy k = p)', () => {
  const catalog = { version: 'lab-v1', hypotheses: [{ id: 'a', params: { d: 0.01 } }] };
  const hash = hashOf('sha256').update(canonical(catalog)).digest('hex');
  it('hash zgodny z zapisanym katalogiem → bez problemów; lista rejestracji', () => {
    const r = checkPreregs([{ k: 'f', id: 'x' }, { k: 'p', id: 'lab-v1', t: 5, catalogHash: hash, catalog }]);
    expect(r.problems).toEqual([]);
    expect(r.preregs).toEqual([{ id: 'lab-v1', t: 5, catalogHash: hash }]);
  });
  it('katalog zmieniony po zapisie hasha albo brak katalogu → problem', () => {
    const bad = checkPreregs([{ k: 'p', id: 'lab-v1', t: 5, catalogHash: hash, catalog: { ...catalog, version: 'lab-v2' } }]);
    expect(bad.problems.join(' ')).toMatch(/lab-v1.*hash katalogu/);
    expect(checkPreregs([{ k: 'p', id: 'lab-v1', t: 5, catalogHash: hash }]).problems).toHaveLength(1);
  });
  it('prerejestracja z czasem wcześniejszym niż poprzedni rekord łańcucha → problem kolejności', () => {
    const order = checkOrdering([
      { k: 'f', id: 'a', slot: 0, ti: 600_000, t: 660_000, h: 60 },
      { k: 'p', id: 'lab-v1', t: 500_000, catalogHash: hash, catalog },
    ]);
    expect(order.join(' ')).toMatch(/prerejestracja lab-v1: czas cofnięty/);
  });
  it('czas prerejestracji nie może się cofać', () => {
    const r = checkPreregs([
      { k: 'p', id: 'lab-v1', t: 10, catalogHash: hash, catalog },
      { k: 'p', id: 'lab-v2', t: 5, catalogHash: hash, catalog },
    ]);
    expect(r.problems.join(' ')).toMatch(/cofnięty/);
  });
});

import { LAB_HASH, LAB_PREREG } from '../backend/scanner/labRunner.ts';

describe('prerejestracja skanera vs niezależny weryfikator', () => {
  it('rekord skanera (katalog lab-v1) przechodzi kontrolę weryfikatora — ta sama postać kanoniczna', () => {
    const r = checkPreregs([{ k: 'p', t: 1, ...LAB_PREREG }]);
    expect(r.problems).toEqual([]);
    expect(r.preregs[0].catalogHash).toBe(LAB_HASH);
  });
});

import { checkEnsemble } from './verify-ledger.mjs';

describe('ensemble model + rynek w rekordach mkt', () => {
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const lg = (p) => Math.log(Math.min(1 - 1e-4, Math.max(1e-4, p)) / (1 - Math.min(1 - 1e-4, Math.max(1e-4, p))));
  const val = (w, p, mid) => Math.round(sig(w.a + w.bm * lg(p) + w.bk * lg(mid)) * 1e4) / 1e4;
  const mk = (id, ti, ens, rec, peOverride) => {
    const p = 0.62;
    const mid = 0.55;
    return { k: 'f', kind: 'mkt', id, slot: ti, ti, t: ti + 60_000, h: 8, p, bid: 0.54, ask: 0.56, liquid: true, pe: peOverride ?? val(ens, p, mid), ens, pr: val(rec, p, mid), rec };
  };
  const res = (id, t, y = 1) => ({ k: 'r', id, t, y, near: 0, c1: 1 });
  const E = (n) => ({ a: 0, bm: 0.5, bk: 0.5, n });
  const Rc = (n) => ({ a: 0, bm: 0, bk: 1, n });
  it('p_e i p_r zgodne ze wzorem; wagi = ponowne dopasowanie na pytaniach rozstrzygniętych przed wydaniem', () => {
    const r = checkEnsemble([mk('a', 1000, E(0), Rc(0)), res('a', 2000), mk('b', 3000, E(1), Rc(1)), res('b', 4000)], { full: true });
    expect(r).toEqual({ problems: [], checked: 2, refitted: 2 });
  });
  it('p_e niezgodne z wagami → problem; wagi inne niż ponowne dopasowanie (np. z przyszłych wyników) → problem', () => {
    expect(checkEnsemble([mk('a', 1000, E(0), Rc(0), 0.9)], { full: true }).problems.join(' ')).toMatch(/a: p_e/);
    const peek = checkEnsemble([mk('a', 1000, E(0), Rc(0)), mk('b', 1500, E(1), Rc(1)), res('a', 2000)], { full: true });
    expect(peek.problems.join(' ')).toMatch(/b: wagi p_e ≠ ponowne dopasowanie/);
    const forged = checkEnsemble([mk('a', 1000, { a: 0.3, bm: 0.1, bk: 1.4, n: 0 }, Rc(0))], { full: true });
    expect(forged.problems.join(' ')).toMatch(/a: wagi p_e ≠ ponowne dopasowanie/);
    // Tryb szybki (fragment dziennika): tylko wzór
    expect(checkEnsemble([mk('b', 1500, E(1), Rc(1))], { full: false }).problems).toEqual([]);
  });
  it('starsze rekordy bez ensemble są pomijane', () => {
    const { pe, ens, pr, rec, ...old } = mk('a', 1000, E(0), Rc(0));
    expect(checkEnsemble([old], { full: true })).toEqual({ problems: [], checked: 0, refitted: 0 });
  });
});

import { poolProb } from '../src/utils/ensemble.ts';

describe('ensemble: skaner vs niezależny weryfikator', () => {
  it('p_e ze wzoru skanera (poolProb, zaokrąglenie do 4 miejsc) przechodzi kontrolę weryfikatora', () => {
    for (const w of [{ a: 0, bm: 0.5, bk: 0.5, n: 0 }, { a: -0.3, bm: 0.15, bk: 1.4, n: 0 }]) {
      for (const [p, bid, ask] of [[0.0001, 0.01, 0.02], [0.62, 0.54, 0.56], [0.9999, 0.97, 0.99]]) {
        const pe = Math.round(poolProb(w, p, (bid + ask) / 2) * 1e4) / 1e4;
        const r = checkEnsemble([{ k: 'f', kind: 'mkt', id: 'x', ti: 1, p, bid, ask, pe, ens: w }], { full: false });
        expect(r.problems).toEqual([]);
      }
    }
  });
});

import { checkVariants } from './verify-ledger.mjs';
import { AB_EPOCH } from '../src/utils/abTest.ts';

describe('A/B wersji modelu: wariant B = A × skala, skala ze wzoru na zapisanych σ', () => {
  const A = { k: 'f', kind: 'ret', id: '900000-ret60', slot: 900000, ti: 900020, t: 960000, h: 60, px0: 80000, taus: [0.1, 0.5, 0.9], q: [-0.004, 0, 0.004], bq: [-0.005, 0, 0.005], aci: 0.1, model: 'ledger-har-fhs-v1' };
  // √(½ + ½·0,002²·12·1 / σ_A²) = 1,25 ⇔ σ_A² = 2,4·10⁻⁵ / 1,0625
  const B = {
    ...A,
    id: '900000-ret60b',
    variant: 'B',
    model: 'ledger-har-fhs-bocpd-v1',
    scale: 1.25,
    q: [-0.005, 0, 0.005],
    regime: { sigma5: 0.002, run: 30, pChange: 0.01 },
    sigmaA: Math.round(Math.sqrt(2.4e-5 / 1.0625) * 1e8) / 1e8,
    seas: 1,
  };
  it('zgodny wariant B → bez problemów; liczba sprawdzonych', () => {
    expect(checkVariants([A, B])).toEqual({ problems: [], checked: 1 });
  });
  it('kwantyle niezgodne ze skalą, inna chwila wydania albo brak wersji A → problem', () => {
    expect(checkVariants([A, { ...B, q: [-0.006, 0, 0.005] }]).problems.join(' ')).toMatch(/kwantyle ≠ A × skala/);
    expect(checkVariants([A, { ...B, ti: 900021 }]).problems.join(' ')).toMatch(/ti/);
    expect(checkVariants([B]).problems.join(' ')).toMatch(/brak wersji A/);
  });
  it('skala niezgodna ze wzorem z zapisanych σ, poniżej √½, brak σ, zły horyzont lub model → problem', () => {
    const q = (k) => A.q.map((v) => v * k);
    expect(checkVariants([A, { ...B, scale: 1.3, q: q(1.3) }]).problems.join(' ')).toMatch(/skala ≠ wzór/);
    expect(checkVariants([A, { ...B, scale: 0.6, q: q(0.6) }]).problems.join(' ')).toMatch(/skala < √½/);
    expect(checkVariants([A, { ...B, sigmaA: undefined }]).problems.join(' ')).toMatch(/σ_A/);
    const A4 = { ...A, id: '900000-ret240', h: 240 };
    expect(checkVariants([A4, { ...B, id: '900000-ret240b', h: 240 }]).problems.join(' ')).toMatch(/horyzont/);
    expect(checkVariants([A, { ...B, model: 'inny' }]).problems.join(' ')).toMatch(/model/);
  });
  it('recompute: wariant B osobno; okres oceny A/B w toku z parami od AB_EPOCH', () => {
    const recs = [];
    for (let k = 0; k < 4; k++) {
      const slot = AB_EPOCH + k * 900_000;
      const a = { ...A, id: `${slot}-ret60`, slot, ti: slot + 20_000, t: slot + 60_000 };
      const b = { ...B, id: `${slot}-ret60b`, slot, ti: slot + 20_000, t: slot + 60_000 };
      recs.push(a, b, { k: 'r', id: a.id, t: slot + 3_700_000, y: 0.004 }, { k: 'r', id: b.id, t: slot + 3_700_000, y: 0.004 });
    }
    const r = recompute(recs);
    expect(r.ret['60'].n).toBe(4);
    expect(r.ret['60-B'].n).toBe(4);
    expect(r.ab.current).toMatchObject({ start: AB_EPOCH, n: 4, diff: null });
    expect(r.ab.current.crpsA).toBeCloseTo(r.ret['60'].crps, 7);
    expect(r.ab.current.crpsB).toBeCloseTo(r.ret['60-B'].crps, 7);
  });
});

import { checkAbPlan } from './verify-ledger.mjs';
import { AB_DESIGN } from '../src/utils/abTest.ts';
import { createHash } from 'node:crypto';

describe('A/B — recenzja: plan prerejestrowany, okres niepełny, σ_A wiarygodne', () => {
  const TAUS = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
  const normQ = (s) => TAUS.map((t) => s * (t === 0.025 ? -1.96 : t === 0.975 ? 1.96 : (t - 0.5) * 3));
  const mk = (slot, sigmaA, scale = 1) => {
    const a = { k: 'f', kind: 'ret', id: `${slot}-ret60`, slot, ti: slot + 20_000, t: slot + 60_000, h: 60, px0: 80000, taus: TAUS, q: normQ(0.005), bq: normQ(0.006), aci: 0.1, model: 'ledger-har-fhs-v1' };
    const seas = 1;
    const sigma5 = Math.sqrt(((scale ** 2 - 0.5) * 2 * sigmaA ** 2) / 12);
    const b = { ...a, id: `${a.id}b`, variant: 'B', model: 'ledger-har-fhs-bocpd-v1', scale, q: a.q.map((v) => v * scale), regime: { sigma5, run: 10, pChange: 0 }, sigmaA, seas };
    return [a, b];
  };
  const hash = createHash('sha256').update(canonical(AB_DESIGN)).digest('hex');
  it('σ_A niezgodne z rozrzutem kwantyli A (poza [0,5; 2]) → problem; zgodne → bez problemu', () => {
    expect(checkVariants(mk(900000, 0.005)).problems).toEqual([]);
    expect(checkVariants(mk(900000, 0.02)).problems.join(' ')).toMatch(/σ_A niezgodne z kwantylami A/);
  });
  it('plan A/B: zgodny z kodem i przed wariantem B → ok; zmieniony plan albo B przed planem → problem', () => {
    const p = { k: 'p', id: 'ab-v1', t: 1000, catalogHash: hash, catalog: AB_DESIGN };
    const [a, b] = mk(2000, 0.005);
    expect(checkAbPlan([p, a, b])).toMatchObject({ problems: [], registeredAt: 1000 });
    const changed = { ...AB_DESIGN, blockDays: 7 };
    const p2 = { ...p, catalog: changed, catalogHash: createHash('sha256').update(canonical(changed)).digest('hex') };
    expect(checkAbPlan([p2, a, b]).problems.join(' ')).toMatch(/plan A\/B różni się od kodu/);
    expect(checkAbPlan([a, b, { ...p, t: 3_000_000 }]).problems.join(' ')).toMatch(/wariant B przed prerejestracją/);
    expect(checkAbPlan([a]).registeredAt).toBeNull();
  });
  it('recompute w trybie szybkim: okres zaczęty przed pierwszym pobranym dniem oznaczony jako niepełny, bez przedziału; voided bez wariantu B', () => {
    const recs = [];
    for (let k = 0; k < 4; k++) {
      const slot = AB_EPOCH + k * 900_000;
      const [a, b] = mk(slot, 0.005);
      recs.push(a, b, { k: 'r', id: a.id, t: slot + 3_700_000, y: 0.001 }, { k: 'r', id: b.id, t: slot + 3_700_000, void: 'brak świec' });
    }
    const full = recompute(recs);
    expect(full.voided).toBe(0);
    const part = recompute(recs, { since: AB_EPOCH + 3_600_000 });
    expect(part.ab.current).toMatchObject({ partial: true, diff: null });
  });
});

import { plural } from './verify-ledger.mjs';

describe('komunikaty weryfikatora — odmiana liczebników', () => {
  it('1 linia, 2 linie, 5 linii, 12 linii, 22 linie, 112 linii', () => {
    const f = (n) => plural(n, 'linia', 'linie', 'linii');
    expect([1, 2, 5, 12, 22, 112, 0].map(f)).toEqual(['1 linia', '2 linie', '5 linii', '12 linii', '22 linie', '112 linii', '0 linii']);
  });
});

import { checkMarket as checkMarketCat, recompute as recomputeCat } from './verify-ledger.mjs';

describe('verify-ledger — Schrödi (kot)', () => {
  const T = Date.UTC(2026, 9, 22, 21, 1, 0);
  const fc = { k: 'f', id: 'k-cat', kind: 'cat', slot: T - 60_000, t: T, h: 60, thr: 40, pUp: 0.6, pBig: 0.3 };
  const candles = Array.from({ length: 62 }, (_, i) => ({ time: T - 60_000 + i * 60_000, high: 80_010 + i, low: 79_990 + i, close: 80_000 + i }));
  const res = { k: 'r', id: 'k-cat', t: T + 2 * 3_600_000, c0: 80_000, c1: 80_060, hi: 80_070, lo: 79_991, yDir: 1, yBig: 0 };

  it('checkResolutions: wzrost z cen, duży ruch z max/min i progu; brak cen = problem', () => {
    expect(checkResolutions([fc, res])).toEqual([]);
    expect(checkResolutions([fc, { ...res, yDir: 0 }])[0]).toMatch(/yDir/);
    expect(checkResolutions([{ ...fc, thr: 5 }, res])[0]).toMatch(/yBig/);
    expect(checkResolutions([fc, { ...res, hi: undefined }])[0]).toMatch(/brak cen/);
  });
  it('checkMarket: c0, c1 i max/min okna ze świec 1m', () => {
    expect(checkMarketCat([fc, res], candles)).toMatchObject({ problems: [], checked: 1 });
    expect(checkMarketCat([fc, { ...res, hi: 80_100 }], candles).problems).toHaveLength(1);
  });
  it('recompute: Brier i trafność obu głów z cen, nie z zapisanych wyników', () => {
    const r = recomputeCat([fc, { ...res, yDir: 0, yBig: 1 }]);
    expect(r.cat).toMatchObject({ n: 1, hitDir: 1, hitBig: 1 });
    expect(r.cat.brierDir).toBeCloseTo(0.16, 12);
    expect(r.cat.brierBig).toBeCloseTo(0.09, 12);
  });
});
