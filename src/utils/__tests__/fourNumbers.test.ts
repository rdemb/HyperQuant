import { describe, expect, it } from 'vitest';
import { fmtDm, fmtHm } from '../../charts/pro/core/time';
import {
  type FourNumbers,
  clarityNum,
  fourNumbersText,
  hourWidth,
  hourWidthNum,
  lastClosedNy,
  liqFuel,
  nextSessionHour,
  sessionHourAt,
} from '../fourNumbers';
import { tradeSessionOn } from '../sessionDay';
import { mapHitsText } from '../sessionText';
import { ALL, DAY, DAY_MAP, H, LIQ_MAP, NOW, NY, at, hours, inputs } from './fixtures/fourNumbers';

describe('lastClosedNy: ostatnia zamknięta sesja NY', () => {
  it('w Azji — NY z poprzedniej doby UTC; w sesji NY — wczorajsza', () => {
    expect(lastClosedNy(NOW)).toEqual(NY);
    expect(lastClosedNy(at(2026, 11, 7, 16))).toEqual(NY);
    expect(lastClosedNy(at(2026, 11, 8, 0, 10))).toEqual(tradeSessionOn(at(2026, 11, 7, 0), 'ny'));
  });
});

describe('clarityNum (1): typ dnia ostatniej sesji NY i trafienia mapy z bloga', () => {
  it('dzień trendowy, Mapa dnia 2/4 dotknięte (pierwszeństwo przed mapą przed NY)', () => {
    const n = clarityNum(inputs());
    expect(n).toMatchObject({ id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL' });
    expect(n.note).toBeUndefined();
    expect(n.flag).toBeUndefined();
    expect(n.hint).toMatch(/^MODEL · Dalton: /);
    expect(n.hint).toContain(`NY ${fmtDm(NY.start)}`);
    expect(n.hint).toContain('3,3× IB');
    expect(n.hint).toContain('Mapa dnia');
    expect(n.hint).toContain('2/4');
  });

  it('luka w świecach 1m w oknie mapy: „X/Y” i uwaga „luka” jak w nagłówku Rozliczenia (ten sam pomocnik)', () => {
    const gap = ALL.filter((b) => b.time < at(2026, 11, 6, 12) || b.time >= at(2026, 11, 6, 12, 5));
    const n = clarityNum(inputs({ bars1m: gap }));
    const head = mapHitsText(2, 4, false);
    expect(n).toMatchObject({ value: 'trendowy · mapa 2/4', badge: 'MODEL', flag: head.note });
    expect(n.flag).toBe('luka');
    expect(n.hint).toContain(head.gap!);
    expect(n.hint).toContain('reszta nierozliczona: luka w świecach 1m');
  });

  it('bez mapy dla tej sesji, z mapami w drodze, poza BTC — „mapa —” z powodem', () => {
    expect(clarityNum(inputs({ maps: { status: 'ready', maps: [] } }))).toMatchObject({ value: 'trendowy · mapa —' });
    expect(clarityNum(inputs({ maps: { status: 'ready', maps: [] } })).hint).toContain(`Brak mapy z bloga dla sesji NY ${fmtDm(NY.start)}`);
    expect(clarityNum(inputs({ maps: { status: 'loading', maps: [] } })).hint).toContain('Czekam na dane');
    expect(clarityNum(inputs({ maps: { status: 'missing', maps: [] } })).hint).toContain('plik map z bloga niedostępny');
    const eth = clarityNum(inputs({ coin: 'ETH' }));
    expect(eth.value).toBe('trendowy · mapa —');
    expect(eth.hint).toContain('tylko BTC');
    // Mapa tygodnia (bez okna sesji) nie jest rozliczana
    const week = clarityNum(inputs({ maps: { status: 'ready', maps: [{ ...DAY_MAP, kind: 'inne' }] } }));
    expect(week.value).toBe('trendowy · mapa —');
  });

  it('świece nie obejmują sesji albo jeszcze się wczytują — „—” z powodem', () => {
    const late = clarityNum(inputs({ bars1m: ALL.filter((b) => b.time >= NY.start + H) }));
    expect(late.value).toBe('—');
    expect(late.hint).toContain('nie obejmują całej sesji NY');
    const wait = clarityNum(inputs({ bars1m: undefined }));
    expect(wait).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(wait.hint).toContain('Czekam na dane');
    expect(clarityNum(inputs({ bars1m: { why: 'Błąd sieci' } })).hint).toContain('Błąd sieci');
  });
});

describe('liqFuel (2): paliwo 1% pod i nad ceną z mapy likwidacji', () => {
  it('suma kubełków po środku kubełka w [p·0,99, p) i (p, p·1,01], obie strony mapy', () => {
    // Pod: 99 050 (1M) + 99 850 (2M) + 99 950 (0,5M); nad: 100 050 (3M) + 100 950 (0,4M)
    expect(liqFuel(LIQ_MAP, 100_000)).toEqual({ below: 3.5e6, above: 3.4e6 });
    // Kubełek dokładnie na cenie nie należy do żadnej strony
    expect(liqFuel(LIQ_MAP, 100_050)).toEqual({ below: 1e6 + 2e6 + 5e5, above: 4e5 + 8e6 });
  });
});

describe('nextSessionHour i hourWidth (3): typowa szerokość najbliższej godziny sesji', () => {
  it('w Azji — godzina otwarcia Londynu; w sesji — następna pełna godzina; godzina z otwarciem NY — NY', () => {
    expect(nextSessionHour(NOW)).toEqual({ hour: at(2026, 11, 7, 8), s: tradeSessionOn(at(2026, 11, 7, 0), 'london'), opens: true, k: 0 });
    expect(nextSessionHour(at(2026, 11, 7, 7))).toMatchObject({ hour: at(2026, 11, 7, 8), opens: true, k: 0 });
    expect(nextSessionHour(at(2026, 11, 7, 10, 20))).toMatchObject({ hour: at(2026, 11, 7, 11), opens: false, k: 3, s: { id: 'london' } });
    expect(nextSessionHour(at(2026, 11, 7, 13, 10))).toMatchObject({ hour: at(2026, 11, 7, 14), opens: true, k: 0, s: { id: 'ny' } });
    // Godzina otwarcia NY to 14:00–15:00 UTC, więc 15:00 to pierwsza pełna godzina po niej
    expect(nextSessionHour(at(2026, 11, 7, 14, 10))).toMatchObject({ hour: at(2026, 11, 7, 15), opens: false, k: 1, s: { id: 'ny' } });
    // Koniec NY o północy UTC: następna godzina sesji to otwarcie Londynu
    expect(nextSessionHour(at(2026, 11, 7, 23, 20))).toMatchObject({ hour: at(2026, 11, 8, 8), opens: true, s: { id: 'london' } });
    // Czas letni: Londyn od 07:00 UTC, NY od 13:30 UTC
    expect(nextSessionHour(at(2026, 7, 1, 5, 30))).toMatchObject({ hour: at(2026, 7, 1, 7), opens: true, s: { id: 'london' } });
    expect(nextSessionHour(at(2026, 7, 1, 12, 10))).toMatchObject({ hour: at(2026, 7, 1, 13), opens: true, s: { id: 'ny' } });
  });

  it('sessionHourAt: godzina z otwarciem sesji należy do otwieranej; w Azji null', () => {
    expect(sessionHourAt(at(2026, 11, 7, 3))).toBeNull();
    expect(sessionHourAt(at(2026, 11, 7, 8))).toMatchObject({ s: { id: 'london' }, opens: true });
    expect(sessionHourAt(at(2026, 11, 7, 14))).toMatchObject({ s: { id: 'ny' }, opens: true });
    expect(sessionHourAt(at(2026, 11, 7, 23))).toMatchObject({ s: { id: 'ny' }, opens: false });
    // Tydzień między zmianą czasu w Londynie (25.10) i w NY (1.11): NY otwiera o 13:30 UTC
    expect(sessionHourAt(at(2026, 10, 28, 13))).toMatchObject({ s: { id: 'ny' }, opens: true });
  });

  it('przez zmianę czasu 25.10: godzina otwarcia Londynu to 07:00 UTC, potem 08:00 UTC — próba z tej samej godziny sesji', () => {
    const t = nextSessionHour(at(2026, 11, 1, 6, 30));
    expect(t).toMatchObject({ hour: at(2026, 11, 1, 8), opens: true, k: 0 });
    // Okno 12.10–31.10: 13 dni przed zmianą (otwarcie 07:00 UTC) i 7 po (08:00 UTC); każda próba to godzina otwarcia (100)
    const list = hours(at(2026, 10, 1, 0), at(2026, 11, 1, 6));
    expect(hourWidth(list, t, at(2026, 11, 1, 6, 30))).toEqual({ median: 100, n: 20 });
    // Trzecia godzina Londynu (k = 2): 09:00 UTC przed zmianą, 10:00 UTC po niej
    const k2 = nextSessionHour(at(2026, 11, 1, 9, 20));
    expect(k2).toMatchObject({ hour: at(2026, 11, 1, 10), opens: false, k: 2 });
    expect(hourWidth(hours(at(2026, 10, 1, 0), at(2026, 11, 1, 9)), k2, at(2026, 11, 1, 9, 20))).toEqual({ median: 200, n: 20 });
  });

  it('przez zmianę czasu w NY (1.11): godzina otwarcia NY 13:00 UTC, potem 14:00 UTC', () => {
    const t = nextSessionHour(at(2026, 11, 3, 13, 10));
    expect(t).toMatchObject({ hour: at(2026, 11, 3, 14), opens: true, s: { id: 'ny' } });
    expect(hourWidth(hours(at(2026, 10, 1, 0), at(2026, 11, 3, 13)), t, at(2026, 11, 3, 13, 10))).toEqual({ median: 500, n: 20 });
  });

  it('mniej niż 10 próbek — null; świeca bez liczb odpada z próby', () => {
    const t = nextSessionHour(NOW);
    expect(hourWidth(hours(t.hour - 9 * DAY, NOW - H), t, NOW)).toEqual({ median: null, n: 9 });
    const bad = hours(t.hour - 25 * DAY, NOW - H).map((b) => (b.time === at(2026, 11, 6, 8) ? { ...b, high: Number.NaN } : b));
    expect(hourWidth(bad, t, NOW)).toEqual({ median: 100, n: 19 });
  });

  it('hourWidthNum: MODEL „mediana 20 dni” z godziną sesji; za mało historii — „—” z powodem', () => {
    const n = hourWidthNum(inputs({ bars1h: hours(at(2026, 10, 10, 0), NOW - H) }));
    expect(n).toMatchObject({ id: 'hourWidth', title: `Szerokość · Londyn ${fmtHm(at(2026, 11, 7, 8))}`, value: '100 USD', badge: 'MODEL' });
    expect(n.hint).toMatch(/^MODEL · mediana 20 dni: /);
    expect(n.hint).toContain('godzina otwarcia Londyn');
    expect(n.hint).toContain('20 ostatnich sesji Londyn');
    const few = hourWidthNum(inputs({ bars1h: hours(at(2026, 10, 29, 0), NOW - H) }));
    expect(few).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(few.hint).toContain('min. 10');
    expect(hourWidthNum(inputs({ bars1h: undefined })).hint).toContain('Czekam na dane');
  });
});

describe('fourNumbersText', () => {
  it('tekst w jednej linii: wszystkie cztery wartości z plakietkami, uwagami i brakiem danych', () => {
    const n: FourNumbers = {
      coin: 'BTC',
      now: NOW,
      items: [
        { id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL', flag: 'luka', hint: 'h' },
        { id: 'fuel', title: 'Paliwo ±1%', value: 'pod 3,5M · nad 3,4M', badge: 'LIVE', note: '5 min', hint: 'h' },
        { id: 'hourWidth', title: 'Szerokość · Londyn 09:00', value: '—', badge: 'MODEL', hint: 'za mało historii' },
        { id: 'vwap', title: 'Od VWAP', value: '—', badge: 'LIVE', note: 'tylko BTC', hint: 'h' },
      ],
    };
    const text = fourNumbersText(n);
    expect(text).not.toContain('\n');
    expect(text).toContain(`Czwórka BTC, ${fmtDm(NOW)} ${fmtHm(NOW)}`);
    expect(text).toContain('Czytelność wczoraj: trendowy · mapa 2/4 (MODEL, luka)');
    expect(text).toContain('Paliwo ±1%: pod 3,5M · nad 3,4M (LIVE, 5 min)');
    expect(text).toContain('Szerokość · Londyn 09:00: — (brak danych)');
    expect(text).toContain('Od VWAP: — (tylko BTC)');
  });
});
