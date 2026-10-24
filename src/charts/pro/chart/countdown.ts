import type { ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { PRO } from './theme';

/** Odstęp etykiety odliczania od środka etykiety ostatniej ceny (px CSS) — tuż pod nią. */
const BELOW_PX = 18;

/** Czas do zamknięcia świecy: „m:ss”, od godziny „g:mm:ss”. */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Odliczanie do zamknięcia bieżącej świecy pod etykietą ostatniej ceny na osi ceny, jak w TradingView. */
export class CountdownLabel implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private price = 0;
  private left = 0;
  private y = 0;
  private readonly views: readonly ISeriesPrimitiveAxisView[] = [
    {
      coordinate: () => this.y,
      text: () => fmtLeft(this.left),
      textColor: () => PRO.ink1,
      backColor: () => PRO.priceLine,
      visible: () => this.price > 0 && this.left > 0,
    },
  ];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  /** Ostatnia cena i czas do zamknięcia świecy (ms); przerysowanie tylko przy zmianie wyświetlanej sekundy albo ceny. */
  set(price: number, left: number): void {
    if (price === this.price && fmtLeft(left) === fmtLeft(this.left)) return;
    this.price = price;
    this.left = left;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    const y = this.series?.priceToCoordinate(this.price) ?? null;
    this.y = y === null ? -100 : y + BELOW_PX;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.views;
  }
}
