import { describe, expect, it } from 'vitest';
import { alertState, decide, shouldPush } from './watchdog.mjs';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 14, 0);
const ok = { ok: true, problems: [], facts: [] };
const stale = { ok: false, problems: ['status.json: dane sprzed 45 min (próg 30 min) — skaner nie publikuje'], facts: [] };

describe('strażnik: decyzja o restarcie skanera', () => {
  it('skaner nie publikuje lokalnie > 10 min → restart; świeży → bez restartu', () => {
    expect(decide({ now: NOW, localAsOf: NOW - 12 * MIN, serviceActive: true, lastRestart: null, health: stale })).toMatchObject({ restart: true });
    expect(decide({ now: NOW, localAsOf: NOW - 2 * MIN, serviceActive: true, lastRestart: null, health: ok })).toMatchObject({ restart: false, reason: null });
  });
  it('lokalnie świeży, ale publikacja stoi → restart (zawieszony push do repo danych)', () => {
    expect(decide({ now: NOW, localAsOf: NOW - 1 * MIN, serviceActive: true, lastRestart: null, health: stale })).toMatchObject({ restart: true });
  });
  it('usługa zatrzymana (np. limit restartów systemd) → restart', () => {
    expect(decide({ now: NOW, localAsOf: NOW - 3 * MIN, serviceActive: false, lastRestart: null, health: ok })).toMatchObject({ restart: true });
  });
  it('najwyżej jeden restart na godzinę; brak pliku lokalnego (start) → bez restartu', () => {
    expect(decide({ now: NOW, localAsOf: NOW - 30 * MIN, serviceActive: true, lastRestart: NOW - 20 * MIN, health: stale })).toMatchObject({ restart: false });
    expect(decide({ now: NOW, localAsOf: null, serviceActive: true, lastRestart: null, health: ok })).toMatchObject({ restart: false });
  });
  it('stojący rejestrator płynności albo dziennik prognoz przy świeżym status.json → restart', () => {
    for (const p of [
      'rejestrator płynności nie zapisuje minut od 40 min (brak arkusza z WebSocket?)',
      'dziennik prognoz: ostatnia aktualizacja 75 min temu (próg 60 min)',
      'profil płynności: ostatnia aktualizacja 45 min temu (próg 30 min)',
    ]) {
      const h = { ok: false, problems: [p], facts: [] };
      expect(decide({ now: NOW, localAsOf: NOW - MIN, serviceActive: true, lastRestart: null, health: h })).toMatchObject({ restart: true });
    }
  });
  it('usługa działa krócej niż 10 min (świeży start, wdrożenie) → bez restartu mimo starych danych', () => {
    expect(decide({ now: NOW, localAsOf: NOW - 60 * MIN, serviceActive: true, activeForMs: 3 * MIN, lastRestart: null, health: stale })).toMatchObject({ restart: false, reason: null });
    expect(decide({ now: NOW, localAsOf: NOW - 60 * MIN, serviceActive: true, activeForMs: 30 * MIN, lastRestart: null, health: stale })).toMatchObject({ restart: true });
  });
  it('błąd pobrania z repo danych (sieć serwera / GitHub) nie restartuje skanera', () => {
    const net = { ok: false, problems: ['status.json: nie udało się pobrać (HTTP 503)'], facts: [] };
    expect(decide({ now: NOW, localAsOf: NOW - MIN, serviceActive: true, lastRestart: null, health: net })).toMatchObject({ restart: false, reason: null });
  });
  it('problem niezwiązany ze świeżością (np. pokrycie OI) nie restartuje skanera', () => {
    const cov = { ok: false, problems: ['pokrycie open interest 3% < 5% — skanowanie pozycji nie nadąża'], facts: [] };
    expect(decide({ now: NOW, localAsOf: NOW - 1 * MIN, serviceActive: true, lastRestart: null, health: cov })).toMatchObject({ restart: false });
  });
});

describe('strażnik: stan alarmu i wysyłka', () => {
  it('restart dopisany do problemów; klucz stanu z posortowanych problemów', () => {
    const a = alertState(stale, { restart: true, reason: 'skaner nie publikował lokalnie od 12 min' });
    expect(a.ok).toBe(false);
    expect(a.problems.join(' ')).toMatch(/restart/i);
    expect(alertState(ok, { restart: false, reason: null })).toMatchObject({ ok: true, key: 'ok' });
  });
  it('wysyłka przy zmianie stanu; trwały problem — przypomnienie najwyżej co 6 h; „ok” bez powtórek', () => {
    expect(shouldPush({ prevKey: 'ok', key: 'ok', lastPushAt: NOW - 24 * 60 * MIN, ok: true, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'ok', key: 'x', lastPushAt: NOW - MIN, ok: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'x', key: 'x', lastPushAt: NOW - 60 * MIN, ok: false, now: NOW })).toBe(false);
    expect(shouldPush({ prevKey: 'x', key: 'x', lastPushAt: NOW - 7 * 60 * MIN, ok: false, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: 'x', key: 'ok', lastPushAt: NOW - MIN, ok: true, now: NOW })).toBe(true);
    expect(shouldPush({ prevKey: null, key: 'ok', lastPushAt: null, ok: true, now: NOW })).toBe(true);
  });
});
