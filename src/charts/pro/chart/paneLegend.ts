import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { MONO, PRO } from './theme';
import { fmtSignedVol } from '../../orderflow/renderer';
import { numLang } from '../../../ui/format';
import { tr } from '../../../i18n';

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

/** Fragment opisu panelu: tekst i kolor; `glue` — nie oddziela się od poprzedniego przy zawijaniu, `br` — nowy wiersz. */
export interface LegendPart {
  text: string;
  color: string;
  glue?: boolean;
  br?: boolean;
}

interface LegendLine {
  parts: LegendPart[];
  widths: number[];
  w: number;
}

/** Wiersze opisu: zawijanie grupami (fragment z doklejonymi) na szerokość `maxW`, `br` wymusza nowy wiersz. */
function wrapLegend(parts: readonly LegendPart[], measure: (t: string) => number, maxW: number): LegendLine[] {
  const lines: LegendLine[] = [];
  let cur: LegendLine = { parts: [], widths: [], w: 0 };
  let i = 0;
  while (i < parts.length) {
    if (parts[i].br) {
      lines.push(cur);
      cur = { parts: [], widths: [], w: 0 };
      i++;
      continue;
    }
    let j = i + 1;
    while (j < parts.length && parts[j].glue) j++;
    const group = parts.slice(i, j);
    const widths = group.map((p) => measure(p.text));
    const gw = widths.reduce((a, w) => a + w, 0) + 6 * (group.length - 1);
    if (cur.parts.length > 0 && cur.w + 6 + gw > maxW) {
      lines.push(cur);
      cur = { parts: [], widths: [], w: 0 };
    }
    cur.w += (cur.parts.length > 0 ? 6 : 0) + gw;
    cur.parts.push(...group);
    cur.widths.push(...widths);
    i = j;
  }
  lines.push(cur);
  return lines.filter((ln) => ln.parts.length > 0);
}

/**
 * Opis panelu (np. „CVD · sesja +1.2K”) rysowany w lewym górnym rogu — zmienia rozmiar razem z panelem.
 * Dołączany do serii panelu: warstwa „top” prymitywu serii leży nad świecami i słupkami. Z `closeId` za opisem
 * stoi krzyżyk, który ukrywa panel; z `editId` pierwszy wiersz opisu otwiera ustawienia (trafienie `edit:<editId>`).
 * Kliknięcia obsługuje wykres po identyfikatorze trafienia.
 */
export class PaneLegend implements ISeriesPrimitive<Time> {
  private parts: LegendPart[] = [];
  private requestUpdate: (() => void) | null = null;
  private readonly view: IPrimitivePaneView;
  private close: CloseBox | null = null;
  /** Pierwszy wiersz opisu (px CSS panelu). */
  private line: { x: number; w: number } | null = null;

  constructor(
    private readonly closeId?: string,
    private readonly editId?: string
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          if (this.parts.length === 0) return;
          ctx.font = `11px ${MONO}`;
          ctx.textBaseline = 'middle';
          const closeW = this.closeId ? 16 : 0;
          // Wąski panel (telefon): opis zawija się w kolejne wiersze zamiast znikać za osią ceny
          const measure = (t: string) => ctx.measureText(t).width;
          const wrap = (l: number) => wrapLegend(this.parts, measure, Math.max(120, mediaSize.width - l - 14 - closeW));
          const l = 4;
          const lines = wrap(l);
          lines.forEach((ln, k) => {
            const top = 4 + k * 20;
            ctx.fillStyle = PRO.bg;
            ctx.globalAlpha = 0.82;
            ctx.fillRect(l, top, ln.w + 10 + (k === 0 ? closeW : 0), 18);
            ctx.globalAlpha = 1;
            let x = l + 5;
            ln.parts.forEach((p, i) => {
              ctx.fillStyle = p.color;
              ctx.fillText(p.text, x, top + 9);
              x += ln.widths[i] + 6;
            });
          });
          this.line = { x: l, w: lines[0].w + 10 };
          this.close = this.closeId ? { x: l + 5 + lines[0].w + 2, y: 5, size: 16 } : null;
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
    if (this.closeId && inBox(this.close, x, y)) return closeHit(this.closeId);
    const ln = this.line;
    if (this.editId && ln && x >= ln.x && x <= ln.x + ln.w && y >= 4 && y <= 22) return { externalId: `edit:${this.editId}`, zOrder: 'top', cursorStyle: 'pointer', hitTestPriority: 2 };
    return null;
  }

  set(parts: LegendPart[]): void {
    const same =
      parts.length === this.parts.length &&
      parts.every((p, i) => p.text === this.parts[i].text && p.color === this.parts[i].color && p.glue === this.parts[i].glue && p.br === this.parts[i].br);
    if (same) return;
    this.parts = parts;
    this.requestUpdate?.();
  }
}

/**
 * Liczby taśmy świecy pod krzyżem (dawniej trzecia linia legendy nad świecami): udział delty w wolumenie taśmy, jej
 * maksimum i minimum w trakcie świecy, liczba transakcji i udział taśmy w wolumenie świecy. Bez taśmy — nic.
 */
export function deltaStatsParts(bar: {
  fp: { delta: number; buyVol: number; sellVol: number; maxDelta: number; minDelta: number; trades: number } | null;
  share: number;
  complete: boolean;
}): LegendPart[] {
  const fp = bar.fp;
  if (!fp) return [];
  const vol = fp.buyVol + fp.sellVol;
  const ink = (v: number) => (v > 0 ? PRO.buyInk : v < 0 ? PRO.sellInk : PRO.ink2);
  const parts: LegendPart[] = [];
  if (vol > 0) parts.push({ text: `(${numLang(((fp.delta / vol) * 100).toFixed(0))}%)`, color: PRO.ink3, glue: true });
  parts.push(
    { text: 'max', color: PRO.ink3 },
    { text: fmtSignedVol(fp.maxDelta), color: ink(fp.maxDelta), glue: true },
    { text: 'min', color: PRO.ink3 },
    { text: fmtSignedVol(fp.minDelta), color: ink(fp.minDelta), glue: true },
    { text: tr('Transakcje', 'Trades'), color: PRO.ink3 },
    { text: numLang(fp.trades.toLocaleString('en-US')), color: PRO.ink1, glue: true },
    { text: tr('Taśma', 'Tape'), color: PRO.ink3 },
    {
      text: `${Number.isFinite(bar.share) ? `${Math.min(100, bar.share * 100).toFixed(0)}%` : '—'}${bar.complete ? '' : tr(' · częściowa', ' · partial')}`,
      color: bar.complete ? PRO.ink1 : PRO.warn,
      glue: true,
    }
  );
  return parts;
}
