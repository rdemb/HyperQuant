import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { MONO, PRO } from './theme';

/** Przycisk ukrycia panelu (px CSS panelu): prostokąt trafienia. */
export interface CloseBox {
  x: number;
  y: number;
  size: number;
}

/** Krzyżyk ukrycia panelu (wskazanie pokazuje kursor). */
export function drawClose(ctx: CanvasRenderingContext2D, b: CloseBox): void {
  const m = 4;
  ctx.strokeStyle = PRO.ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(b.x + m, b.y + m);
  ctx.lineTo(b.x + b.size - m, b.y + b.size - m);
  ctx.moveTo(b.x + b.size - m, b.y + m);
  ctx.lineTo(b.x + m, b.y + b.size - m);
  ctx.stroke();
}

export const inBox = (b: CloseBox | null, x: number, y: number): boolean => !!b && x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size;

/** Wynik trafienia krzyżyka: identyfikator `pane:<ustawienie>` trafia do kliknięcia wykresu. */
export const closeHit = (id: string): PrimitiveHoveredItem => ({ externalId: `pane:${id}`, zOrder: 'top', cursorStyle: 'pointer', hitTestPriority: 2 });

/**
 * Logo TradingView (wymagane licencją) w lewym dolnym rogu najniższego panelu: 35 × 19 px, 10 px od lewej i od dołu
 * (pomiar 24.10, układ 2×2). W niskim panelu opis przesuwa się za logo.
 */
const LOGO_W = 35;
const LOGO_H = 19;
const LOGO_MARGIN = 10;

/** Fragment opisu panelu: tekst i kolor. */
export interface LegendPart {
  text: string;
  color: string;
}

/**
 * Opis panelu (np. „CVD · sesja +1.2K”) rysowany w lewym górnym rogu — zmienia rozmiar razem z panelem.
 * Dołączany do serii panelu: warstwa „top” prymitywu serii leży nad świecami i słupkami. Z `closeId` za opisem
 * stoi krzyżyk, który ukrywa panel (kliknięcie obsługuje wykres po identyfikatorze trafienia).
 */
export class PaneLegend implements ISeriesPrimitive<Time> {
  private parts: LegendPart[] = [];
  private requestUpdate: (() => void) | null = null;
  private readonly view: IPrimitivePaneView;
  private close: CloseBox | null = null;
  /** Panel jest najniższy (pod nim tylko oś czasu) — dzieli róg z logo. */
  private bottom = false;

  constructor(private readonly closeId?: string) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          if (this.parts.length === 0) return;
          ctx.font = `11px ${MONO}`;
          ctx.textBaseline = 'middle';
          const widths = this.parts.map((p) => ctx.measureText(p.text).width);
          const total = widths.reduce((a, w) => a + w, 0) + 6 * (this.parts.length - 1);
          const closeW = this.closeId ? 16 : 0;
          const l = this.bottom && mediaSize.height < 4 + 18 + LOGO_H + LOGO_MARGIN ? LOGO_MARGIN + LOGO_W + 4 : 4;
          ctx.fillStyle = PRO.bg;
          ctx.globalAlpha = 0.82;
          ctx.fillRect(l, 4, total + 10 + closeW, 18);
          ctx.globalAlpha = 1;
          let x = l + 5;
          this.parts.forEach((p, i) => {
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, x, 13);
            x += widths[i] + 6;
          });
          this.close = this.closeId ? { x: l + 5 + total + 2, y: 5, size: 16 } : null;
          if (this.close) drawClose(ctx, this.close);
        }),
    };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    return this.closeId && inBox(this.close, x, y) ? closeHit(this.closeId) : null;
  }

  setBottom(on: boolean): void {
    if (on === this.bottom) return;
    this.bottom = on;
    this.requestUpdate?.();
  }

  set(parts: LegendPart[]): void {
    const same = parts.length === this.parts.length && parts.every((p, i) => p.text === this.parts[i].text && p.color === this.parts[i].color);
    if (same) return;
    this.parts = parts;
    this.requestUpdate?.();
  }
}
