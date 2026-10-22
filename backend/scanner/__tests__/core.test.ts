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

  it('kolejne błędy (429/5xx) halvują tempo aż do 1/8 budżetu', () => {
    const l = new WeightLimiter(240);
    l.fail(0, 'error');
    expect(l.perMinAt(1)).toBe(120);
    l.fail(1, 'error');
    l.fail(2, 'error');
    l.fail(3, 'error');
    l.fail(4, 'error');
    expect(l.perMinAt(5)).toBe(30);
  });

  it('429 wstrzymuje zapytania na 30 s', () => {
    const l = new WeightLimiter(240);
    l.fail(1000, '429');
    expect(l.reserve(2, 1000)).toBeGreaterThanOrEqual(30_000);
  });

  it('powrót stopniowy: sukcesy po minucie bez błędów podnoszą tempo ×1.25, najwyżej do budżetu', () => {
    const l = new WeightLimiter(240);
    l.fail(0, 'error');
    l.success(30_000);
    expect(l.perMinAt(30_000)).toBe(120);
    l.success(61_000);
    expect(l.perMinAt(61_000)).toBe(150);
    for (let i = 0; i < 20; i++) l.success(62_000 + i);
    expect(l.perMinAt(70_000)).toBe(240);
  });
});

describe('WeightLimiter — stan i dopłata wag', () => {
  it('healthy: pełne tempo bez pauzy; po błędzie albo 429 — nie', () => {
    const l = new WeightLimiter(240);
    expect(l.healthy(0)).toBe(true);
    l.fail(1000, 'error');
    expect(l.healthy(1000)).toBe(false);
    const k = new WeightLimiter(240);
    k.fail(0, '429');
    expect(k.healthy(10_000)).toBe(false);
  });
  it('charge: faktyczna waga odpowiedzi opóźnia kolejne zapytania', () => {
    const a = new WeightLimiter(240);
    const b = new WeightLimiter(240);
    b.charge(60, 0);
    expect(b.reserve(2, 0)).toBeGreaterThan(a.reserve(2, 0));
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
    // Adres bez pozycji: ponownie dopiero po nowej transakcji albo po 24 h (bezpiecznik)
    expect(b.due(120 * MIN, 10)).toEqual(['0xbig', '0xmid', '0xsmall']);
    expect(b.due(24 * 60 * MIN, 10).sort()).toEqual(['0xbig', '0xmid', '0xnone', '0xsmall', '0xz']);
  });

  it('pył (< 25 tys. USD) blisko ceny likwidacji nie jest promowany do odczytu co minutę', () => {
    const b = new AddressBook();
    b.recordTrade(['0xdust', '0xz'], 1, 0);
    b.updatePosition('0xz', null, 0);
    b.updatePosition('0xdust', { szi: 0.1, entryPx: 100000, liqPx: 99_500, scannedAt: 0 }, 0);
    expect(b.due(MIN, 10, 100_000)).toEqual([]);
  });

  it('przepełnienie: konta z rankingu odpadają dopiero, gdy nie ma innych kandydatów', () => {
    const b = new AddressBook(3);
    b.seed('0xranked', 5e6, 0);
    b.updatePosition('0xranked', null, 0);
    b.recordTrade(['0xa', '0xb'], 1, 1000);
    b.recordTrade(['0xc', '0xd'], 1, 2000);
    expect(b.has('0xranked')).toBe(true);
  });

  it('blisko ceny likwidacji odczyt częściej: < 1% od mark co 1 min, < 3% najwyżej co 2 min (także mała pozycja)', () => {
    const b = new AddressBook();
    const at = (liqPx: number, szi = 0.3) => ({ szi, entryPx: 100000, liqPx, scannedAt: 0 });
    for (const a of ['0xnear', '0xmid', '0xfar']) b.recordTrade([a, '0xz'], 1, 0);
    b.updatePosition('0xz', null, 0);
    b.updatePosition('0xnear', at(99_500), 0); // 0.5% od mark
    b.updatePosition('0xmid', at(97_800), 0); // 2.2%
    b.updatePosition('0xfar', at(80_000), 0); // 20% — zwykły interwał 30 min
    expect(b.due(MIN, 10, 100_000)).toEqual(['0xnear']);
    expect(b.due(2 * MIN, 10, 100_000)).toEqual(['0xnear', '0xmid']);
    expect(b.due(2 * MIN, 10)).toEqual([]); // bez ceny mark — interwały wg nominału
  });

  it('positionOf: ostatnio odczytana pozycja adresu (do porównania przy kolejnym odczycie)', () => {
    const b = new AddressBook();
    b.updatePosition('0xa', pos(2), 0);
    expect(b.positionOf('0xa')).toEqual(pos(2));
    expect(b.positionOf('0xnope')).toBeNull();
  });

  it('znany adres, który znów handluje, wraca do kolejki od razu', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1, 0);
    b.updatePosition('0xa', null, 0);
    b.updatePosition('0xb', null, 0);
    expect(b.due(5 * MIN, 10)).toEqual([]);
    b.recordTrade(['0xa', '0xc'], 5000, 5 * MIN);
    expect(b.due(5 * MIN, 10).sort()).toEqual(['0xa', '0xc']);
  });

  it('nieudany odczyt: adres wraca do kolejki dopiero po minucie', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1, 0);
    b.markFailed('0xa', 0);
    expect(b.due(30_000, 10)).toEqual(['0xb']);
    expect(b.due(61_000, 10).sort()).toEqual(['0xa', '0xb']);
  });

  it('przeciążenie (120 skanów/min, 100 dużych pozycji, strumień nowych adresów): duże pozycje ≤ 4 min, nowe adresy dostają udział', () => {
    const b = new AddressBook(100_000);
    for (let i = 0; i < 100; i++) {
      b.recordTrade([`0xw${i}`, '0xx'], 1e6, 0);
      b.updatePosition(`0xw${i}`, pos(20), 0);
    }
    b.updatePosition('0xx', null, 0);
    const lastScan = new Map<string, number>();
    let newScanned = 0;
    let maxBigAge = 0;
    for (let t = 10_000; t <= 30 * MIN; t += 10_000) {
      for (let k = 0; k < 20; k++) b.recordTrade([`0xn${t}-${k}`, `0xm${t}-${k}`], 100, t);
      for (const a of b.due(t, 20)) {
        if (a.startsWith('0xn') || a.startsWith('0xm')) newScanned++;
        b.updatePosition(a, a.startsWith('0xw') ? pos(20) : null, t);
        lastScan.set(a, t);
      }
      if (t > 5 * MIN) for (let i = 0; i < 100; i++) maxBigAge = Math.max(maxBigAge, t - (lastScan.get(`0xw${i}`) ?? 0));
    }
    expect(maxBigAge).toBeLessThanOrEqual(4 * MIN);
    expect(newScanned).toBeGreaterThanOrEqual(1000);
  });

  it('pozycje do mapy, czyszczenie nieaktywnych bez pozycji po 3 dniach, zapis i odczyt stanu', () => {
    const b = new AddressBook();
    b.recordTrade(['0xa', '0xb'], 1, 0);
    b.updatePosition('0xa', pos(1), 0);
    b.updatePosition('0xb', null, 0);
    expect(b.positions()).toHaveLength(1);
    b.prune(3 * 24 * 60 * MIN + 1);
    expect(b.size).toBe(1);
    const c = AddressBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON())), 7);
    expect(c.size).toBe(1);
    expect(c.positions()[0].szi).toBe(1);
    expect(c.capacity).toBe(7);
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
