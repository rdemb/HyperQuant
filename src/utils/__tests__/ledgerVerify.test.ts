import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GENESIS, canonicalJson, makeLine } from '../../../backend/scanner/ledger.ts';
import { buildOtsFile } from '../../../backend/scanner/ots.ts';
import { otsDigestHex, sha256Hex, verifyChain, verifyLedgerRemote } from '../ledgerVerify';

const SLOT = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 21, 23, 30);

/** Łańcuch dwóch dni z prognozami, rozstrzygnięciem i prerejestracją */
function chain() {
  const bodies = [
    { k: 'f', id: `${T0}-ret60`, slot: T0, t: T0 + 60_000, kind: 'ret' },
    { k: 'f', id: `${T0 + 3 * SLOT}-ret60`, slot: T0 + 3 * SLOT, t: T0 + 3 * SLOT + 60_000, kind: 'ret' },
    { k: 'p', id: 'lab-v1', t: T0 + 3 * SLOT + 90_000, catalogHash: createHash('sha256').update(canonicalJson({ v: 1 })).digest('hex'), catalog: { v: 1 } },
    { k: 'f', id: `${T0 + 6 * SLOT}-ret60`, slot: T0 + 6 * SLOT, t: T0 + 6 * SLOT + 60_000, kind: 'ret' },
  ];
  let prev = GENESIS;
  const lines: { line: string; hash: string }[] = [];
  for (const b of bodies) {
    const l = makeLine(prev, b);
    lines.push(l);
    prev = l.hash;
  }
  return { lines, head: prev };
}

const receipt = (hashHex: string) => buildOtsFile(new Uint8Array(Buffer.from(hashHex, 'hex')), new Uint8Array(16), [new Uint8Array([0xf1, 1, 7, 0x08, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e, 2, 1, 0x61])]);

describe('weryfikacja w przeglądarce (WebCrypto)', () => {
  it('SHA-256 zgodne z node:crypto', async () => {
    expect(await sha256Hex('zażółć')).toBe(createHash('sha256').update('zażółć').digest('hex'));
  });
  it('łańcuch skanera przechodzi; zmiana liczby wstecz → pierwsza zła linia', async () => {
    const { lines, head } = chain();
    const ok = await verifyChain(lines.map((l) => l.line), GENESIS);
    expect(ok).toMatchObject({ ok: true, head, badLine: null });
    const bad = lines.map((l) => l.line);
    bad[1] = bad[1].replace(`"slot":${T0 + 3 * SLOT}`, `"slot":${T0 + 3 * SLOT + 1}`);
    expect(await verifyChain(bad, GENESIS)).toMatchObject({ ok: false, badLine: 1 });
  });
  it('skrót z pliku .ots', () => {
    expect(otsDigestHex(receipt('ab'.repeat(32)))).toBe('ab'.repeat(32));
    expect(otsDigestHex(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('weryfikacja zdalna (pliki z gałęzi ledger)', () => {
  function server(over: { tamper?: boolean; noReceipt?: boolean; summaryHead?: string } = {}) {
    const { lines, head } = chain();
    const d1 = lines.slice(0, 1).map((l) => l.line);
    const d2 = lines.slice(1).map((l) => l.line);
    if (over.tamper) d2[0] = d2[0].replace('"kind":"ret"', '"kind":"rot"');
    const files: Record<string, string | Uint8Array> = {
      'BTC/2026-10-21.jsonl': `${d1.join('\n')}\n`,
      'BTC/2026-10-22.jsonl': `${d2.join('\n')}\n`,
    };
    for (const l of lines) {
      const o = JSON.parse(l.line);
      if (o.k !== 'f' || over.noReceipt) continue;
      files[`BTC/ots/slots/${new Date(o.slot).toISOString().slice(0, 10)}/${o.slot}.ots`] = receipt(o.hash);
    }
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(Object.keys(files).filter((k) => /^BTC\/\d{4}-\d\d-\d\d\.jsonl$/.test(k)).map((k) => ({ name: k.slice(4), type: 'file' }))), { status: 200 });
      }
      const rel = url.replace('https://raw.example/ledger/', '');
      const f = files[rel];
      return f === undefined ? new Response('nie ma', { status: 404 }) : new Response(f as unknown as BodyInit, { status: 200 });
    };
    return { fetchFn: fetchFn as unknown as typeof fetch, head };
  }
  const opts = { ledgerBase: 'https://raw.example/ledger', repo: 'acme/hq-data', receipts: 10 };

  it('pełny łańcuch od GENESIS, głowa z podsumowania w łańcuchu, pokwitowania slotów i prerejestracja', async () => {
    const { fetchFn, head } = server();
    const r = await verifyLedgerRemote({ ...opts, summaryHead: head, fetchFn });
    expect(r.ok).toBe(true);
    expect(r.lines).toBe(4);
    expect(r.days).toBe(2);
    expect(r.fromGenesis).toBe(true);
    expect(r.receipts).toEqual({ checked: 3, ok: 3 });
    expect(r.preregs).toEqual([{ id: 'lab-v1', ok: true }]);
    expect(r.problems).toEqual([]);
  });
  it('zmieniona linia → problem i ok = false', async () => {
    const { fetchFn, head } = server({ tamper: true });
    const r = await verifyLedgerRemote({ ...opts, summaryHead: head, fetchFn });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/2026-10-22.*linia 1/);
  });
  it('brak pokwitowań → problem; głowa podsumowania spoza łańcucha → problem', async () => {
    const a = server({ noReceipt: true });
    expect((await verifyLedgerRemote({ ...opts, summaryHead: a.head, fetchFn: a.fetchFn })).problems.join(' ')).toMatch(/pokwitowani/);
    const b = server();
    const r = await verifyLedgerRemote({ ...opts, summaryHead: 'f'.repeat(64), fetchFn: b.fetchFn });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/podsumowani/);
  });
});
