// Stan niezależnej weryfikacji dziennika (gałąź health repo danych): znaczek, punkt kontrolny, podsumowanie dla strony.
import { describe, expect, it } from 'vitest';
import { FULL_EVERY_MS, ledgerBadge, publishVerify, sinceCommit, verifyProblem } from './verify-status.mjs';
import { VERIFY_MAX_AGE_MS } from '../src/utils/verifyFreshness.ts';

const NOW = Date.UTC(2026, 10, 11, 8, 0, 0);
const H = 3_600_000;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const latest = (over = {}) => ({ v: 1, ok: true, at: NOW - 2 * H, run: 'https://github.com/rdemb/hyperquant-data/actions/runs/1', lines: ['✓ x'], ...over });

describe('próg świeżości weryfikacji', () => {
  it('36 h', () => {
    expect(VERIFY_MAX_AGE_MS).toBe(36 * H);
  });
});

describe('znaczek shields.io (badge/ledger.json)', () => {
  it('świeża, zgodna → zielony z datą', () => {
    expect(ledgerBadge(latest(), NOW)).toEqual({ schemaVersion: 1, label: 'dziennik desku', message: 'zweryfikowany 2026-11-11', color: 'brightgreen' });
  });

  it('zgodna, ale starsza niż 36 h → czerwony „nieaktualna”, nie zielony', () => {
    const b = ledgerBadge(latest({ at: NOW - 37 * H }), NOW);
    expect(b.color).toBe('red');
    expect(b.message).toBe('nieaktualna weryfikacja 2026-11-09');
  });

  it('dokładnie 36 h — jeszcze zielony (próg jak w nadzorze danych)', () => {
    expect(ledgerBadge(latest({ at: NOW - 36 * H }), NOW).color).toBe('brightgreen');
  });

  it('weryfikacja wykryła problem → czerwony; brak wyniku → czerwony', () => {
    expect(ledgerBadge(latest({ ok: false }), NOW)).toMatchObject({ message: 'problem 2026-11-11', color: 'red' });
    expect(ledgerBadge(null, NOW)).toMatchObject({ message: 'brak weryfikacji', color: 'red' });
    expect(ledgerBadge({ ok: true, at: 'wczoraj' }, NOW).color).toBe('red');
  });
});

describe('verifyProblem (nadzór danych)', () => {
  it('świeża i zgodna → brak problemu; starsza niż 36 h albo z problemem → opis', () => {
    expect(verifyProblem(latest(), NOW)).toBeNull();
    expect(verifyProblem(latest({ at: NOW - 49 * H }), NOW)).toBe('niezależna weryfikacja dziennika: ostatnia 49 h temu (próg 36 h) — przebieg nie kończy się albo nie startuje');
    expect(verifyProblem(latest({ ok: false }), NOW)).toMatch(/^niezależna weryfikacja dziennika wykryła problem/);
    expect(verifyProblem({ v: 1 }, NOW)).toMatch(/brak poprawnego pola at/);
  });
});

describe('punkt kontrolny weryfikacji przyrostowej', () => {
  it('brak albo uszkodzony → pełny przebieg (null)', () => {
    expect(sinceCommit(null, NOW)).toBeNull();
    expect(sinceCommit({ v: 1, commit: 'xyz', fullAt: NOW }, NOW)).toBeNull();
    expect(sinceCommit({ v: 1, commit: SHA_A }, NOW)).toBeNull();
  });

  it('pełny przebieg nie starszy niż 7 dni → od zapisanego commita; starszy → znowu pełny', () => {
    expect(FULL_EVERY_MS).toBe(7 * 24 * H);
    expect(sinceCommit({ v: 1, commit: SHA_A, at: NOW - H, fullAt: NOW - 6 * 24 * H }, NOW)).toBe(SHA_A);
    expect(sinceCommit({ v: 1, commit: SHA_A, at: NOW - H, fullAt: NOW - 7 * 24 * H - 1 }, NOW)).toBeNull();
  });
});

describe('publishVerify — co trafia do gałęzi health', () => {
  const report = ['✓ 2026-10-22.jsonl: 398 linii', 'Głowa łańcucha: abc', '✓ historia git: 10 commitów, tylko dopisywanie', 'Wyniki przeliczone z rekordów: {', '}'].join('\n');
  const run = 'https://github.com/rdemb/hyperquant-data/actions/runs/2';

  it('udany pełny przebieg: nowe podsumowanie, punkt kontrolny z pełnym przebiegiem, zielony znaczek', () => {
    const r = publishVerify({ code: '0', report, prevLatest: latest({ at: NOW - 40 * H }), prevCheckpoint: null, head: SHA_B, since: null, run, nowMs: NOW });
    expect(r.latest).toEqual({ v: 1, ok: true, at: NOW, run, commit: SHA_B, lines: ['✓ 2026-10-22.jsonl: 398 linii', '✓ historia git: 10 commitów, tylko dopisywanie'] });
    expect(r.checkpoint).toEqual({ v: 1, commit: SHA_B, at: NOW, fullAt: NOW });
    expect(r.badge.color).toBe('brightgreen');
  });

  it('udany przebieg przyrostowy: punkt kontrolny przesunięty, data pełnego przebiegu zachowana', () => {
    const prev = { v: 1, commit: SHA_A, at: NOW - 20 * H, fullAt: NOW - 3 * 24 * H };
    const r = publishVerify({ code: '0', report, prevLatest: latest(), prevCheckpoint: prev, head: SHA_B, since: SHA_A, run, nowMs: NOW });
    expect(r.checkpoint).toEqual({ v: 1, commit: SHA_B, at: NOW, fullAt: prev.fullAt });
  });

  it('weryfikacja wykryła problem: podsumowanie ok=false, punkt kontrolny bez zmian, czerwony znaczek', () => {
    const prev = { v: 1, commit: SHA_A, at: NOW - 20 * H, fullAt: NOW - 3 * 24 * H };
    const r = publishVerify({ code: '1', report, prevLatest: latest(), prevCheckpoint: prev, head: SHA_B, since: SHA_A, run, nowMs: NOW });
    expect(r.latest.ok).toBe(false);
    expect(r.checkpoint).toBe(prev);
    expect(r.badge).toMatchObject({ color: 'red', message: 'problem 2026-11-11' });
  });

  it('przebieg się nie skończył (limit czasu): poprzednie podsumowanie zostaje, znaczek czerwony, gdy starsze niż 36 h', () => {
    const old = latest({ at: NOW - 50 * H });
    const r = publishVerify({ code: '', report: '', prevLatest: old, prevCheckpoint: null, head: SHA_B, since: null, run, nowMs: NOW });
    expect(r.latest).toBe(old);
    expect(r.checkpoint).toBeNull();
    expect(r.badge).toMatchObject({ color: 'red', message: 'nieaktualna weryfikacja 2026-11-09' });
    // świeże poprzednie podsumowanie — znaczek dalej zielony
    expect(publishVerify({ code: '', report: '', prevLatest: latest(), prevCheckpoint: null, head: SHA_B, since: null, run, nowMs: NOW }).badge.color).toBe('brightgreen');
  });

  it('najwyżej 40 linii wyniku (jak dotąd)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `✓ ${i}`).join('\n');
    expect(publishVerify({ code: '0', report: many, prevLatest: null, prevCheckpoint: null, head: SHA_B, since: null, run, nowMs: NOW }).latest.lines).toHaveLength(40);
  });
});
