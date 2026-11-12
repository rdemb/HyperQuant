// Weryfikacja krzyżowa: linie z modułu skanera (backend/scanner/ledger.ts) sprawdzane niezależnym skryptem dla użytkowników.
import { afterEach, describe, expect, it, vi } from 'vitest';
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

import { EXPLORERS, bitcoinTime, checkMarket, checkOrdering, checkReceipts, otsAttestations } from './verify-ledger.mjs';
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

  describe('bitcoinTime: dwa eksploratory muszą podać ten sam blok', () => {
    afterEach(() => vi.unstubAllGlobals());
    const d = new Uint8Array(32).fill(3);
    const nonce = new Uint8Array(16).fill(4);
    // Plik złożony ręcznie: poświadczenie Bitcoin wprost na SHA-256(skrót ‖ nonce) na wysokości `height`
    const ots = (height) =>
      new Uint8Array([...OTS_MAGIC, 0x01, 0x08, ...d, 0xf0, ...varbytes(nonce), 0x08, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, ...varbytes(new Uint8Array(varuint(height)))]);
    // Eksplorator zapisuje korzeń Merkle w odwrotnej kolejności bajtów
    const root = Buffer.from(hashOf('sha256').update(Buffer.concat([Buffer.from(d), Buffer.from(nonce)])).digest()).reverse().toString('hex');
    const TS = 1_790_000_000;
    /** Eksplorator `base`: `blk(height)` → { hash, merkle_root, timestamp } albo null (niedostępny). */
    const stub = (byBase) =>
      vi.stubGlobal('fetch', async (url) => {
        const base = EXPLORERS.find((b) => url.startsWith(b));
        const m = /block-height\/(\d+)$/.exec(url);
        const blk = byBase[base](m ? Number(m[1]) : Number(url.split('/').pop().split('-')[1]));
        if (!blk) return new Response('down', { status: 503 });
        return m ? new Response(`${blk.hash}\n`) : new Response(JSON.stringify(blk));
      });
    const honest = (h) => ({ hash: `blk-${h}`, merkle_root: root, timestamp: TS });

    it('zgodne: czas bloku', async () => {
      stub({ [EXPLORERS[0]]: honest, [EXPLORERS[1]]: honest });
      await expect(bitcoinTime(ots(900_001))).resolves.toBe(TS * 1000);
    });
    it('drugi podaje inny korzeń Merkle albo inny hash: brak czasu', async () => {
      stub({ [EXPLORERS[0]]: honest, [EXPLORERS[1]]: (h) => ({ ...honest(h), merkle_root: 'ff'.repeat(32) }) });
      await expect(bitcoinTime(ots(900_002))).resolves.toBeNull();
      stub({ [EXPLORERS[0]]: honest, [EXPLORERS[1]]: (h) => ({ ...honest(h), hash: 'inny' }) });
      await expect(bitcoinTime(ots(900_003))).resolves.toBeNull();
    });
    it('drugi niedostępny: brak czasu (jeden eksplorator nie wystarcza)', async () => {
      stub({ [EXPLORERS[0]]: honest, [EXPLORERS[1]]: () => null });
      await expect(bitcoinTime(ots(900_004))).resolves.toBeNull();
    });
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

import { catFileReader, checkGitAppendOnly } from './verify-ledger.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Klon gałęzi ledger w miniaturze: kroki → commity (stały autor i czas — wynik nie zależy od zegara ani konfiguracji).
 * Zwraca katalog i hashe commitów w kolejności. `into` — dopisz commity do istniejącego repo (bez `git init`).
 */
function ledgerRepo(steps, into = null) {
  const dir = into ?? mkdtempSync(path.join(tmpdir(), 'hq-ledger-git-'));
  const git = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-22T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-22T00:00:00Z' },
    }).trim();
  if (!into) git('init', '-q');
  mkdirSync(path.join(dir, 'BTC', 'ots'), { recursive: true });
  const commits = [];
  steps.forEach((step, i) => {
    step(path.join(dir, 'BTC'));
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', `dziennik ${i}`);
    commits.push(git('rev-parse', 'HEAD'));
  });
  return { dir, commits };
}

const day1 = (d) => path.join(d, '2026-10-22.jsonl');
const day2 = (d) => path.join(d, '2026-10-23.jsonl');
const appendOnly = [
  (d) => writeFileSync(day1(d), '{"n":1}\n'),
  (d) => appendFileSync(day1(d), '{"n":2}\n'),
  (d) => {
    appendFileSync(day1(d), '{"n":3}\n');
    writeFileSync(path.join(d, 'ots', '2026-10-22.jsonl.ots'), 'x');
  },
  (d) => writeFileSync(day2(d), '{"n":4}\n'),
  (d) => appendFileSync(day2(d), '{"n":5}\n{"n":6}\n'),
];

// Prawdziwe repo git w katalogu tymczasowym — dziesiątki procesów git (na Windows ~60 ms każdy), stąd dłuższy limit
describe('historia git (--dir): tylko dopisywanie, cała historia, kotwica ostatniej weryfikacji', { timeout: 60_000 }, () => {
  const dirs = [];
  const repo = (steps) => {
    const r = ledgerRepo(steps);
    dirs.push(r.dir);
    return r;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('historia tylko dopisująca: zawsze cała historia; kotwica z historii gałęzi → zielono', async () => {
    const { dir, commits } = repo(appendOnly);
    const plain = await checkGitAppendOnly(dir);
    expect(plain).toMatchObject({ commits: 5, checked: 4, anchor: null, problems: [] });
    for (const anchor of commits) expect(await checkGitAppendOnly(dir, { anchor })).toEqual({ ...plain, anchor });
  });

  it('zmiana zapisanej linii i usunięcie pliku: problemy z całej historii, także przed kotwicą', async () => {
    const { dir, commits } = repo([
      ...appendOnly,
      (d) => writeFileSync(day1(d), '{"n":1}\n{"n":20}\n{"n":3}\n'),
      (d) => rmSync(day2(d)),
      (d) => writeFileSync(day1(d), '{"n":1}\n{"n":20}\n{"n":3}\n{"n":7}\n'),
    ]);
    const want = [`${commits[5].slice(0, 10)}: zmieniono zapisane linie w BTC/2026-10-22.jsonl`, `${commits[6].slice(0, 10)}: usunięto BTC/2026-10-23.jsonl`];
    expect((await checkGitAppendOnly(dir)).problems).toEqual(want);
    // kotwica po naruszeniach nie skraca kontroli
    expect((await checkGitAppendOnly(dir, { anchor: commits[7] })).problems).toEqual(want);
  });

  it('przepisana historia (sama w sobie tylko dopisująca): kotwica spoza historii → problem mimo pełnej kontroli', async () => {
    const { dir, commits } = repo(appendOnly);
    const anchor = commits[4]; // ostatnio zweryfikowany commit
    execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=false', 'reset', '-q', '--hard', commits[1]]);
    ledgerRepo([(d) => appendFileSync(day1(d), '{"n":30}\n'), (d) => writeFileSync(day2(d), '{"n":40}\n')], dir);
    const plain = await checkGitAppendOnly(dir);
    expect(plain.problems).toEqual([]); // nowa historia jest spójna — bez kotwicy podmiana niewidoczna
    const r = await checkGitAppendOnly(dir, { anchor });
    expect(r.checked).toBe(plain.checked); // cała historia sprawdzona
    expect(r.problems).toEqual([`kotwica ${anchor.slice(0, 10)} (ostatnio zweryfikowany commit): brak w historii gałęzi — historia przepisana`]);
  });

  it('plik dopisany bez końcowego znaku nowej linii: dopisanie dalej jest dopisaniem (porównanie bajtów)', async () => {
    const { dir } = repo([(d) => writeFileSync(day1(d), '{"n":1}'), (d) => appendFileSync(day1(d), '\n{"n":2}\n')]);
    expect((await checkGitAppendOnly(dir)).problems).toEqual([]);
  });

  // Stała pamięć względem długości historii: bloby porównywane parami (stara, nowa wersja pliku) i od razu zwalniane
  const LINE = `{"x":"${'a'.repeat(2000)}"}\n`;
  const growing = (n) => Array.from({ length: n }, (_, i) => (d) => (i === 0 ? writeFileSync(day1(d), LINE) : appendFileSync(day1(d), LINE)));

  it('pełny przebieg: czytnik git cat-file trzyma naraz najwyżej bloby jednej pary, nie wszystkie wersje', async () => {
    const N = 40;
    const { dir } = repo(growing(N));
    const reader = catFileReader(dir);
    const r = await checkGitAppendOnly(dir, { reader });
    await reader.close();
    expect(r.problems).toEqual([]);
    const st = reader.stats();
    expect(st.pairs).toBe(N - 1);
    const L = Buffer.byteLength(LINE);
    const largestPair = (N - 1) * L + N * L;
    expect(st.peakBytes).toBeGreaterThanOrEqual(largestPair);
    expect(st.peakBytes).toBeLessThanOrEqual(largestPair + 256); // + nagłówki odpowiedzi git
    expect(st.totalBytes).toBe((N - 1) * (N + 1) * L); // przeczytane łącznie ~20 × więcej niż szczyt
  });

  it('pary porównywane po kolei: wstrzyknięty czytnik nigdy nie ma więcej niż jednej wypożyczonej pary', async () => {
    const { dir } = repo(growing(12));
    const real = catFileReader(dir);
    let live = 0;
    let maxLive = 0;
    let lent = 0;
    const reader = {
      pair: (a, b, fn) => {
        maxLive = Math.max(maxLive, ++live);
        return real.pair(a, b, (x, y) => {
          lent++;
          try {
            return fn(x, y);
          } finally {
            live--;
          }
        });
      },
      close: () => real.close(),
    };
    const r = await checkGitAppendOnly(dir, { reader });
    await real.close();
    expect(r.problems).toEqual([]);
    expect(lent).toBe(11);
    expect(maxLive).toBe(1);
  });
});

import { TAUS, benchQuantiles, buildSummary } from '../backend/scanner/forecaster.ts';

describe('verify-ledger — BSS dotknięć wobec bazy odległości przeliczony niezależnie', () => {
  it('Brier bazy odległości (wzór odbicia, σ godzinowa z bq prognozy 1 h tego slotu) i bssDist zgodne z podsumowaniem skanera', () => {
    const T = Date.UTC(2026, 10, 2);
    const recs = [];
    for (let i = 0; i < 40; i++) {
      const slot = T + i * 15 * 60_000;
      const s1h = 0.003 + 0.0001 * i;
      recs.push({ k: 'f', id: `${slot}-ret60`, slot, ti: slot, t: slot, kind: 'ret', h: 60, px0: 100_000, taus: TAUS, q: benchQuantiles(s1h, 60), bq: benchQuantiles(s1h, 60).map((x) => Math.round(x * 1e6) / 1e6), aci: 0.1, model: 'x' });
      const p = { pdh: 0.3, pdl: i % 3 === 0 ? null : 0.2, deq: 0.6 };
      recs.push({ k: 'f', id: `${slot}-touch120`, slot, ti: slot, t: slot, kind: 'touch', h: 120, px0: 100_000, lv: { pdh: 100_800 + 10 * i, pdl: 99_000, deq: 99_900 }, p, model: 'x' });
      recs.push({ k: 'r', id: `${slot}-touch120`, t: slot + 7_200_000, hi: 0, lo: 0, yv: { pdh: i % 4 === 0 ? 1 : 0, pdl: 0, deq: i % 2 } });
    }
    const t = recompute(recs).touch;
    const fs = new Map(recs.filter((o) => o.k === 'f').map((o) => [o.id, o]));
    const rs = new Map(recs.filter((o) => o.k === 'r').map((o) => [o.id, o]));
    const s = buildSummary({ coin: 'BTC', now: T + 20 * 3_600_000, head: { hash: 'h', lines: 1 }, forecasts: fs, resolutions: rs, aci: {}, ots: [] }).scores.touch;
    expect(t.levelsDist).toBe(s.pairsDist);
    expect(t.brierDist).toBeCloseTo(s.brierDist, 6);
    expect(t.bssDist).toBeCloseTo(s.bssDist, 6);
  });

});

import { checkMeasures, measures } from './verify-ledger.mjs';
import { crpsQuantiles, pitFromQuantiles, quantileAt as qAt } from '../src/utils/forecastScore.ts';
import { trustHour } from '../src/utils/schrodiTrust.ts';
import { mulberry32 as rng } from '../src/utils/pathEngine.ts';

describe('miary podsumowania (Kupiec 60%, PIT, przedziały z bootstrapu po dobach, ACI, BSS sezonowy): skaner vs weryfikator', () => {
  const H = 3_600_000;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  /** 12 dób dziennika: zwroty 1 h i 4 h co 15 min, dotknięcia co godzinę, kot co 15 min (pełne godziny = baza sezonowa) */
  function ledgerOf() {
    const u = rng(7);
    const T = Date.UTC(2026, 9, 20);
    const bodies = [];
    for (let slot = T; slot < T + 12 * 24 * H; slot += 15 * 60_000) {
      const s1h = 0.003 + 0.002 * u();
      for (const h of [60, 240]) {
        const q = benchQuantiles(s1h * (0.8 + 0.4 * u()), h).map(r6);
        const f = { k: 'f', id: `${slot}-ret${h}`, slot, ti: slot, t: slot, kind: 'ret', h, px0: 100_000, taus: TAUS, q, bq: benchQuantiles(s1h, h).map(r6), aci: u() < 0.05 ? -0.01 : r4(0.05 + 0.1 * u()), model: 'x' };
        const y = r6((u() - 0.5) * 4 * s1h * Math.sqrt(h / 60));
        const inside = (lo, hi) => (y >= qAt(TAUS, q, lo) && y <= qAt(TAUS, q, hi) ? 1 : 0);
        bodies.push(f, { k: 'r', id: f.id, t: slot + h * 60_000, c0: 100_000, c1: r6(100_000 * Math.exp(y)), y, crps: r6(crpsQuantiles(TAUS, q, y)), crpsB: r6(crpsQuantiles(TAUS, f.bq, y)), pit: r4(pitFromQuantiles(TAUS, q, y)), in90: inside(0.05, 0.95), in60: inside(0.2, 0.8), inAci: 1 });
      }
      if (slot % H === 0) {
        const p = { pdh: r4(0.1 + 0.5 * u()), pdl: u() < 0.2 ? null : r4(0.1 + 0.5 * u()), deq: r4(0.3 + 0.5 * u()) };
        const f = { k: 'f', id: `${slot}-touch120`, slot, ti: slot, t: slot, kind: 'touch', h: 120, px0: 100_000, lv: { pdh: 100_400 + Math.round(800 * u()), pdl: 99_600 - Math.round(800 * u()), deq: 100_050 }, p, model: 'x' };
        const hi = 100_000 + Math.round(1200 * u());
        const lo = 100_000 - Math.round(1200 * u());
        bodies.push(f, { k: 'r', id: f.id, t: slot + 2 * H, hi, lo, yv: { pdh: hi >= f.lv.pdh ? 1 : 0, pdl: lo <= f.lv.pdl ? 1 : 0, deq: hi >= f.lv.deq ? 1 : 0 } });
      }
      const fc = { k: 'f', id: `${slot}-cat`, slot, ti: slot, t: slot, kind: 'cat', h: 60, bar: slot - 300_000, px0: 100_000, x: [], pUp: r4(u()), pBig: r4(0.2 + 0.5 * u()), thr: 40, model: 'm', mh: 'h' };
      const hi = r6(100_000 * Math.exp((20 + 50 * u()) / 1e4));
      bodies.push(fc, { k: 'r', id: fc.id, t: slot + H, c0: 100_000, c1: 100_000, hi, lo: 100_000, yDir: 0, yBig: Math.log(hi / 100_000) * 1e4 > 40 ? 1 : 0 });
    }
    let prev = GENESIS;
    const records = bodies.map((b) => {
      const l = makeLine(prev, b);
      prev = l.hash;
      return JSON.parse(l.line);
    });
    const fs = new Map(bodies.filter((o) => o.k === 'f').map((o) => [o.id, o]));
    const rs = new Map(bodies.filter((o) => o.k === 'r').map((o) => [o.id, o]));
    const catHours = [...fs.values()].filter((f) => f.kind === 'cat' && f.slot % H === 0).map((f) => trustHour(f, rs.get(f.id)));
    const summary = buildSummary({ coin: 'BTC', now: T + 12 * 24 * H, head: { hash: prev, lines: records.length }, forecasts: fs, resolutions: rs, aci: {}, ots: [], catHours });
    return { records, summary: JSON.parse(JSON.stringify(summary)) };
  }
  const { records, summary } = ledgerOf();

  it('ten sam dziennik: te same granice przedziałów w podsumowaniu i w weryfikatorze, bit w bit po zaokrągleniu do 4 miejsc', () => {
    expect(checkResolutions(records)).toEqual([]);
    const m = measures(records, summary.asOf);
    for (const h of ['60', '240']) {
      const sc = summary.scores.ret[h];
      expect(sc.crpssCi.days).toBe(12);
      expect(sc.crpssCi.lo).not.toBeNull();
      expect(m.ret[h].crpssCi).toEqual(sc.crpssCi);
      expect(m.ret[h].aciInf).toEqual(sc.aciInf);
      expect(m.ret[h].pit.bins).toEqual(sc.pit.bins);
      expect(m.ret[h].pit.chi2).toBe(sc.pit.chi2);
      expect(m.ret[h].pit.p).toBeCloseTo(sc.pit.p, 4);
      expect(m.ret[h].kupiec60).toMatchObject({ n: sc.kupiec60.n, x: sc.kupiec60.x, cover: sc.kupiec60.cover });
      expect(m.ret[h].kupiec60.p).toBeCloseTo(sc.kupiec60.p, 4);
    }
    expect(summary.scores.ret['60'].pit.n).toBe(288);
    expect(summary.scores.ret['240'].pit.n).toBe(72);
    expect(m.touch.bssCi).toEqual(summary.scores.touch.bssCi);
    expect(m.touch.bssDistCi).toEqual(summary.scores.touch.bssDistCi);
    expect(summary.scores.touch.bssDistCi.lo).not.toBeNull();
    expect(m.catBig.bssSeasonal).toEqual(summary.cat.scores.big.bssSeasonal);
    expect(summary.cat.scores.big.bssSeasonal.n).toBeGreaterThan(0);
    expect(checkMeasures(summary, records)).toMatchObject({ problems: [] });
    expect(checkMeasures(summary, records).checked).toBeGreaterThan(40);
  });

  it('checkResolutions sprawdza też CRPS benchmarku i PIT (z niezaokrąglonego ln(c1/c0)) — wejścia miar', () => {
    const i = records.findIndex((o) => o.k === 'r' && typeof o.pit === 'number');
    const bad = records.map((o, j) => (j === i ? { ...o, pit: r4(o.pit + 0.003), crpsB: o.crpsB + 1e-4 } : o));
    const p = checkResolutions(bad);
    expect(p).toHaveLength(2);
    expect(p.join(' ')).toMatch(/PIT/);
    expect(p.join(' ')).toMatch(/CRPS benchmarku/);
  });

  it('weryfikator wykrywa zmienioną granicę przedziału (CRPSS, BSS sezonowy) i liczbę prognoz z nieskończonym ACI', () => {
    const bad = structuredClone(summary);
    bad.scores.ret['60'].crpssCi.hi = r4(bad.scores.ret['60'].crpssCi.hi + 0.0001);
    bad.cat.scores.big.bssSeasonal.lo = r4(bad.cat.scores.big.bssSeasonal.lo - 0.0001);
    bad.scores.ret['240'].aciInf.inf += 1;
    const { problems } = checkMeasures(bad, records);
    expect(problems.some((p) => p.startsWith('ret 60 crpssCi.hi'))).toBe(true);
    expect(problems.some((p) => p.startsWith('kot big bssSeasonal.lo'))).toBe(true);
    expect(problems.some((p) => p.startsWith('ret 240 aciInf.inf'))).toBe(true);
    expect(problems).toHaveLength(3);
  });

  it('starsze podsumowanie bez nowych pól: nic do porównania, bez błędów; głowa spoza rekordów — błąd', () => {
    const old = structuredClone(summary);
    for (const h of ['60', '240']) for (const k of ['kupiec60', 'pit', 'crpssCi', 'aciInf']) delete old.scores.ret[h][k];
    delete old.scores.touch.bssCi;
    delete old.scores.touch.bssDistCi;
    delete old.cat.scores.big.bssSeasonal;
    expect(checkMeasures(old, records)).toEqual({ checked: 0, problems: [] });
    // Głowa podsumowania ma więcej linii niż pobrane rekordy: podsumowanie nowsze niż dziennik (wyścig publikacji) — bez
    // porównania i bez błędu
    expect(checkMeasures({ ...summary, head: { hash: 'x', lines: records.length + 3 } }, records)).toEqual({ checked: 0, problems: [], ahead: true });
    // Dziennik ma tyle linii co głowa albo więcej, a jej hasha w nim nie ma — błąd
    expect(checkMeasures({ ...summary, head: { hash: 'x', lines: 1 } }, records).problems).toEqual(['głowa podsumowania nie występuje w rekordach']);
    expect(checkMeasures({ ...summary, head: { hash: 'x', lines: records.length } }, records).problems).toHaveLength(1);
  });

  it('podsumowanie z późniejszej głowy niż rekordy: przeliczenie tylko do głowy podsumowania', () => {
    const t = summary.asOf - 3_600_000;
    const f = makeLine(records.at(-1).hash, { k: 'f', id: 'z-ret60', slot: t, ti: t, t, kind: 'ret', h: 60, px0: 1, taus: TAUS, q: TAUS.map((x) => x - 0.5), bq: TAUS.map((x) => x - 0.5), aci: -1, model: 'x' });
    const r = makeLine(f.hash, { k: 'r', id: 'z-ret60', t: summary.asOf, c0: 1, c1: 1, y: 0, crps: 0.1, crpsB: 0.1, pit: 0.5, in90: 1, in60: 1, inAci: 1 });
    const later = [...records, JSON.parse(f.line), JSON.parse(r.line)];
    expect(checkMeasures(summary, later)).toMatchObject({ problems: [] });
    // Ta sama głowa przesunięta na koniec: dopisana prognoza zmienia liczności
    expect(checkMeasures({ ...summary, head: { hash: r.hash, lines: later.length } }, later).problems.length).toBeGreaterThan(0);
  });
});

import { readFileSync as readFixture } from 'node:fs';
import { HREL_DESIGN, hourIndex, hrelForecast, hrelOutcome } from '../src/utils/hourRel.ts';
import { checkHrel, checkHrelMarket } from './verify-ledger.mjs';

describe('verify-ledger — prognoza hrel-v1 (duży ruch jak na tę godzinę)', () => {
  const HOUR = 3_600_000;
  const fx = JSON.parse(readFixture(new URL('../src/utils/__tests__/fixtures/hrel-v1.json', import.meta.url), 'utf8'));
  const bars = hourIndex(fx.candles.map(([t, h, l]) => ({ t, h, l })));
  const market = fx.candles.map(([time, high, low]) => ({ time, high, low }));
  const hs = fx.cases[0].hs;
  const catalog = JSON.parse(canonical(HREL_DESIGN));
  const plan = { k: 'p', id: HREL_DESIGN.id, t: hs - 60_000, catalogHash: hashOf('sha256').update(canonical(HREL_DESIGN)).digest('hex'), catalog };
  const f = { k: 'f', id: `${hs}-hrel`, slot: hs, ti: hs + 30_000, t: hs, kind: 'hrel', ...hrelForecast(bars, hs), model: 'hrel-logit-v1', plan: 'hrel-v1' };
  const r = { k: 'r', id: f.id, t: hs + 4 * HOUR + 30_000, ...hrelOutcome(bars, hs, f.thr) };
  const good = [plan, f, r];

  it('przechodzi na poprawnym dzienniku (także kolejność i rynek)', () => {
    expect(checkHrel(good)).toEqual({ problems: [], checked: 1, resolved: 1 });
    expect(checkOrdering(good)).toEqual([]);
    expect(checkHrelMarket(good, market)).toEqual({ problems: [], checked: 1, resolved: 1 });
  });

  it('wykrywa zmienione p, zmienione thr, złe y, rekord sprzed planu, wagi inne niż w planie i spóźnione wydanie', () => {
    expect(checkHrel([plan, { ...f, p: [f.p[0] + 0.01, ...f.p.slice(1)] }, r]).problems.join(' ')).toMatch(/p\[0\]/);
    // Próg: ze świecami rynku każda zmiana; bez nich — gdy wynik przestaje wynikać z zapisanych wartości
    const thr = [f.thr[0] + 0.01, ...f.thr.slice(1)];
    expect(checkHrelMarket([plan, { ...f, thr }, r], market).problems.join(' ')).toMatch(/thr\[0\]/);
    const flipped = r.rng[0] > f.thr[0] ? r.rng[0] + 1 : r.rng[0] - 1;
    expect(checkHrel([plan, { ...f, thr: [flipped, ...f.thr.slice(1)] }, r]).problems.join(' ')).toMatch(/y\[0\]/);
    expect(checkHrel([plan, f, { ...r, y: [1 - r.y[0], ...r.y.slice(1)] }]).problems.join(' ')).toMatch(/y\[0\]/);
    expect(checkHrel([f, plan, r]).problems.join(' ')).toMatch(/przed planem/);
    expect(checkHrel([f, r]).problems.join(' ')).toMatch(/przed planem/);
    const w = catalog.weights.map((row, j) => (j === 1 ? [row[0] + 0.5, ...row.slice(1)] : row));
    const forged = checkHrel([{ ...plan, catalog: { ...catalog, weights: w } }, f, r]).problems.join(' ');
    expect(forged).toMatch(/różni się od kodu/);
    expect(forged).toMatch(/p\[1\]/);
    expect(checkHrel([plan, { ...f, slot: hs + 15 * 60_000, ti: hs + 16 * 60_000 }, r]).problems.join(' ')).toMatch(/wydanie/);
  });

  it('rozstrzygnięcie: nie przed hs + 4 h; null tylko razem i po 6 h; rynek: zmieniony zakres i zmienione cechy wykryte', () => {
    expect(checkHrel([plan, f, { ...r, t: hs + 3 * HOUR }]).problems.join(' ')).toMatch(/przed zamknięciem/);
    const part = { ...r, rng: [r.rng[0], null, ...r.rng.slice(2)], y: [r.y[0], null, ...r.y.slice(2)] };
    expect(checkHrel([plan, f, part]).problems.join(' ')).toMatch(/przed upływem 6 h/);
    expect(checkHrel([plan, f, { ...part, t: hs + 10 * HOUR + 60_000 }]).problems).toEqual([]);
    expect(checkHrel([plan, f, { ...part, y: r.y }]).problems.join(' ')).toMatch(/null tylko razem/);
    expect(checkOrdering([plan, f, { k: 'r', id: f.id, t: hs + 5 * HOUR, void: 'no-data' }]).join(' ')).toMatch(/unieważnienie/);
    expect(checkHrelMarket([plan, f, { ...r, rng: [r.rng[0] + 0.01, ...r.rng.slice(1)] }], market).problems.join(' ')).toMatch(/rng\[0\]/);
    expect(checkHrelMarket([plan, { ...f, x: [f.x[0] + 1e-5, ...f.x.slice(1)] }, r], market).problems.join(' ')).toMatch(/x\[0\]/);
    // Plan: null i void tylko przy braku świecy w źródle — przy świecy rynku (np. przerwa skanera) to błąd
    const late = hs + 10 * HOUR + 60_000;
    expect(checkHrelMarket([plan, f, { ...part, t: late }], market).problems.join(' ')).toMatch(/rng\[1\] null mimo świecy/);
    expect(checkHrelMarket([plan, f, { k: 'r', id: f.id, t: late, void: 'no-data' }], market).problems.join(' ')).toMatch(/unieważnione mimo świec/);
    const gap = market.filter((c) => c.time < hs || c.time > hs + 3 * HOUR);
    expect(checkHrelMarket([plan, f, { k: 'r', id: f.id, t: late, void: 'no-data' }], gap).problems).toEqual([]);
    expect(checkHrelMarket([plan, f, { ...part, t: late }], market.filter((c) => c.time !== hs + HOUR)).problems).toEqual([]);
  });
});

import { checkAbPlanC, checkRv60, checkVariantC } from './verify-ledger.mjs';
import { AB_DESIGN_C, abFirstBlock } from '../src/utils/abTest.ts';
import { makeRetForecastC } from '../backend/scanner/forecaster.ts';
import { rv60From5m } from '../src/utils/rvMix.ts';
import rvRef from '../src/utils/__tests__/fixtures/rvMixReference.json';

describe('A/B wariantu C (ab-v2): weryfikator niezależnie przelicza przekształcenie kwantyli i plan', () => {
  const T = AB_EPOCH + 20 * 86_400_000;
  const H = 3_600_000;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const qA = rvRef.przypadki[2].qA;
  /** Dziennik: plany ab-v1 i ab-v2, w każdym slocie A, B (skala ze wzoru) i C (ze skanera) */
  function ledger({ planAt = T - H } = {}) {
    const recs = [
      { k: 'p', id: AB_DESIGN.id, t: planAt - 1, catalogHash: createHash('sha256').update(canonical(AB_DESIGN)).digest('hex'), catalog: JSON.parse(JSON.stringify(AB_DESIGN)) },
      { k: 'p', id: AB_DESIGN_C.id, t: planAt, catalogHash: createHash('sha256').update(canonical(AB_DESIGN_C)).digest('hex'), catalog: JSON.parse(JSON.stringify(AB_DESIGN_C)) },
    ];
    for (let i = 0; i < 8; i++) {
      const slot = T + i * 15 * 60_000;
      const a = { k: 'f', id: `${slot}-ret60`, slot, ti: slot + 20_000, t: slot + 60_000, kind: 'ret', h: 60, px0: 100_000, taus: TAUS, q: qA, bq: benchQuantiles(0.005, 60).map(r6), aci: 0.1, model: 'ledger-har-fhs-v1' };
      const sigmaA = 0.0051;
      const sigma5 = 0.0014;
      const seas = 1.02;
      const scale = r6(Math.sqrt(0.5 + (0.5 * sigma5 ** 2 * 12 * seas) / sigmaA ** 2));
      const b = { ...a, id: `${a.id}b`, q: a.q.map((v) => r6(v * scale)), model: 'ledger-har-fhs-bocpd-v1', variant: 'B', scale, regime: { sigma5, run: 40, pChange: 0.01 }, sigmaA, seas };
      const c = makeRetForecastC(a, 1e-5 * (1 + i));
      recs.push(a, b, c);
    }
    return recs;
  }

  it('poprawny dziennik z B i C przechodzi: kwantyle C, stałe, plan ab-v2 zgodny z kodem, B bez zmian', () => {
    const recs = ledger();
    expect(checkVariantC(recs)).toEqual({ problems: [], checked: 8 });
    expect(checkAbPlanC(recs, { full: true })).toEqual({ problems: [], registeredAt: T - H });
    expect(checkVariants(recs)).toEqual({ problems: [], checked: 8 });
    expect(checkAbPlan(recs).problems).toEqual([]);
    expect(recompute(recs).abC).toMatchObject({ firstBlock: abFirstBlock(T - H) });
  });

  it('wykrywa zmieniony kwantyl C, zmienioną stałą, zmienione x i pola różne od A', () => {
    const recs = ledger();
    const cs = recs.filter((o) => o.variant === 'C');
    cs[0].q = cs[0].q.map((v, i) => (i === 6 ? v + 2e-5 : v));
    cs[1].kappa = 0.6;
    cs[2].x = cs[2].x + 1e-4;
    cs[3].aci = 0.2;
    const { problems, checked } = checkVariantC(recs);
    expect(checked).toBe(4);
    expect(problems.find((p) => p.startsWith(cs[0].id))).toMatch(/kwantyle C ≠ przekształcenie A/);
    expect(problems.find((p) => p.startsWith(cs[1].id))).toMatch(/stałe ≠ plan ab-v2/);
    expect(problems.find((p) => p.startsWith(cs[2].id))).toMatch(/x ≠/);
    expect(problems.find((p) => p.startsWith(cs[3].id))).toMatch(/aci/);
  });

  it('wykrywa rekord C sprzed planu, plan różny od kodu i C bez planu w pełnym dzienniku', () => {
    const early = ledger({ planAt: T + 30 * 60_000 });
    expect(checkAbPlanC(early).problems[0]).toMatch(/wariant C przed prerejestracją planu: 2/);
    const forged = ledger();
    forged[1].catalog = { ...forged[1].catalog, constants: { ...forged[1].catalog.constants, tau: 0.6 } };
    expect(checkAbPlanC(forged).problems[0]).toMatch(/różni się od kodu/);
    const noPlan = ledger().filter((o) => !(o.k === 'p' && o.id === AB_DESIGN_C.id));
    expect(checkAbPlanC(noPlan, { full: true }).problems[0]).toMatch(/bez planu ab-v2/);
    expect(checkAbPlanC(noPlan).problems).toEqual([]);
  });

  it('--market: rv60 rekordu C zgodne ze świecami 5m (12 log-zwrotów przed slotem); zmienione wykryte; poza zakresem świec pominięte', () => {
    const slot = T;
    const candles = Array.from({ length: 20 }, (_, i) => ({ time: slot - 15 * 300_000 + i * 300_000, close: 100_000 * Math.exp(0.002 * Math.sin(i * 1.7)) }));
    const rv = rv60From5m(candles, slot);
    const a = ledger().find((o) => o.id === `${slot}-ret60`);
    const c = makeRetForecastC(a, rv);
    expect(checkRv60([c], candles)).toEqual({ problems: [], checked: 1, eligible: 1 });
    expect(checkRv60([{ ...c, rv60: rv * 1.01 }], candles).problems).toHaveLength(1);
    expect(checkRv60([c], candles.slice(5))).toEqual({ problems: [], checked: 0, eligible: 1 });
  });
});
