/**
 * Własny budżet wag API Hyperliquid (limit giełdy: 1200 wag/min na IP — ten sam IP obsługuje inne usługi,
 * więc skaner bierze tylko ułamek). Wiadro żetonów z zapasem na 10 s; po 429 tempo spada o połowę na 5 min.
 */
const PENALTY_MS = 5 * 60_000;

export class WeightLimiter {
  private readonly perMin: number;
  private readonly capacity: number;
  private tokens: number;
  private last = 0;
  private penaltyUntil = Number.NEGATIVE_INFINITY;

  constructor(perMin: number) {
    this.perMin = perMin;
    this.capacity = perMin / 6;
    this.tokens = this.capacity;
  }

  perMinAt(now: number): number {
    return now < this.penaltyUntil ? this.perMin / 2 : this.perMin;
  }

  /** Rezerwuje `weight` żetonów; zwraca, ile ms trzeba odczekać przed wysłaniem zapytania. */
  reserve(weight: number, now: number): number {
    const rate = this.perMinAt(now) / 60_000;
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * rate);
      this.last = now;
    }
    this.tokens -= weight;
    return this.tokens >= 0 ? 0 : -this.tokens / rate;
  }

  /** Odpowiedź 429 / przeciążenie: połowa tempa przez 5 min i opróżnione wiadro. */
  penalize(now: number): void {
    this.penaltyUntil = now + PENALTY_MS;
    this.tokens = Math.min(this.tokens, 0);
  }
}
