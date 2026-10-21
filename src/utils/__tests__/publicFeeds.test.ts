import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_TTL_MS, FeedEnvelope, clearFeedCache, feedFreshness, fmtAgo, freshnessBadge, loadFeed, partAsOf } from '../publicFeeds';

const NOW = Date.UTC(2026, 9, 21, 12, 0);
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();

function envelope(generatedAt = iso(10)): FeedEnvelope<{ items: unknown[] | null }> {
  return {
    generatedAt,
    source: 'RSS',
    attribution: 'Nagłówki',
    data: { items: [] },
    parts: { items: { ok: true, asOf: generatedAt } },
  };
}

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('feedFreshness — badge LIVE (< 90 min) / STALE', () => {
  it('ocenia wiek danych względem chwili „teraz”', () => {
    expect(feedFreshness(iso(30), NOW)).toBe('live');
    expect(feedFreshness(iso(89), NOW)).toBe('live');
    expect(feedFreshness(iso(91), NOW)).toBe('stale');
    expect(feedFreshness(null, NOW)).toBeNull();
    expect(feedFreshness('nie-data', NOW)).toBeNull();
  });

  it('freshnessBadge: ton i etykieta badge, brak danych = BRAK (nigdy LIVE)', () => {
    expect(freshnessBadge(iso(10), NOW)).toMatchObject({ tone: 'live', label: 'LIVE' });
    expect(freshnessBadge(iso(120), NOW)).toMatchObject({ tone: 'stale', label: 'STALE' });
    expect(freshnessBadge(null, NOW)).toMatchObject({ tone: 'neutral', label: 'BRAK' });
    expect(freshnessBadge(iso(10), NOW).title).toMatch(/10 min temu/);
  });
});

describe('partAsOf — data pobrania konkretnej części pliku', () => {
  it('preferuje parts[nazwa].asOf (fallback ma starszą datę), w razie braku generatedAt', () => {
    const env = { ...envelope(iso(5)), parts: { items: { ok: false, asOf: iso(200), error: 'x' } } };
    expect(partAsOf(env, 'items')).toBe(iso(200));
    expect(partAsOf({ ...env, parts: undefined }, 'items')).toBe(iso(5));
    expect(partAsOf({ ...env, parts: { items: { ok: false, asOf: null } } }, 'items')).toBeNull();
    expect(partAsOf(null, 'items')).toBeNull();
  });
});

describe('fmtAgo — czas względny po polsku', () => {
  it('formatuje sekundy, minuty, godziny i dni', () => {
    expect(fmtAgo(NOW - 20_000, NOW)).toBe('przed chwilą');
    expect(fmtAgo(NOW - 5 * 60000, NOW)).toBe('5 min temu');
    expect(fmtAgo(NOW - 3 * 3600000, NOW)).toBe('3 h temu');
    expect(fmtAgo(NOW - 26 * 3600000, NOW)).toBe('1 dzień temu');
    expect(fmtAgo(NOW - 3 * 86400000, NOW)).toBe('3 dni temu');
    expect(fmtAgo(NaN, NOW)).toBe('—');
  });
});

describe('loadFeed — loader z cache w module', () => {
  beforeEach(() => clearFeedCache());

  it('pobiera ./data/feeds/<nazwa>.json i trzyma wynik w cache przez 10 min', async () => {
    const fetchImpl = vi.fn(async () => okResponse(envelope()));
    const a = await loadFeed('news', { fetchImpl, now: NOW });
    expect(a?.source).toBe('RSS');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('./data/feeds/news.json');

    await loadFeed('news', { fetchImpl, now: NOW + FEED_TTL_MS - 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await loadFeed('news', { fetchImpl, now: NOW + FEED_TTL_MS + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('brak pliku, błąd sieci albo zły kształt → null (bez wyjątku)', async () => {
    const missing = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response);
    expect(await loadFeed('macro', { fetchImpl: missing, now: NOW })).toBeNull();
    clearFeedCache();
    const broken = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect(await loadFeed('macro', { fetchImpl: broken, now: NOW })).toBeNull();
    clearFeedCache();
    const bad = vi.fn(async () => okResponse({ hello: 'world' }));
    expect(await loadFeed('macro', { fetchImpl: bad, now: NOW })).toBeNull();
    clearFeedCache();
    const html = vi.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse('<html>') }) as unknown as Response);
    expect(await loadFeed('macro', { fetchImpl: html, now: NOW })).toBeNull();
  });
});
