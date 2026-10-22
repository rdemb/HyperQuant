import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OTS_MAGIC, PENDING_TAG, buildOtsFile, parseOts, stampDigest, varbytes } from '../ots.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const DIGEST = new Uint8Array(createHash('sha256').update('dziennik 2026-10-22').digest());
const NONCE = new Uint8Array(16).fill(7);

/** Odpowiedź kalendarza w formacie OTS: prepend(arg) → sha256 → oczekujące poświadczenie z adresem kalendarza. */
function calendarResponse(arg: number, uri: string): Uint8Array {
  const payload = varbytes(new TextEncoder().encode(uri));
  return new Uint8Array([0xf1, ...varbytes(new Uint8Array(4).fill(arg)), 0x08, 0x00, ...PENDING_TAG, ...varbytes(new Uint8Array(payload))]);
}

describe('OpenTimestamps — plik .ots', () => {
  it('nagłówek, wersja 1, sha256 pliku, digest, append(nonce) → sha256 → gałęzie kalendarzy posortowane po operacji', () => {
    const r1 = calendarResponse(2, 'https://b.example');
    const r2 = calendarResponse(1, 'https://a.example');
    const ots = buildOtsFile(DIGEST, NONCE, [r1, r2]);
    expect(hex(ots.slice(0, OTS_MAGIC.length))).toBe(hex(OTS_MAGIC));
    expect(ots[OTS_MAGIC.length]).toBe(1);
    expect(ots[OTS_MAGIC.length + 1]).toBe(0x08);
    expect(hex(ots.slice(OTS_MAGIC.length + 2, OTS_MAGIC.length + 34))).toBe(hex(DIGEST));
    const rest = ots.slice(OTS_MAGIC.length + 34);
    expect(hex(rest.slice(0, 18))).toBe('f010' + hex(NONCE));
    expect(rest[18]).toBe(0x08);
    // dwie gałęzie: pierwsza z separatorem 0xff, w kolejności rosnącej argumentu operacji
    expect(rest[19]).toBe(0xff);
    expect(hex(rest.slice(20, 20 + r2.length))).toBe(hex(r2));
    expect(hex(rest.slice(20 + r2.length))).toBe(hex(r1));
  });

  it('parser odczytuje digest, nonce i adresy oczekujących poświadczeń', () => {
    const ots = buildOtsFile(DIGEST, NONCE, [calendarResponse(1, 'https://a.example'), calendarResponse(2, 'https://b.example')]);
    const p = parseOts(ots);
    expect(hex(p.digest)).toBe(hex(DIGEST));
    expect(p.pending.sort()).toEqual(['https://a.example', 'https://b.example']);
  });

  it('odpowiedź kalendarza o złym kształcie jest pomijana; bez żadnej poprawnej — błąd', () => {
    const ok = calendarResponse(1, 'https://a.example');
    const ots = buildOtsFile(DIGEST, NONCE, [new Uint8Array([0xff, 0x00]), ok, new Uint8Array([0x99])]);
    expect(parseOts(ots).pending).toEqual(['https://a.example']);
    expect(() => buildOtsFile(DIGEST, NONCE, [new Uint8Array([0x00])])).toThrow();
  });

  it('stampDigest: POST surowego digestu (sha256(digest‖nonce)) do kalendarzy; zwraca plik z gałęziami, które odpowiedziały', async () => {
    const calls: { url: string; body: Uint8Array }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: new Uint8Array(init?.body as ArrayBuffer) });
      if (url.startsWith('https://down')) return new Response('', { status: 503 });
      return new Response(Buffer.from(calendarResponse(url.length % 250, url)));
    }) as unknown as typeof fetch;
    const r = await stampDigest(DIGEST, { fetchFn, calendars: ['https://a.cal', 'https://down.cal', 'https://bb.cal'], nonce: NONCE });
    expect(r).not.toBeNull();
    const merkle = createHash('sha256').update(Buffer.concat([Buffer.from(DIGEST), Buffer.from(NONCE)])).digest('hex');
    expect(calls.map((c) => c.url)).toEqual(['https://a.cal/digest', 'https://down.cal/digest', 'https://bb.cal/digest']);
    expect(hex(calls[0].body)).toBe(merkle);
    expect(r!.calendars.sort()).toEqual(['https://a.cal', 'https://bb.cal']);
    expect(parseOts(r!.ots).pending.sort()).toEqual(['https://a.cal/digest', 'https://bb.cal/digest']);
  });

  it('żaden kalendarz nie odpowiedział → null', async () => {
    const fetchFn = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await stampDigest(DIGEST, { fetchFn, calendars: ['https://a.cal'] })).toBeNull();
  });
});
