import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WeightLimiter } from '../rateLimiter.ts';
import { AddressBook } from '../addressBook.ts';
import { signV4 } from '../sigv4.ts';
import { parseCoinPosition } from '../positions.ts';

const MIN = 60_000;

describe('WeightLimiter — własny budżet wag API Hyperliquid', () => {
  it('240 wag/min: zapas 10 s od razu, potem 2-wagowe zapytania co 0.5 s', () => {
    const l = new WeightLimiter(240);
    const waits: number[] = [];
    for (let i = 0; i < 22; i++) waits.push(l.reserve(2, 0));
    expect(waits.slice(0, 20).every((w) => w === 0)).toBe(true);
    expect(waits[20]).toBeCloseTo(500, 6);
    expect(waits[21]).toBeCloseTo(1000, 6);
  });

  it('w ciągu minuty nie przepuszcza więcej niż budżet + zapas', () => {
    const l = new WeightLimiter(240);
    let t = 0;
    let sent = 0;
    while (t < MIN) {
      const w = l.reserve(2, t);
      t += w;
      if (t < MIN) sent += 2;
    }
    expect(sent).toBeLessThanOrEqual(240 + 40);
  });

  it('kara po 429: tempo o połowę przez 5 min, potem wraca', () => {
    const l = new WeightLimiter(240);
    l.penalize(0);
    expect(l.perMinAt(1000)).toBe(120);
    expect(l.perMinAt(5 * MIN + 1)).toBe(240);
  });
});

describe('AddressBook — adresy z taśmy i harmonogram skanów', () => {
  const pos = (szi: number) => ({ szi, entryPx: 100000, liqPx: 90000, scannedAt: 0 });

  it('nowe adresy z transakcji są do skanu od razu, większy obrót pierwszy', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1000, 0);
    b.recordTrade(['0xb', '0xc'], 50000, 0);
    expect(b.due(0, 10)).toEqual(['0xb', '0xc', '0xa']);
    expect(b.size).toBe(3);
  });

  it('interwał zależy od wielkości pozycji: ≥ 1M co 2 min, ≥ 100k co 10 min, inna co 30 min, bez pozycji co 120 min', () => {
    const b = new AddressBook();
    for (const a of ['0xbig', '0xmid', '0xsmall', '0xnone']) b.recordTrade([a, '0xz'], 1, 0);
    b.updatePosition('0xz', null, 0);
    b.updatePosition('0xbig', pos(20), 0); // 2 mln USD
    b.updatePosition('0xmid', pos(2), 0); // 200 tys. USD
    b.updatePosition('0xsmall', pos(0.1), 0);
    b.updatePosition('0xnone', null, 0);
    expect(b.due(2 * MIN, 10)).toEqual(['0xbig']);
    expect(b.due(10 * MIN, 10)).toEqual(['0xbig', '0xmid']);
    expect(b.due(30 * MIN, 10)).toEqual(['0xbig', '0xmid', '0xsmall']);
    expect(b.due(120 * MIN, 10).sort()).toEqual(['0xbig', '0xmid', '0xnone', '0xsmall', '0xz']);
  });

  it('pozycje do mapy, czyszczenie nieaktywnych bez pozycji po 3 dniach, zapis i odczyt stanu', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1, 0);
    b.updatePosition('0xa', pos(1), 0);
    b.updatePosition('0xb', null, 0);
    expect(b.positions()).toHaveLength(1);
    b.prune(3 * 24 * 60 * MIN + 1);
    expect(b.size).toBe(1);
    const c = AddressBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(c.size).toBe(1);
    expect(c.positions()[0].szi).toBe(1);
  });

  it('limit liczby adresów: przy przepełnieniu odpadają najstarsze bez pozycji', () => {
    const b = new AddressBook(3);
    b.recordTrade(['0x1', '0x2'], 1, 0);
    b.updatePosition('0x1', pos(1), 0);
    b.recordTrade(['0x3', '0x4'], 1, 10);
    expect(b.size).toBe(3);
    expect(b.has('0x1')).toBe(true);
    expect(b.has('0x2')).toBe(false);
  });
});

describe('signV4 — podpis AWS SigV4 (R2 jest zgodne z S3)', () => {
  it('oficjalny wektor AWS „get-vanilla”', () => {
    const r = signV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: createHash('sha256').update('').digest('hex'),
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'service',
    });
    expect(r.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    );
  });

  it('ścieżka kodowana per segment (RFC 3986), ukośniki zostają', () => {
    const r = signV4({
      method: 'PUT',
      url: 'https://acc.r2.cloudflarestorage.com/bucket/liq-map/BTC 1.json',
      headers: { host: 'acc.r2.cloudflarestorage.com', 'x-amz-date': '20261022T000000Z' },
      payloadHash: 'UNSIGNED-PAYLOAD',
      accessKeyId: 'k',
      secretAccessKey: 's',
      region: 'auto',
      service: 's3',
    });
    expect(r.canonicalRequest.split('\n')[1]).toBe('/bucket/liq-map/BTC%201.json');
  });
});

describe('parseCoinPosition — pozycja BTC z clearinghouseState', () => {
  const state = {
    assetPositions: [
      { type: 'oneWay', position: { coin: 'ETH', szi: '3', entryPx: '3000', liquidationPx: '2500' } },
      { type: 'oneWay', position: { coin: 'BTC', szi: '-0.5', entryPx: '83000.5', liquidationPx: '91000.25' } },
    ],
  };
  it('wyciąga rozmiar, cenę wejścia i likwidacji', () => {
    expect(parseCoinPosition(state, 'BTC', 7)).toEqual({ szi: -0.5, entryPx: 83000.5, liqPx: 91000.25, scannedAt: 7 });
  });
  it('brak pozycji, zerowy rozmiar lub zły kształt → null; liquidationPx null → liqPx null', () => {
    expect(parseCoinPosition({ assetPositions: [] }, 'BTC', 0)).toBeNull();
    expect(parseCoinPosition(null, 'BTC', 0)).toBeNull();
    expect(parseCoinPosition({ assetPositions: [{ position: { coin: 'BTC', szi: '0', entryPx: '1', liquidationPx: null } }] }, 'BTC', 0)).toBeNull();
    expect(parseCoinPosition({ assetPositions: [{ position: { coin: 'BTC', szi: '1', entryPx: '1', liquidationPx: null } }] }, 'BTC', 0)?.liqPx).toBeNull();
  });
});
