import { describe, expect, it } from 'vitest';
import { ONBOARDING_KEY, QUICK_REPLAY_MS, TIPS_PENDING_MS, isFirstVisit, markSeen, quickReplay, quickReplayVisible, startOnboarding, tipsPending } from '../onboarding';
import type { HistoryIndex } from '../tapeHistory';

/** Atrapa Storage: Map z length/key; opcjonalnie rzuca (tryb prywatny). */
function fake(init: Record<string, string> = {}, broken = false): Storage {
  const m = new Map(Object.entries(init));
  const boom = () => {
    if (broken) throw new Error('SecurityError');
  };
  return {
    get length() {
      boom();
      return m.size;
    },
    key: (i: number) => (boom(), [...m.keys()][i] ?? null),
    getItem: (k: string) => (boom(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (boom(), void m.set(k, v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const NOW = Date.parse('2026-11-07T12:00:00Z');
const MIN = 60_000;

describe('isFirstVisit', () => {
  it('pusta pamięć: pierwsza wizyta', () => {
    expect(isFirstVisit(fake())).toBe(true);
  });
  it('są klucze hq.charts.*: stały użytkownik, bez dymków', () => {
    expect(isFirstVisit(fake({ 'hq.charts.v1': '{}' }))).toBe(false);
    expect(isFirstVisit(fake({ 'hq.charts.alerts.v1': '[]' }))).toBe(false);
  });
  it('inne klucze (hq.lang, hq.ledger.v1) nie liczą się jako wcześniejsza wizyta na wykresach', () => {
    expect(isFirstVisit(fake({ 'hq.lang': 'pl', 'hq.ledger.v1': '[]' }))).toBe(true);
  });
  it('po markSeen: nie pierwsza wizyta, a inne klucze bez zmian', () => {
    const s = fake({ 'hq.lang': 'pl' });
    markSeen(s, NOW);
    expect(isFirstVisit(s)).toBe(false);
    expect(s.getItem('hq.lang')).toBe('pl');
    expect(s.length).toBe(2);
    expect(s.getItem(ONBOARDING_KEY)).not.toBeNull();
  });
  it('zablokowana pamięć: traktowana jak widziane, bez wyjątku', () => {
    const s = fake({}, true);
    expect(isFirstVisit(s)).toBe(false);
    expect(() => markSeen(s, NOW)).not.toThrow();
    expect(() => startOnboarding(s, NOW)).not.toThrow();
    expect(tipsPending(s)).toBe(false);
    expect(quickReplayVisible(s, NOW)).toBe(false);
  });
  it('uszkodzony zapis: widziane', () => {
    expect(isFirstVisit(fake({ [ONBOARDING_KEY]: '{' }))).toBe(false);
    expect(tipsPending(fake({ [ONBOARDING_KEY]: '{' }))).toBe(false);
  });
});

describe('dymki i przycisk powtórki w ciągu 7 dni', () => {
  it('start zapisuje czas pierwszej wizyty; dymki czekają do „Rozumiem”', () => {
    const s = fake();
    startOnboarding(s, NOW);
    expect(tipsPending(s)).toBe(true);
    expect(isFirstVisit(s)).toBe(false);
    markSeen(s, NOW + 5 * MIN);
    expect(tipsPending(s)).toBe(false);
  });
  it('markSeen zachowuje czas pierwszej wizyty', () => {
    const s = fake();
    startOnboarding(s, NOW);
    markSeen(s, NOW + 3 * 86_400_000);
    expect(quickReplayVisible(s, NOW + 6 * 86_400_000)).toBe(true);
    expect(quickReplayVisible(s, NOW + TIPS_PENDING_MS + 1)).toBe(false);
  });
  it('stały użytkownik bez zapisu nie dostaje przycisku', () => {
    expect(quickReplayVisible(fake({ 'hq.charts.v1': '{}' }), NOW)).toBe(false);
  });
  it('markSeen bez wcześniejszego startu też zapisuje czas', () => {
    const s = fake();
    markSeen(s, NOW);
    expect(quickReplayVisible(s, NOW + 86_400_000)).toBe(true);
  });
});

const idx = (hours: number[], parts: number[] = []): HistoryIndex => ({ v: 1, asOf: NOW, keepDays: 7, partMs: 5 * MIN, markets: { BTC: { hours, parts } } });
const H = 3_600_000;
const hourStart = Math.floor(NOW / H) * H;

describe('quickReplay', () => {
  it('BTC z nagraniem: link od now − 15 min do now na Kokpicie', () => {
    const r = quickReplay('BTC', NOW, idx([hourStart - H, hourStart]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hash).toContain('replay=history');
    expect(r.hash).toContain('m=BTC');
    expect(r.hash).toContain('station=cockpit');
    expect(r.hash).toContain(`from=${new Date(NOW - QUICK_REPLAY_MS).toISOString().replace('.000Z', 'Z')}`);
    expect(r.hash).toContain('to=2026-11-07T12:00:00Z');
  });
  it('inny rynek niż BTC: powód „market”', () => {
    expect(quickReplay('ETH', NOW, idx([hourStart]))).toEqual({ ok: false, reason: 'market' });
  });
  it('brak spisu albo nagrania BTC: powód „no-recording”', () => {
    expect(quickReplay('BTC', NOW, null)).toEqual({ ok: false, reason: 'no-recording' });
    expect(quickReplay('BTC', NOW, { ...idx([]), markets: {} })).toEqual({ ok: false, reason: 'no-recording' });
  });
  it('nagranie kończy się przed początkiem okna: „no-recording”', () => {
    expect(quickReplay('BTC', NOW, idx([hourStart - 5 * H]))).toEqual({ ok: false, reason: 'no-recording' });
  });
});
