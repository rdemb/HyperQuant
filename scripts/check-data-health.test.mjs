// Testy nadzoru publicznych danych skanera (świeżość, pokrycie, strażnik prywatności).
import { describe, expect, it } from 'vitest';
import { LIMITS, assessHealth, findLeaks, renderReport } from './check-data-health.mjs';

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const MIN = 60_000;

function status(over = {}) {
  return { v: 1, coin: 'BTC', asOf: NOW - 3 * MIN, addresses: 7600, positions: 260, coverage: 0.3, ageNtlP50Min: 1.5, ctxAt: NOW - 3 * MIN, apiErrors: 0, ...over };
}
function liqMap(over = {}) {
  return { v: 1, coin: 'BTC', asOf: NOW - 3 * MIN, markPx: 100000, longs: [], shorts: [], coverage: { share: 0.3 }, ageMin: { p50: 2, p90: 9, ntlP50: 1.5 }, ...over };
}
function input(over = {}) {
  const s = over.status ?? status();
  const m = over.liqMap ?? liqMap();
  return { status: s, liqMap: m, raw: { 'status.json': JSON.stringify(s), 'liq-map/BTC.json': JSON.stringify(m), 'README.md': '# dane' }, errors: {}, ...over };
}

describe('assessHealth', () => {
  it('świeże dane bez problemów → ok', () => {
    const r = assessHealth(input(), NOW);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('status.json starszy niż 30 min → problem z wiekiem w minutach', () => {
    const r = assessHealth(input({ status: status({ asOf: NOW - 45 * MIN }) }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/status\.json.*45 min/);
  });

  it('mapa likwidacji starsza niż 30 min → problem', () => {
    const r = assessHealth(input({ liqMap: liqMap({ asOf: NOW - 31 * MIN }) }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/liq-map\/BTC\.json/);
  });

  it('próg dokładnie 30 min nie jest jeszcze alarmem', () => {
    const r = assessHealth(input({ status: status({ asOf: NOW - LIMITS.maxAgeMin * MIN }) }), NOW);
    expect(r.ok).toBe(true);
  });

  it('błąd pobrania pliku → problem z treścią błędu', () => {
    const r = assessHealth(input({ status: null, errors: { 'status.json': 'HTTP 404' } }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/status\.json.*HTTP 404/);
  });

  it('plik bez poprawnego asOf → problem (nie NaN w raporcie)', () => {
    const r = assessHealth(input({ status: { v: 1 } }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).not.toMatch(/NaN/);
  });

  it('opóźnione odczyty pozycji (mediana ważona > 30 min) → problem', () => {
    const r = assessHealth(input({ status: status({ ageNtlP50Min: 42 }) }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/42 min/);
  });

  it('pokrycie open interest poniżej 5% → problem', () => {
    const r = assessHealth(input({ status: status({ coverage: 0.02 }) }), NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/2(,|\.)0 ?%/);
  });

  it('adres portfela w publikacji → alarm prywatności', () => {
    const inp = input();
    inp.raw['status.json'] = JSON.stringify({ ...status(), leak: '0x' + 'ab'.repeat(20) });
    const r = assessHealth(inp, NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/prywatno/i);
  });
});

describe('taśma likwidacji (plik opcjonalny)', () => {
  it('brak pliku taśmy (np. przed wdrożeniem skanera) nie jest alarmem', () => {
    const r = assessHealth(input({ errors: { 'liq-tape/BTC.json': 'HTTP 404' } }), NOW);
    expect(r.ok).toBe(true);
  });
  it('brak pliku kohort przed wdrożeniem nie jest alarmem; obecny jest skanowany', () => {
    expect(assessHealth(input({ errors: { 'cohorts/BTC.json': 'HTTP 404' } }), NOW).ok).toBe(true);
    const inp = input();
    inp.raw['cohorts/BTC.json'] = '{"m":"0x' + '12'.repeat(20) + '"}';
    expect(assessHealth(inp, NOW).problems.join(' ')).toMatch(/cohorts\/BTC\.json/);
  });
  it('taśma jest skanowana strażnikiem prywatności', () => {
    const inp = input();
    inp.raw['liq-tape/BTC.json'] = JSON.stringify({ events: [{ who: '0x' + 'ef'.repeat(20) }] });
    const r = assessHealth(inp, NOW);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/liq-tape\/BTC\.json/);
  });
});

describe('dziennik prognoz (gałąź ledger)', () => {
  it('podsumowanie starsze niż 60 min → problem; brak pliku (przed wdrożeniem) → nie', () => {
    const inp = input();
    inp.ledger = { asOf: NOW - 75 * MIN };
    expect(assessHealth(inp, NOW).problems.join(' ')).toMatch(/dziennik.*75 min/);
    const ok = input();
    ok.ledger = { asOf: NOW - 20 * MIN };
    expect(assessHealth(ok, NOW).ok).toBe(true);
    expect(assessHealth(input({ errors: { 'ledger/BTC/summary.json': 'HTTP 404' } }), NOW).ok).toBe(true);
  });
});

describe('findLeaks', () => {
  it('wykrywa adres EVM i IPv4, nie myli ich z liczbami JSON', () => {
    expect(findLeaks('{"px":107234.5,"asOf":1792657671870,"share":0.3016068073177374}')).toEqual([]);
    expect(findLeaks('x 0x' + '1f'.repeat(20) + ' y')).toEqual(['adres portfela (0x…)']);
    expect(findLeaks('host 10.20.30.40 ok')).toEqual(['adres IPv4']);
  });

  it('raport nie powtarza wykrytej wartości (nie utrwala wycieku w zgłoszeniu)', () => {
    const addr = '0x' + 'cd'.repeat(20);
    const inp = input();
    inp.raw['README.md'] = `kontakt ${addr}`;
    const report = renderReport(assessHealth(inp, NOW), NOW);
    expect(report).not.toContain(addr);
    expect(report).toMatch(/README\.md/);
  });
});

describe('renderReport', () => {
  it('zawiera stan, wiek danych i znacznik czasu UTC', () => {
    const report = renderReport(assessHealth(input(), NOW), NOW);
    expect(report).toMatch(/✅/);
    expect(report).toMatch(/2026-10-22 12:00 UTC/);
    expect(report).toMatch(/3 min/);
  });

  it('przy problemach wylicza je i daje wskazówkę diagnostyczną bez danych serwera', () => {
    const report = renderReport(assessHealth(input({ status: status({ asOf: NOW - 90 * MIN }) }), NOW), NOW);
    expect(report).toMatch(/⚠️/);
    expect(report).toMatch(/- .*status\.json/);
    expect(report).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});

describe('profil płynności (plik opcjonalny)', () => {
  it('brak pliku nie jest alarmem; świeży — fakt w raporcie; nieaktualny > 30 min — problem', () => {
    expect(assessHealth(input({ errors: { 'liquidity/BTC.json': 'HTTP 404' } }), NOW).ok).toBe(true);
    const fresh = assessHealth(input({ liquidity: { v: 1, asOf: NOW - 5 * MIN } }), NOW);
    expect(fresh.ok).toBe(true);
    expect(fresh.facts.map((f) => f.label)).toContain('Wiek profilu płynności');
    const stale = assessHealth(input({ liquidity: { v: 1, asOf: NOW - 45 * MIN } }), NOW);
    expect(stale.ok).toBe(false);
    expect(stale.problems.join(' ')).toMatch(/płynności/);
    // profil świeży, ale rejestrator nie zapisuje minut (np. brak arkusza z WebSocket)
    const stuck = assessHealth(input({ liquidity: { v: 1, asOf: NOW - 5 * MIN, last: NOW - 40 * MIN } }), NOW);
    expect(stuck.ok).toBe(false);
    expect(stuck.problems.join(' ')).toMatch(/nie zapisuje/);
  });
});
