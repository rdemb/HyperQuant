import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { MONO, PRO } from './theme';

/** Fragment opisu panelu: tekst i kolor. */
export interface LegendPart {
  text: string;
  color: string;
}

/**
 * Opis panelu (np. „CVD · sesja +1.2K”) rysowany w lewym górnym rogu — zmienia rozmiar razem z panelem.
 * Dołączany do serii panelu: warstwa „top” prymitywu serii leży nad świecami i słupkami.
 */
export class PaneLegend implements ISeriesPrimitive<Time> {
  private parts: LegendPart[] = [];
  private requestUpdate: (() => void) | null = null;
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          if (this.parts.length === 0) return;
          ctx.font = `11px ${MONO}`;
          ctx.textBaseline = 'middle';
          const widths = this.parts.map((p) => ctx.measureText(p.text).width);
          const total = widths.reduce((a, w) => a + w, 0) + 6 * (this.parts.length - 1);
          ctx.fillStyle = PRO.bg;
          ctx.globalAlpha = 0.82;
          ctx.fillRect(4, 4, total + 10, 18);
          ctx.globalAlpha = 1;
          let x = 9;
          this.parts.forEach((p, i) => {
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, x, 13);
            x += widths[i] + 6;
          });
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

  set(parts: LegendPart[]): void {
    const same = parts.length === this.parts.length && parts.every((p, i) => p.text === this.parts[i].text && p.color === this.parts[i].color);
    if (same) return;
    this.parts = parts;
    this.requestUpdate?.();
  }
}
