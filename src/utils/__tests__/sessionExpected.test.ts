import { describe, expect, it } from 'vitest';
import type { VBar } from '../auction';
import { expectedSessionRange, tradeSessionOn } from '../sessionDay';
import { expectedFrom } from '../sessionFacts';

/**
 * Oczekiwany zakres sesji: profil godzin × świeży poziom (świece 1h). E = 0,97 · √(8/π) · √V · exp(0,60 · x),
 * V = Σ w(h) · prof(h) po godzinach sesji, x = clip(½ ln(Σ pv / Σ prof), ±1,5) z 24 zamkniętych godzin przed godziną startu.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const K = 0.97 * Math.sqrt(8 / Math.PI);
const P0 = 1e-5;
const P1 = 4e-6;
const PRICE = 100_000;
const weekend = (t: number) => [0, 6].includes(new Date(t).getUTCDay());

/** Świeca 1h o wariancji Parkinsona `pv`: ln(H/L)² / (4 ln 2) = pv, zamknięcie = PRICE */
const bar = (time: number, pv: number): VBar => {
  const r = Math.sqrt(4 * Math.LN2 * pv);
  return { time, open: PRICE, high: PRICE * Math.exp(r), low: PRICE, close: PRICE, volume: 1 };
};
/** Świece od `from` do `to` (bez `to`), wariancja z funkcji czasu */
const series = (from: number, to: number, pv: (t: number) => number): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += HOUR) out.push(bar(t, pv(t)));
  return out;
};

// Poniedziałek 9.11.2026: Londyn 08:00–14:30 UTC (6,5 godziny wag), NY 14:30–24:00 UTC (pierwsza godzina z wagą 0,5)
const MON = Date.UTC(2026, 10, 9);
const LON = tradeSessionOn(MON, 'london');
const NY = tradeSessionOn(MON, 'ny');
const FROM = MON - 90 * DAY;

const ok = (r: ReturnType<typeof expectedSessionRange>) => {
  if ('missing' in r) throw new Error(r.missing);
  return r;
};

describe('expectedSessionRange: przypadki policzone ręcznie', () => {
  it('stały profil i x = 0: E = 0,97 · √(8/π) · √V; Londyn V = 6,5 · p, typowy dzień 0,87 · E', () => {
    expect(LON.start).toBe(MON + 8 * HOUR);
    expect(LON.end).toBe(MON + 14.5 * HOUR);
    const e = ok(expectedSessionRange(series(FROM, LON.start + DAY, () => P0), LON));
    expect(e.x).toBeCloseTo(0, 12);
    expect(e.rel).toBeCloseTo(K * Math.sqrt(6.5 * P0), 12);
    expect(e.usd).toBeCloseTo(K * Math.sqrt(6.5 * P0) * PRICE, 6);
    expect(e.typical).toBeCloseTo(0.87 * e.usd, 6);
    expect(e.method).toBe('profile');
  });

  it('NY zaczyna w połowie godziny: waga 0,5 pierwszej godziny (V = 9,5 · p)', () => {
    expect(NY.start).toBe(MON + 14.5 * HOUR);
    const e = ok(expectedSessionRange(series(FROM, NY.end, () => P0), NY));
    expect(e.rel).toBeCloseTo(K * Math.sqrt(9.5 * P0), 12);
  });

  it('weekend (sobota i niedziela UTC) ma własny profil', () => {
    const sat = tradeSessionOn(Date.UTC(2026, 10, 14), 'london');
    const e = ok(expectedSessionRange(series(FROM, sat.end, (t) => (weekend(t) ? P1 : P0)), sat));
    expect(e.x).toBeCloseTo(0, 12);
    expect(e.rel).toBeCloseTo(K * Math.sqrt(6.5 * P1), 12);
  });

  // Doba przed sesją poniedziałku to niedziela 08:00 do poniedziałku 08:00: profil godzin Londynu (dni robocze 08–14)
  // jej nie zawiera, więc zmienia się tylko poziom
  const lastDay = (t: number) => t >= LON.start - DAY && t < LON.start;

  it('dwa razy większa wariancja w 24 h przed sesją: mnożnik 2^0,30', () => {
    const e = ok(expectedSessionRange(series(FROM, LON.end, (t) => (lastDay(t) ? 2 * P0 : P0)), LON));
    expect(e.x).toBeCloseTo(0.5 * Math.LN2, 12);
    expect(e.rel).toBeCloseTo(K * Math.sqrt(6.5 * P0) * 2 ** 0.3, 12);
  });

  it('przycięcie poziomu przy x = ±1,5', () => {
    const hi = ok(expectedSessionRange(series(FROM, LON.end, (t) => (lastDay(t) ? 100 * P0 : P0)), LON));
    expect(hi.x).toBe(1.5);
    expect(hi.rel).toBeCloseTo(K * Math.sqrt(6.5 * P0) * Math.exp(0.9), 12);
    const lo = ok(expectedSessionRange(series(FROM, LON.end, (t) => (lastDay(t) ? 1e-4 * P0 : P0)), LON));
    expect(lo.x).toBe(-1.5);
    expect(lo.rel).toBeCloseTo(K * Math.sqrt(6.5 * P0) * Math.exp(-0.9), 12);
  });
});

describe('expectedSessionRange: bez wglądu w przyszłość', () => {
  const past = series(FROM, LON.start, (t) => (t % (3 * HOUR) === 0 ? 2 * P0 : P0));
  const atStart = ok(expectedSessionRange(past, LON));

  it('świece po starcie sesji nie zmieniają E', () => {
    const later = [...past, ...series(LON.start, LON.start + 3 * DAY, () => 50 * P0)];
    expect(ok(expectedSessionRange(later, LON))).toEqual(atStart);
  });

  it('sesja zamknięta: E takie samo w chwili startu i dzień później (od własnej ceny sprzed otwarcia, nie bieżącej)', () => {
    const dayLater = [...past, ...series(LON.start, LON.start + DAY, (t) => 3 * P0).map((b) => ({ ...b, close: 2 * PRICE, open: 2 * PRICE, low: 2 * PRICE, high: b.high * 2 }))];
    const e = ok(expectedSessionRange(dayLater, LON));
    expect(e).toEqual(atStart);
    expect(e.open).toBe(PRICE);
  });
});

describe('expectedSessionRange: brak danych', () => {
  it('mniej niż 20 dni tego samego typu: brak liczby („—”) z powodem', () => {
    const bars = series(LON.start - 15 * DAY, LON.end, () => P0);
    expect(expectedSessionRange(bars, LON)).toEqual({ missing: 'profile', weekend: false });
    const r = expectedFrom(bars, LON);
    expect('why' in r && r.why).toBe('Mniej niż 20 dni roboczych ze świecami 1h w 80 dniach przed sesją');
  });

  it('bez świec przed sesją: brak liczby z powodem', () => {
    expect(expectedSessionRange([], LON)).toEqual({ missing: 'price' });
    const r = expectedFrom([], LON);
    expect('why' in r && r.why).toBe('Brak świecy 1h sprzed otwarcia sesji');
  });

  it('wynik dla strony i MCP: USD, typowy dzień i metoda', () => {
    const r = expectedFrom(series(FROM, LON.start, () => P0), LON);
    const usd = K * Math.sqrt(6.5 * P0) * PRICE;
    expect(r).toEqual({ usd: expect.closeTo(usd, 6), typical: expect.closeTo(0.87 * usd, 6), method: 'profile' });
  });
});
