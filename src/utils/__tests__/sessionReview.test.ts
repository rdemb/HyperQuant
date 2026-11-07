import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlogMap, BlogMapsState } from '../../state/useBlogMaps';
import type { CohortFlowState } from '../../state/useCohortFlow';
import type { DeskLedgerState } from '../../state/useDeskLedger';
import type { LiqTapeState } from '../../state/useLiqTape';
import type { VBar } from '../auction';
import type { CohortFlow } from '../cohorts';
import type { DeskLedgerSummary } from '../deskLedger';
import type { LiqTape } from '../liqTape';
import { currentTradeSession, tradeSessionOn } from '../sessionDay';
import { type ReviewInputs, type ReviewRow, reviewCards, reviewRows } from '../sessionReview';
import { mapHitsText } from '../sessionText';
import { fmtDayTime, fmtHm } from '../../charts/pro/core/time';
import { fmtPx } from '../../charts/pro/chart/layout';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026 (czas zimowy w Londynie i NY): Londyn 08:00–14:30 UTC, NY 14:30–24:00 UTC; teraz 16:20 — NY w toku */
const NOW = at(2026, 11, 3, 16, 20);
const L = tradeSessionOn(at(2026, 11, 3, 0), 'london');
const PREV_L = tradeSessionOn(at(2026, 11, 2, 0), 'london');
const NY = currentTradeSession(NOW)!;

/**
 * Cena w minucie: poprzedni Londyn (2.11) płasko 99 200, potem 99 600 do otwarcia Londynu 3.11. Londyn 3.11: IB 100 005
 * i 100 295 (IB 100 000–100 300), od 09:00 wybicie w górę (100 500), o 11:00 szczyt 100 700, do końca 100 650. NY 100 600.
 */
const px = (t: number): number => {
  if (t < L.start) return t < PREV_L.end ? 99_200 : 99_600;
  if (t < L.start + 30 * MIN) return 100_005;
  if (t < L.ibEnd) return 100_295;
  if (t < L.start + 3 * H) return 100_500;
  if (t < L.start + 3.5 * H) return 100_695;
  if (t < L.end) return 100_650;
  return 100_600;
};
const bars = (from: number, to: number): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += MIN) out.push({ time: t, open: px(t), high: px(t) + 5, low: px(t) - 5, close: px(t), volume: 1 });
  return out;
};
const ALL = bars(PREV_L.start, NOW + MIN);

const PUB = at(2026, 11, 3, 7, 5) + 20_000;
const MAP: BlogMap = {
  id: '2026-11-03-mapa-dnia',
  title: 'BTC przed Londynem',
  kind: 'dzien',
  publishedAt: PUB,
  price: 99_600,
  levels: [
    { label: 'PDL', price: 99_150 },
    { label: 'Szczyt Azji', price: 100_300 },
    { label: 'Likwidacje shortów', price: 100_700 },
    { label: 'VAH wczoraj', price: 101_000 },
  ],
  url: 'blog/2026-11-03-mapa-dnia/',
};

const TAPE: LiqTape = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 30_000,
  since: at(2026, 11, 2, 0),
  events: [],
  buckets: [
    { t: at(2026, 11, 2, 20), longUsd: 5e5, shortUsd: 0, n: 1 },
    { t: L.start + H, longUsd: 0, shortUsd: 2.5e6, n: 3 },
    { t: L.start + 3 * H, longUsd: 1e6, shortUsd: 4e6, n: 5 },
    { t: at(2026, 11, 3, 15), longUsd: 3e6, shortUsd: 0, n: 2 },
  ],
  totals: { h1: { longUsd: 0, shortUsd: 0, n: 0 }, h24: { longUsd: 0, shortUsd: 0, n: 0 } },
  calib: { n: 0, medAbsErrBp: null, p90AbsErrBp: null, medSignedErrBp: null, medAgeMin: null },
  checks: { candidates: 0, confirmed: 0, rejected: 0, failed: 0 },
  method: 'hl-fills-liquidation-v1',
};

const markout = (m60: number | null) => ({ hours: 24, hiddenHours: 0, m1: null, m5: null, m60 });
const FLOW = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 2 * MIN,
  oos: { mm: markout(-1.2), informed: markout(12.3), whale: markout(3.1), rest: markout(-2) },
} as unknown as CohortFlow;

const cov = (rate: number) => ({ rate, n: 400, nEff: 100, kupiecP: 0.41 });
const SUMMARY = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 5 * MIN,
  scores: { ret: { '60': { n: 400, crps: null, crpsBench: null, crpss: null, pitHist: [], cov90: cov(0.884), cov60: cov(0.612), covAci: null } } },
} as unknown as DeskLedgerSummary;

const READY_MAPS: BlogMapsState = { status: 'ready', maps: [MAP] };
const LIQ: LiqTapeState = { status: 'ready', tape: TAPE };
const COHORTS: CohortFlowState = { status: 'ready', flow: FLOW };
const LEDGER: DeskLedgerState = { status: 'ready', summary: SUMMARY };

const inputs = (patch: Partial<ReviewInputs> = {}): ReviewInputs => ({
  s: L,
  inProgress: false,
  now: NOW,
  bars1m: ALL,
  maps: READY_MAPS,
  expected: { usd: 875, method: 'har' },
  liq: LIQ,
  cohorts: COHORTS,
  ledger: LEDGER,
  ...patch,
});
const row = (rows: ReviewRow[], id: ReviewRow['id']) => rows.find((r) => r.id === id)!;

describe('reviewRows: rozliczenie zamkniętej sesji Londynu z mapą', () => {
  const rows = reviewRows(inputs());

  it('wiersze w kolejności: typ dnia, migracja VA, wynik IB, zakres, mapa, likwidacje, stożek, kohorty', () => {
    expect(rows.map((r) => [r.id, r.label, r.value, r.badge])).toEqual([
      ['dayType', 'Typ dnia', 'trendowy', 'MODEL'],
      ['vaMigration', 'Migracja VA', 'wyżej', 'LIVE'],
      ['ib', 'Wynik IB', 'w górę · 2,3×', 'LIVE'],
      ['range', 'Zakres / oczekiwany · HAR', '80%', 'MODEL'],
      ['map', `Mapa dnia ${fmtDayTime(PUB, NOW)}`, '2/4 dotknięte', 'LIVE'],
      ['liq', 'Likwidacje w sesji', 'longi 1,0M · shorty 6,5M', 'LIVE'],
      ['cone', 'Pokrycie stożka 1 h · 30 dni', '90%: 88% · 60%: 61%', 'MODEL'],
      ['cohorts', 'Kto wygrał · ostatnie 24 h (dane dobowe)', 'Poinformowani +12,3 pb', 'LIVE'],
    ]);
  });

  it('minuta do powtórki: koniec sesji, wybicie IB, ostatnie ekstremum, pierwsze dotknięcie mapy, największy kubełek likwidacji', () => {
    expect(rows.map((r) => [r.id, r.replayAt])).toEqual([
      ['dayType', L.end - MIN],
      ['vaMigration', L.end - MIN],
      ['ib', L.ibEnd],
      ['range', L.start + 3 * H],
      ['map', L.start + 30 * MIN],
      ['liq', L.start + 3 * H],
      ['cone', null],
      ['cohorts', null],
    ]);
  });

  it('MODEL zawsze z nazwą metody w podpowiedzi; dane dobowe i 30 dni oznaczone jako okno, nie sesja', () => {
    for (const r of rows) if (r.badge === 'MODEL') expect(r.hint, r.id).toMatch(/^MODEL · \S/);
    expect(row(rows, 'range').hint).toMatch(/^MODEL · HAR: /);
    expect(row(rows, 'dayType').hint).toMatch(/^MODEL · Dalton/);
    expect(rows.filter((r) => r.scope === 'window').map((r) => r.id)).toEqual(['cone', 'cohorts']);
    expect(row(rows, 'cohorts').hint).toContain('nie wynik tej sesji');
  });

  it('mapa: lista dotkniętych z minutą i chybionych; bez luki bez powodu', () => {
    const m = row(rows, 'map');
    expect(m.why).toBeUndefined();
    expect(m.detail).toContain(`Szczyt Azji ${fmtPx(100_300)} ✓ ${fmtHm(L.start + 30 * MIN)}`);
    expect(m.detail).toContain(`Likwidacje shortów ${fmtPx(100_700)} ✓ ${fmtHm(L.start + 3 * H)}`);
    // Okno Mapy dnia trwa do końca NY: na karcie Londynu nie „chybione”, tylko „niedotknięte do” końca Londynu (z ceną —
    // mapa bywa z dwoma poziomami o tym samym podpisie)
    expect(m.detail).toContain(`niedotknięte do ${fmtHm(L.end)}: PDL ${fmtPx(99_150)}, VAH wczoraj ${fmtPx(101_000)}`);
    expect(m.detail).not.toMatch(/chybione/);
  });

  it('mapa rozliczana jak ✓ na wykresie: od wpisu (także dotknięcie w Azji) do końca karty; „chybione” dopiero po końcu okna mapy', () => {
    // Poziom 99 600 dotknięty w Azji o 07:06 (pierwsza pełna minuta po wpisie 07:05:20), przed otwarciem Londynu
    const asia: BlogMap = { ...MAP, levels: [{ label: 'Środek Azji', price: 99_600 }, ...MAP.levels] };
    const m = row(reviewRows(inputs({ maps: { status: 'ready', maps: [asia] } })), 'map');
    expect(m.value).toBe('3/5 dotknięte');
    expect(m.detail).toContain(`Środek Azji ${fmtPx(99_600)} ✓ ${fmtHm(PUB - 20_000 + MIN)}`);
    expect(m.replayAt).toBe(PUB - 20_000 + MIN);
    // Mapa przed NY opublikowana w Londynie (okno do końca NY) — na karcie Londynu nigdy „chybione”
    const preNy: BlogMap = { ...MAP, id: '2026-11-03-mapa-przed-nowym-jorkiem', kind: 'ny', publishedAt: L.start + 5 * H + 50 * MIN };
    const p = row(reviewRows(inputs({ maps: { status: 'ready', maps: [preNy] } })), 'map');
    expect(p.detail).toContain(`niedotknięte do ${fmtHm(L.end)}`);
    expect(p.detail).not.toMatch(/chybione/);
    // Aktualizacja z Londynu (okno do końca Londynu) — po końcu okna „chybione”
    const upd: BlogMap = { ...MAP, id: '2026-11-03-aktualizacja-12', kind: 'aktualizacja', publishedAt: L.start + 3 * H };
    const u = row(reviewRows(inputs({ maps: { status: 'ready', maps: [upd] } })), 'map');
    expect(u.detail).toContain(`chybione: PDL ${fmtPx(99_150)}`);
    // NY w toku: ta sama Mapa dnia rozliczana od wpisu, tak jak ✓ na wykresie i liczba w nagłówku
    const ny = row(reviewRows(inputs({ s: NY, inProgress: true })), 'map');
    expect(ny.value).toBe('2/4 dotknięte');
    expect(ny.detail).toContain(`niedotknięte do ${fmtHm(NOW)}`);
  });

  it('VA i IB z 1m sesji: value area z profilu 70% (auction.profile) wyżej niż poprzedni Londyn', () => {
    expect(row(rows, 'vaMigration').hint).toMatch(/Value area 70% sesji Londyn/);
    expect(row(rows, 'vaMigration').hint).toContain('świec 1m');
    expect(row(rows, 'ib').hint).toContain(fmtHm(L.ibEnd));
  });
});

describe('reviewRows: braki danych dają „—” z powodem', () => {
  it('brak mapy dla sesji: wiersz mapy „—” z powodem „brak mapy”', () => {
    for (const maps of [{ status: 'ready', maps: [] }, { status: 'missing', maps: [] }] as BlogMapsState[]) {
      const m = row(reviewRows(inputs({ maps })), 'map');
      expect(m.value).toBe('—');
      expect(m.why).toMatch(/brak mapy/i);
      expect(m.replayAt).toBeNull();
    }
    // Mapa z poprzedniej doby (okno do końca NY 2.11) nie należy do Londynu 3.11
    const old = { ...MAP, id: '2026-11-02-mapa-dnia', publishedAt: PUB - DAY };
    expect(row(reviewRows(inputs({ maps: { status: 'ready', maps: [old] } })), 'map').why).toMatch(/brak mapy/i);
  });

  it('mapa tygodnia albo weekendu (bez okna): na liście, ale „bez rozliczenia (mapa tygodnia/weekendu)”', () => {
    const week: BlogMap = { ...MAP, id: '2026-11-03-mapa-tygodnia', kind: 'inne', publishedAt: L.start + H };
    const r = reviewRows(inputs({ maps: { status: 'ready', maps: [MAP, week] } })).filter((x) => x.id === 'map');
    expect(r.map((x) => x.value)).toEqual(['2/4 dotknięte', '—']);
    expect(r[1].why).toBe('bez rozliczenia (mapa tygodnia/weekendu)');
  });

  it('luka w świecach 1m: liczba dotkniętych zostaje, reszta nierozliczona (ta sama reguła co ✓ na wykresie)', () => {
    const gap = ALL.filter((b) => b.time < L.start + 4 * H || b.time >= L.start + 4 * H + 10 * MIN);
    const m = row(reviewRows(inputs({ bars1m: gap })), 'map');
    expect(m.value).toBe('2/4 dotknięte');
    // Ten sam tekst luki co nagłówek układu i Czwórka (mapHitsText)
    expect(m.why).toBe(mapHitsText(2, 4, false).gap);
    expect(m.why).toBe('reszta nierozliczona: luka w świecach 1m (brak ✓ nie znaczy „nie dotknięto”)');
    expect(m.detail).toContain(`nierozliczone: PDL ${fmtPx(99_150)}, VAH wczoraj ${fmtPx(101_000)}`);
    expect(m.detail).not.toMatch(/chybione/);
  });

  it('brak kohort: „—” z powodem (wczytywanie, brak w buildzie, same puste markouty)', () => {
    const empty = { ...FLOW, oos: { mm: markout(null), informed: markout(null), whale: markout(null), rest: markout(null) } } as CohortFlow;
    for (const cohorts of [
      { status: 'loading', flow: null },
      { status: 'unconfigured', flow: null },
      { status: 'error', flow: null },
      { status: 'ready', flow: empty },
    ] as CohortFlowState[]) {
      const c = row(reviewRows(inputs({ cohorts })), 'cohorts');
      expect(c.value, cohorts.status).toBe('—');
      expect(c.why!.length, cohorts.status).toBeGreaterThan(0);
      expect(c.label).toBe('Kto wygrał · ostatnie 24 h (dane dobowe)');
    }
  });

  it('świece 1m jeszcze się wczytują albo nie obejmują sesji: wiersze sesji „—” z powodem, bez zera', () => {
    const loading = reviewRows(inputs({ bars1m: undefined }));
    for (const id of ['dayType', 'vaMigration', 'ib', 'range'] as const) expect(row(loading, id).value, id).toBe('—');
    expect(row(loading, 'map').value).toBe('—');
    const partial = reviewRows(inputs({ bars1m: ALL.filter((b) => b.time >= L.start + H) }));
    expect(row(partial, 'dayType').why).toMatch(/nie obejmują całej sesji Londyn/);
    expect(row(partial, 'dayType').why).toContain(`świece od ${fmtDayTime(L.start + H, NOW)}`);
    // Historia 1m nie sięga początku okresu mapy: „—” z powodem (nie „nie dotknięto”)
    expect(row(partial, 'map')).toMatchObject({ value: '—', why: expect.stringContaining('nie sięgają') });
    // Poprzedni Londyn bez świec: migracja „—”, typ dnia zostaje
    const noPrev = reviewRows(inputs({ bars1m: ALL.filter((b) => b.time >= PREV_L.end) }));
    expect(row(noPrev, 'vaMigration')).toMatchObject({ value: '—', why: expect.stringContaining('poprzedniej sesji') });
    expect(row(noPrev, 'dayType').value).toBe('trendowy');
  });

  it('likwidacje: sesja sprzed okna taśmy (24 h) „—” z powodem; brak taśmy w buildzie „—”', () => {
    const prevNy = tradeSessionOn(at(2026, 11, 2, 0), 'ny');
    const r = row(reviewRows(inputs({ s: prevNy })), 'liq');
    expect(r.value).toBe('—');
    expect(r.why).toMatch(/24 h/);
    expect(row(reviewRows(inputs({ liq: { status: 'unconfigured', tape: null } })), 'liq').value).toBe('—');
  });

  it('stożek: bez podsumowania albo z małą próbą „—” z powodem', () => {
    expect(row(reviewRows(inputs({ ledger: { status: 'unconfigured', summary: null } })), 'cone').value).toBe('—');
    const few = { ...SUMMARY, scores: { ret: { '60': { ...SUMMARY.scores.ret['60'], n: 12 } } } } as unknown as DeskLedgerSummary;
    const c = row(reviewRows(inputs({ ledger: { status: 'ready', summary: few } })), 'cone');
    expect(c).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(c.why).toMatch(/12/);
  });

  it('bez oczekiwanego zakresu: „—” z powodem, metoda w podpowiedzi', () => {
    const r = row(reviewRows(inputs({ expected: { why: 'Model HAR nie daje zmienności dla tej sesji' } })), 'range');
    expect(r).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(r.hint).toMatch(/^MODEL · HAR albo Parkinson/);
  });
});

describe('reviewRows: sesja w toku', () => {
  it('NY w toku: typ dnia z dopiskiem o zmianie, brak wybicia IB „(dotąd)”, bez powtórki końca sesji', () => {
    const rows = reviewRows(inputs({ s: NY, inProgress: true }));
    expect(row(rows, 'dayType').value).toBe('normalny');
    expect(row(rows, 'dayType').hint).toContain('w toku');
    expect(row(rows, 'dayType').replayAt).toBeNull();
    expect(row(rows, 'ib').value).toBe('brak wybicia (dotąd)');
    // Ta sama sesja po zamknięciu: bez „(dotąd)”
    expect(row(reviewRows(inputs({ s: NY, inProgress: false, now: NY.end + H, bars1m: bars(PREV_L.start, NY.end + H) })), 'ib').value).toBe('brak wybicia');
    expect(row(rows, 'liq').value).toBe('longi 3,0M · shorty 0');
  });

  it('przed końcem IB: „w budowie”, typ dnia „—” z godziną końca IB', () => {
    const early = NY.start + 20 * MIN;
    const rows = reviewRows(inputs({ s: NY, inProgress: true, now: early, bars1m: ALL.filter((b) => b.time <= early) }));
    expect(row(rows, 'ib').value).toBe('w budowie');
    expect(row(rows, 'dayType')).toMatchObject({ value: '—', why: expect.stringContaining(fmtHm(NY.ibEnd)) });
  });
});

describe('karty Rozliczenia', () => {
  it('przejście na nową sesję zmienia kartę „w toku” (Londyn → NY), dwie zamknięte to zawsze Londyn i NY', () => {
    const inLondon = reviewCards(at(2026, 11, 3, 10));
    expect(inLondon.cards.map((c) => [c.s.id, c.s.start, c.inProgress])).toEqual([
      ['london', PREV_L.start, false],
      ['ny', tradeSessionOn(at(2026, 11, 2, 0), 'ny').start, false],
      ['london', L.start, true],
    ]);
    expect(inLondon.next).toBeNull();
    const inNy = reviewCards(NY.start);
    expect(inNy.cards.map((c) => [c.s.id, c.s.start, c.inProgress])).toEqual([
      ['ny', tradeSessionOn(at(2026, 11, 2, 0), 'ny').start, false],
      ['london', L.start, false],
      ['ny', NY.start, true],
    ]);
  });

  it('w sesji azjatyckiej: tylko dwie zamknięte karty i godzina otwarcia następnej sesji', () => {
    const asia = reviewCards(at(2026, 11, 4, 2));
    expect(asia.cards.map((c) => [c.s.id, c.inProgress])).toEqual([
      ['london', false],
      ['ny', false],
    ]);
    expect(asia.next).toMatchObject({ id: 'london', start: tradeSessionOn(at(2026, 11, 4, 0), 'london').start });
  });
});

describe('reviewRows: likwidacje i oczekiwany zakres — pozostałe gałęzie', () => {
  it('taśma kończy się przed końcem zamkniętej sesji albo w toku jest nieaktualna: „—” z powodem', () => {
    // Zamknięty Londyn, taśma z 12:00 (skaner przestał publikować w trakcie sesji)
    const short: LiqTapeState = { status: 'expired', tape: { ...TAPE, asOf: L.start + 4 * H } };
    const closed = row(reviewRows(inputs({ liq: short })), 'liq');
    expect(closed).toMatchObject({ value: '—', why: expect.stringContaining('przed końcem sesji') });
    // NY w toku, taśma sprzed 70 min (po otwarciu NY): suma do jej chwili byłaby nieaktualna
    const expired: LiqTapeState = { status: 'expired', tape: { ...TAPE, asOf: NOW - 70 * MIN } };
    expect(row(reviewRows(inputs({ s: NY, inProgress: true, liq: expired })), 'liq')).toMatchObject({ value: '—', why: expect.stringContaining('nieaktualna') });
  });

  it('zamknięta sesja: oczekiwanie Parkinsona sprzed otwarcia opisane w podpowiedzi; bez dopisku o bieżącym modelu HAR', () => {
    const p = row(reviewRows(inputs({ expected: { usd: 1_400, method: 'parkinson' } })), 'range');
    expect(p).toMatchObject({ value: '50%', badge: 'MODEL' });
    expect(p.hint).toMatch(/^MODEL · Parkinson: .*doby przed otwarciem sesji/);
    expect(row(reviewRows(inputs()), 'range').hint).not.toMatch(/bieżącego modelu/);
  });

  it('metoda oczekiwanego zakresu na etykiecie: zamknięta — „ex ante · Parkinson”, w toku — nazwa metody', () => {
    const park = { usd: 1_400, method: 'parkinson' } as const;
    expect(row(reviewRows(inputs({ expected: park })), 'range').label).toBe('Zakres / oczekiwany · ex ante · Parkinson');
    expect(row(reviewRows(inputs({ s: NY, inProgress: true, expected: park })), 'range').label).toBe('Zakres / oczekiwany · Parkinson');
    expect(row(reviewRows(inputs({ s: NY, inProgress: true })), 'range').label).toBe('Zakres / oczekiwany · HAR');
  });

  it('sesja w toku, model HAR w drodze: „—” z powodem „czekam na model zmienności (HAR)”', () => {
    const r = row(reviewRows(inputs({ s: NY, inProgress: true, expected: undefined, volLoading: true })), 'range');
    expect(r).toMatchObject({ value: '—', badge: 'MODEL', why: 'Czekam na model zmienności (HAR)…' });
    expect(r.hint).toBe('MODEL · HAR: Czekam na model zmienności (HAR)…');
    // Bez modelu w drodze — zwykłe „czekam na dane” (świece 5m)
    expect(row(reviewRows(inputs({ s: NY, inProgress: true, expected: undefined })), 'range').why).toBe('Czekam na dane…');
  });
});

describe('czystość modułów Rozliczenia', () => {
  it('sessionReview, sessionFacts, sessionText i fourNumbers (Czwórka) nie importują modułów UI wykresu ani powtórki', () => {
    for (const f of ['../sessionReview.ts', '../sessionFacts.ts', '../sessionText.ts', '../fourNumbers.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"][^'"]*charts\/pro\/(chart|replay)\//);
    }
  });
});
