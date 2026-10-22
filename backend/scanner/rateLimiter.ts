/**
 * Własny budżet wag API Hyperliquid (limit giełdy: 1200 wag/min na IP — ten sam IP obsługuje inne usługi,
 * więc skaner bierze tylko ułamek). Wiadro żetonów z zapasem na 10 s.
 * Wycofanie: każdy kolejny błąd (429, 5xx, timeout) halvuje tempo aż do 1/8 budżetu; 429 dodatkowo wstrzymuje zapytania
 * na 30 s. Powrót stopniowy: po minucie bez błędów każdy sukces podnosi tempo ×1.25, najwyżej do budżetu.
 */
const MIN_FACTOR = 1 / 8;
const PAUSE_429_MS = 30_000;
const CALM_MS = 60_000;

export class WeightLimiter {
  private readonly perMin: number;
  private readonly capacity: number;
  private tokens: number;
  private last = 0;
  private factor = 1;
  private pauseUntil = Number.NEGATIVE_INFINITY;
  private lastFailAt = Number.NEGATIVE_INFINITY;

  constructor(perMin: number) {
    this.perMin = perMin;
    this.capacity = perMin / 6;
    this.tokens = this.capacity;
  }

  /** Bieżące tempo (wagi/min) po wycofaniu. */
  perMinAt(_now: number): number {
    return this.perMin * this.factor;
  }

  /** Rezerwuje `weight` żetonów; zwraca, ile ms trzeba odczekać przed wysłaniem zapytania. */
  reserve(weight: number, now: number): number {
    const rate = this.perMinAt(now) / 60_000;
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * rate);
      this.last = now;
    }
    this.tokens -= weight;
    const tokenWait = this.tokens >= 0 ? 0 : -this.tokens / rate;
    return Math.max(tokenWait, this.pauseUntil - now);
  }

  /** Dopłata wag poznanych dopiero po odpowiedzi (np. 1 na 20 zwróconych pozycji) — opóźnia kolejne zapytania. */
  charge(weight: number, now: number): void {
    if (weight > 0) this.reserve(weight, now);
  }

  /** Pełne tempo i brak pauzy — zadania mniej ważne niż skan pozycji czekają, gdy API jest przeciążone. */
  healthy(now: number): boolean {
    return this.factor >= 1 && now >= this.pauseUntil;
  }

  /** Błąd zapytania: tempo o połowę (do 1/8); 429 — także pauza 30 s i opróżnione wiadro. */
  fail(now: number, kind: '429' | 'error'): void {
    this.factor = Math.max(MIN_FACTOR, this.factor / 2);
    this.lastFailAt = now;
    if (kind === '429') {
      this.pauseUntil = Math.max(this.pauseUntil, now + PAUSE_429_MS);
      this.tokens = Math.min(this.tokens, 0);
    }
  }

  /** Udane zapytanie: po minucie spokoju tempo wraca stopniowo (×1.25). */
  success(now: number): void {
    if (this.factor < 1 && now - this.lastFailAt >= CALM_MS) this.factor = Math.min(1, this.factor * 1.25);
  }
}
