import { utcDayStart } from '../core/sessions';
import { DAY } from '../core/time';
import { VALUE_MS, type ValueKind, type ValueRef, type ValueSource, valueReference } from '../core/valueReference';
import { type InputStore, NAKED_POC_DAYS, dayTapeOf, valueSourceFrom } from './layoutInputs';

/** Źródło przebudowujemy też co tyle ms (taśma z historii serwera dochodzi bez nowej świecy 5m). */
const REFRESH_MS = 30_000;

/**
 * Wartość okresów warstwy „Profile okresów” z jednego źródła (`valueReference`: taśma albo świece 5m), tego samego co
 * pasek Rama dnia, panel Najbliższe poziomy i nagłówek Mapy dnia. Źródło (świece 5m z taśmą od początku wykresu, najdalej
 * NAKED_POC_DAYS dób wstecz) składamy na nową zamkniętą świecę 5m, nowy plik taśmy doby, doczytaną historię albo co 30 s,
 * a wartość okresu liczymy raz na takie źródło — scena wykresu (każda klatka przy przewijaniu) tylko czyta z pamięci.
 * Okres sprzed zasięgu świec 5m nie ma wartości (warstwa bierze wtedy profil świec wykresu).
 */
export class PeriodValues {
  private key = '';
  private builtAt = Number.NEGATIVE_INFINITY;
  private src: ValueSource | null = null;
  private now = 0;
  private readonly refs = new Map<string, ValueRef | null>();

  constructor(private readonly store: InputStore) {}

  /** Źródło od początku świec wykresu `first` (najdalej NAKED_POC_DAYS dób wstecz) w chwili `now`. */
  update(first: number, now: number): void {
    const from = Math.max(utcDayStart(first), utcDayStart(now) - NAKED_POC_DAYS * DAY);
    const c5 = this.store.indicatorCandles('5m', from);
    let n = c5.length;
    while (n > 0 && c5[n - 1].t + VALUE_MS > now) n--;
    const tape = dayTapeOf(this.store);
    let files = 0;
    if (tape) for (let d = utcDayStart(from); d < utcDayStart(now); d += DAY) if (tape(d)) files++;
    const key = `${this.store.coin}|${from}|${n}|${n > 0 ? c5[0].t : 0}|${n > 0 ? c5[n - 1].t : 0}|${files}`;
    this.now = now;
    if (key === this.key && now - this.builtAt < REFRESH_MS) return;
    this.key = key;
    this.builtAt = now;
    this.src = n > 0 ? valueSourceFrom(this.store, c5.slice(0, n), from) : null;
    this.refs.clear();
  }

  /** Wartość okresu `kind` zaczynającego się o `start`; bez świec 5m okresu — null. */
  of(kind: ValueKind, start: number): ValueRef | null {
    if (!this.src) return null;
    const k = `${kind}|${start}`;
    if (!this.refs.has(k)) this.refs.set(k, valueReference(kind, start, this.src, this.now));
    return this.refs.get(k) ?? null;
  }
}
