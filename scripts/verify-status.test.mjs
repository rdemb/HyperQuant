// Stan niezależnej weryfikacji dziennika (gałąź wyników repo HyperQuant): znaczek, kotwica, podsumowanie dla strony.
import { describe, expect, it } from 'vitest';
import { anchorCommit, anchorProblem, ledgerBadge, publishVerify, verifyProblem } from './verify-status.mjs';
import { CLOCK_SKEW_MS, VERIFY_MAX_AGE_MS, verifyStale } from '../src/utils/verifyFreshness.ts';

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

describe('kotwica: ostatnio zweryfikowany commit gałęzi ledger', () => {
  it('poprawny hash → kotwica dla weryfikatora; brak albo uszkodzona → brak kotwicy (pierwszy przebieg)', () => {
    expect(anchorCommit({ v: 1, commit: SHA_A, at: NOW - H })).toBe(SHA_A);
    expect(anchorCommit(null)).toBeNull();
    expect(anchorCommit({ v: 1, commit: 'xyz' })).toBeNull();
    // czas zapisu kotwicy nie wpływa na kontrolę (cała historia zawsze sprawdzana)
    expect(anchorCommit({ v: 1, commit: SHA_A, at: NOW + 365 * 24 * H })).toBe(SHA_A);
  });

  const LOST = '✗ kotwica usunięta albo uszkodzona (verify/anchor.json), choć poprzedni wynik był zgodny — ciągłości historii git nie da się sprawdzić';

  it('kotwica usunięta albo uszkodzona przy zgodnym poprzednim wyniku → problem; brak obu plików → prawdziwy pierwszy przebieg', () => {
    expect(anchorProblem(null, latest())).toBe(LOST);
    expect(anchorProblem({ v: 1, commit: 'xyz' }, latest())).toBe(LOST);
    expect(anchorProblem(null, null)).toBeNull();
    expect(anchorProblem({ v: 1, commit: SHA_A, at: NOW - H }, latest())).toBeNull();
    // poprzedni przebieg niezgodny (np. pierwszy przebieg się nie powiódł) — kotwicy mogło jeszcze nie być
    expect(anchorProblem(null, latest({ ok: false }))).toBeNull();
  });

  it('publishVerify: kotwica zniknęła po zgodnym wyniku → czerwono, problem na początku raportu, kotwica nie powstaje z tego przebiegu', () => {
    const run = 'https://github.com/rdemb/HyperQuant/actions/runs/4';
    const r = publishVerify({ code: '0', report: '✓ historia git: 10 commitów, tylko dopisywanie', prevLatest: latest(), prevAnchor: null, head: SHA_B, run, nowMs: NOW });
    expect(r.latest.ok).toBe(false);
    expect(r.latest.lines).toEqual([LOST, '✓ historia git: 10 commitów, tylko dopisywanie']);
    expect(r.anchor).toBeNull();
    expect(r.badge).toMatchObject({ color: 'red', message: 'problem 2026-11-11' });
    // prawdziwy pierwszy przebieg (brak obu plików) — zielono i nowa kotwica
    const first = publishVerify({ code: '0', report: '✓ x', prevLatest: null, prevAnchor: null, head: SHA_B, run, nowMs: NOW });
    expect(first.latest.ok).toBe(true);
    expect(first.anchor).toEqual({ v: 1, commit: SHA_B, at: NOW });
  });
});

describe('publishVerify — co trafia do gałęzi wyników', () => {
  const report = ['✓ 2026-10-22.jsonl: 398 linii', 'Głowa łańcucha: abc', '✓ historia git: 10 commitów, tylko dopisywanie', 'Wyniki przeliczone z rekordów: {', '}'].join('\n');
  const run = 'https://github.com/rdemb/HyperQuant/actions/runs/2';

  it('udany przebieg: nowe podsumowanie, kotwica przesunięta na sprawdzony commit, zielony znaczek', () => {
    const r = publishVerify({ code: '0', report, prevLatest: latest({ at: NOW - 40 * H }), prevAnchor: { v: 1, commit: SHA_A, at: NOW - 6 * H }, head: SHA_B, run, nowMs: NOW });
    expect(r.latest).toEqual({ v: 1, ok: true, at: NOW, run, commit: SHA_B, lines: ['✓ 2026-10-22.jsonl: 398 linii', '✓ historia git: 10 commitów, tylko dopisywanie'] });
    expect(r.anchor).toEqual({ v: 1, commit: SHA_B, at: NOW });
    expect(r.badge.color).toBe('brightgreen');
  });

  it('weryfikacja wykryła problem (np. kotwica spoza historii): ok=false, kotwica bez zmian, czerwony znaczek', () => {
    const prev = { v: 1, commit: SHA_A, at: NOW - 6 * H };
    const r = publishVerify({ code: '1', report, prevLatest: latest(), prevAnchor: prev, head: SHA_B, run, nowMs: NOW });
    expect(r.latest.ok).toBe(false);
    expect(r.anchor).toBe(prev);
    expect(r.badge).toMatchObject({ color: 'red', message: 'problem 2026-11-11' });
  });

  it('przebieg się nie skończył (limit czasu): poprzednie podsumowanie zostaje, znaczek czerwony, gdy starsze niż 36 h', () => {
    const old = latest({ at: NOW - 50 * H });
    const r = publishVerify({ code: '', report: '', prevLatest: old, prevAnchor: null, head: SHA_B, run, nowMs: NOW });
    expect(r.latest).toBe(old);
    expect(r.anchor).toBeNull();
    expect(r.badge).toMatchObject({ color: 'red', message: 'nieaktualna weryfikacja 2026-11-09' });
    expect(publishVerify({ code: '', report: '', prevLatest: latest(), prevAnchor: null, head: SHA_B, run, nowMs: NOW }).badge.color).toBe('brightgreen');
  });

  it('najwyżej 40 linii wyniku (jak dotąd)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `✓ ${i}`).join('\n');
    expect(publishVerify({ code: '0', report: many, prevLatest: null, prevAnchor: null, head: SHA_B, run, nowMs: NOW }).latest.lines).toHaveLength(40);
  });
});

describe('czas wyniku z przyszłości (zapas na zegar 10 min) jest nieważny', () => {
  const MIN = 60_000;

  it('zapas 10 min; verifyStale: wynik z przyszłości ponad zapas jest nieaktualny, w zapasie — aktualny', () => {
    expect(CLOCK_SKEW_MS).toBe(10 * MIN);
    expect(verifyStale(NOW + 10 * MIN, NOW)).toBe(false);
    expect(verifyStale(NOW + 11 * MIN, NOW)).toBe(true);
    expect(verifyStale(NOW + 365 * 24 * H, NOW)).toBe(true);
  });

  it('latest.json z czasem z przyszłości: znaczek czerwony, nadzór danych zgłasza problem (nie „świeży” na zawsze)', () => {
    const future = latest({ at: NOW + 365 * 24 * H });
    expect(ledgerBadge(future, NOW)).toMatchObject({ color: 'red', message: 'nieważna data weryfikacji' });
    expect(verifyProblem(future, NOW)).toBe('niezależna weryfikacja dziennika: czas wyniku z przyszłości (2027-11-11 08:00 UTC) — wynik nieważny');
    expect(publishVerify({ code: '', report: '', prevLatest: future, prevAnchor: null, head: SHA_B, run: '', nowMs: NOW }).badge.color).toBe('red');
  });
});
