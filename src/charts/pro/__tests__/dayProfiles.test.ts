import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayProfileBuilder, dayProfilePath, encodeDayProfile } from '../../../utils/dayProfile';
import { HIST_PART_MS } from '../../../utils/tapeHistory';
import { HlStream } from '../hl/stream';
import { DayProfiles } from '../store/dayProfiles';
import { ProStore } from '../store/proStore';

const DAY = 86_400_000;
const D = Date.UTC(2026, 9, 31);
const NOW = D + 3 * 3_600_000;
const BASE = 'https://data.example/history';

const fileOf = (day: number) => {
  const b = new DayProfileBuilder('BTC', day, 1);
  b.addMinute(day, [80_000], [1], [1], 0.5);
  return encodeDayProfile(b.build()!);
};

describe('DayProfiles — profile zamkniętych dób z serwera', () => {
  let store: ProStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('doby ze spisu od chwili `from`, tylko zamknięte; każdy plik raz; profil niewidoczny przed końcem doby w zegarze magazynu', async () => {
    const files = new Map<string, unknown>([D - 2 * DAY, D - DAY, D].map((d) => [dayProfilePath('BTC', d), fileOf(d)]));
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      const rel = url.slice(BASE.length + 1);
      calls.push(rel);
      if (rel === 'index.json') return new Response(JSON.stringify({ v: 1, asOf: NOW, keepDays: 7, partMs: HIST_PART_MS, markets: { BTC: { hours: [], parts: [], days: [D - 3 * DAY, D - 2 * DAY, D - DAY, D] } } }));
      const v = files.get(rel);
      return v ? new Response(new Uint8Array(gzipSync(JSON.stringify(v)))) : new Response('', { status: 404 });
    };
    const p = new DayProfiles(store, BASE, fetcher);
    const v0 = store.version;
    await p.ensure(D - 2 * DAY + 1);
    // Doba D − 3 kończy się przed `from`, bieżąca D jeszcze trwa
    expect(calls).toEqual(['index.json', dayProfilePath('BTC', D - 2 * DAY), dayProfilePath('BTC', D - DAY)]);
    expect(store.version).toBeGreaterThan(v0);
    expect(p.get(D - DAY)?.ob).toEqual([0.5]);
    expect(p.get(D)).toBeNull();
    await p.ensure(D - DAY);
    expect(calls).toHaveLength(3);
    // Wcześniej w zegarze (np. powtórka doby D − 1): jej profil jeszcze nieznany
    vi.setSystemTime(D - DAY + 3_600_000);
    expect(p.get(D - DAY)).toBeNull();
    expect(p.get(D - 2 * DAY)).not.toBeNull();
  });
});
