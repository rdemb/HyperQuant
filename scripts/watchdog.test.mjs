import { describe, expect, it } from 'vitest';
import { alertState, dataBaseFromRemote, decide, gitEnv, shouldPush } from './watchdog.mjs';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 14, 0);
const ok = { ok: true, problems: [], facts: [] };
const stale = { ok: false, problems: ['status.json: dane sprzed 45 min (próg 30 min) — skaner nie publikuje'], facts: [] };
/** Domyślnie: usługa działa od 2 h, bez wcześniejszych restartów strażnika */
const base = { now: NOW, localAsOf: NOW - MIN, serviceState: 'active', activeForMs: 120 * MIN, lastRestart: null, restarts: 0, publicCheck: true, health: ok };

describe('strażnik: decyzja o restarcie skanera', () => {
  it('skaner nie publikuje lokalnie > 10 min → restart; świeży → nic', () => {
    expect(decide({ ...base, localAsOf: NOW - 12 * MIN, health: stale })).toMatchObject({ restart: true, category: 'stall' });
    expect(decide(base)).toMatchObject({ restart: false, reason: null, category: null });
  });
  it('lokalnie świeży, ale publikacja / dziennik / rejestrator płynności stoją → restart', () => {
    for (const p of [
      stale.problems[0],
      'rejestrator płynności nie zapisuje minut od 40 min (brak arkusza z WebSocket?)',
      'dziennik prognoz: ostatnia aktualizacja 75 min temu (próg 60 min)',
      'profil płynności: ostatnia aktualizacja 45 min temu (próg 30 min)',
    ]) {
      expect(decide({ ...base, health: { ok: false, problems: [p], facts: [] } })).toMatchObject({ restart: true, category: 'stall' });
    }
  });
  it('błąd pobrania (sieć, GitHub), problem jakości (pokrycie OI) i stojące laboratorium nie restartują skanera', () => {
    for (const p of [
      'status.json: nie udało się pobrać (HTTP 503)',
      'pokrycie open interest 3% < 5% — skanowanie pozycji nie nadąża',
      'laboratorium folkloru: ostatnia aktualizacja 200 min temu (próg 180 min)',
    ]) {
      expect(decide({ ...base, health: { ok: false, problems: [p], facts: [] } })).toMatchObject({ restart: false, reason: null });
    }
  });
  it('usługa w stanie failed → restart najwyżej raz na godzinę', () => {
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null })).toMatchObject({ restart: true, category: 'failed' });
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null, lastRestart: NOW - 20 * MIN })).toMatchObject({ restart: false, category: 'failed' });
  });
  it('usługa zatrzymana ręcznie (inactive) → alarm bez restartu; stany przejściowe → nic', () => {
    expect(decide({ ...base, serviceState: 'inactive', activeForMs: null })).toMatchObject({ restart: false, category: 'inactive' });
    expect(decide({ ...base, serviceState: 'activating', activeForMs: null, health: stale })).toMatchObject({ restart: false, reason: null, category: null });
  });
  it('pierwsze 10 min działania usługi → nic; restart dopiero po godzinie działania (także po wdrożeniu właściciela)', () => {
    expect(decide({ ...base, localAsOf: NOW - 60 * MIN, activeForMs: 3 * MIN, health: stale })).toMatchObject({ restart: false, reason: null });
    const held = decide({ ...base, localAsOf: NOW - 30 * MIN, activeForMs: 40 * MIN, health: stale });
    expect(held).toMatchObject({ restart: false, category: 'stall' });
    expect(held.reason).toMatch(/godzin/);
  });
  it('stojące pliki publiczne liczą się dopiero po 30 min działania (opóźnienie publikacji i CDN)', () => {
    const h = { ok: false, problems: ['profil płynności: ostatnia aktualizacja 45 min temu (próg 30 min)'], facts: [] };
    expect(decide({ ...base, activeForMs: 20 * MIN, health: h })).toMatchObject({ restart: false, reason: null });
  });
  it('po 3 restartach w epizodzie bez poprawy → koniec restartów, kategoria giveup', () => {
    expect(decide({ ...base, localAsOf: NOW - 30 * MIN, restarts: 3, health: stale })).toMatchObject({ restart: false, category: 'giveup' });
    expect(decide({ ...base, serviceState: 'failed', activeForMs: null, restarts: 3 })).toMatchObject({ restart: false, category: 'giveup' });
  });
  it('bez repo danych (HQ_GIT_REMOTE puste) — tylko kontrole lokalne', () => {
    expect(decide({ ...base, publicCheck: false, health: stale })).toMatchObject({ restart: false, reason: null });
    expect(decide({ ...base, publicCheck: false, localAsOf: NOW - 30 * MIN })).toMatchObject({ restart: true });
  });
});

describe('strażnik: stan alarmu i wysyłka', () => {
  it('restart w problemach raportu; klucz bez słów o restarcie i bez liczb', () => {
    const restarted = alertState(stale, { restart: true, reason: 'skaner nie publikował lokalnie od 12 min', category: 'stall' });
    const held = alertState(stale, { restart: false, reason: 'skaner nie publikował lokalnie od 27 min (restart wstrzymany)', category: 'stall' });
    expect(restarted.problems.join(' ')).toMatch(/zrestartował/);
    expect(restarted.key).toBe(held.key);
    expect(alertState(ok, { restart: false, reason: null, category: null })).toMatchObject({ ok: true, key: 'ok' });
  });
  it('różne treści błędu pobrania tego samego pliku → ten sam klucz', () => {
    const a = alertState({ ok: false, problems: ['status.json: nie udało się pobrać (HTTP 503)'], facts: [] }, { restart: false, reason: null, category: null });
    const b = alertState({ ok: false, problems: ['status.json: nie udało się pobrać (fetch failed)'], facts: [] }, { restart: false, reason: null, category: null });
    expect(a.key).toBe(b.key);
  });
  it('problem wysyłany dopiero po potwierdzeniu w kolejnym przebiegu; prywatność — od razu', () => {
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'x', lastPushAt: NOW - MIN, ok: false, urgent: false, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'x', key: 'x', lastPushAt: NOW - MIN, ok: false, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'p', lastPushAt: NOW - MIN, ok: false, urgent: true, now: NOW })).toBe(true);
  });
  it('trwały problem — przypomnienie najwyżej co 6 h; powrót do „ok” od razu; „ok” — puls raz na dobę', () => {
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'x', lastPushAt: NOW - 60 * MIN, ok: false, urgent: false, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'x', lastPushAt: NOW - 7 * 60 * MIN, ok: false, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'x', seenKey: 'x', key: 'ok', lastPushAt: NOW - MIN, ok: true, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'ok', lastPushAt: NOW - 23 * 60 * MIN, ok: true, urgent: false, now: NOW })).toBe(false);
    // Puls raz na dobę także przy „ok” — uruchamia niezależną weryfikację dziennika w GitHub Actions
    expect(shouldPush({ prevKey: 'ok', seenKey: 'ok', key: 'ok', lastPushAt: NOW - 24 * 60 * MIN, ok: true, urgent: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: null, seenKey: null, key: 'ok', lastPushAt: null, ok: true, urgent: false, now: NOW })).toBe(true);
  });
});

describe('strażnik: git i źródło danych', () => {
  it('commity w UTC bez konfiguracji globalnej (bez strefy czasowej serwera)', () => {
    const env = gitEnv('/w', '/k', NOW);
    expect(env.TZ).toBe('UTC');
    expect(env.GIT_AUTHOR_DATE).toBe('2026-10-22T14:00:00+00:00');
    expect(env.GIT_COMMITTER_DATE).toBe(env.GIT_AUTHOR_DATE);
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });
  it('adres surowych plików z HQ_GIT_REMOTE (SSH i HTTPS); brak / nie-GitHub → null', () => {
    expect(dataBaseFromRemote('git@github.com:acme/hq-data.git')).toBe('https://raw.githubusercontent.com/acme/hq-data/main');
    expect(dataBaseFromRemote('https://github.com/acme/hq-data')).toBe('https://raw.githubusercontent.com/acme/hq-data/main');
    expect(dataBaseFromRemote('')).toBeNull();
    expect(dataBaseFromRemote('git@gitlab.com:a/b.git')).toBeNull();
  });
});
