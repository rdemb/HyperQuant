import { MONO, PRO, rgba } from './theme';

/**
 * Kolumna podpisów przy osi ceny (wspólna dla warstw stref: SMC+HL, Strefy Effort): pigułka na tle wykresu z paskiem
 * w kolorze elementu, na wysokości elementu, bez nakładania się podpisów; podpis przesunięty z wysokości elementu ma
 * kreskę do niej przy krawędzi kolumny. Kontroler zostawia na kolumnę miejsce za ostatnią świecą (`TAG_GAP_PX`).
 */

export interface Tag {
  y: number;
  text: string;
  ink: string;
  dim: boolean;
}

/** Wysokość pigułki i odstęp między pigułkami. */
export const TAG_H = 14;
const TAG_GAP = 2;
/** Miejsce za ostatnią świecą na kolumnę podpisów (dodawane do odstępu osi czasu przy widocznej warstwie z podpisami). */
export const TAG_GAP_PX = 72;

/**
 * Układ kolumny: od góry w kolejności wysokości, każdy co najmniej `TAG_H + TAG_GAP` pod poprzednim, a gdy dół wychodzi
 * poza panel — cofnięcie w górę od dołu. Zwraca środki pigułek (ta sama kolejność co `ys`).
 */
export function layoutTags(ys: readonly number[], height: number): number[] {
  const step = TAG_H + TAG_GAP;
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const placed = order.map(([y]) => y);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k], k > 0 ? placed[k - 1] + step : TAG_H / 2);
  let limit = height - TAG_H / 2;
  for (let k = placed.length - 1; k >= 0; k--) {
    if (placed[k] > limit) placed[k] = limit;
    limit = placed[k] - step;
  }
  const out = new Array<number>(ys.length);
  order.forEach(([, i], k) => (out[i] = placed[k]));
  return out;
}

/** Rysuje kolumnę: prawa krawędź pigułek `right`, krycie `a`, wysokość panelu `height`. */
export function drawTags(ctx: CanvasRenderingContext2D, tags: readonly Tag[], right: number, height: number, a: number): void {
  if (tags.length === 0) return;
  ctx.font = `600 9.5px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const ys = layoutTags(
    tags.map((t) => t.y),
    height
  );
  tags.forEach((t, i) => {
    const w = Math.ceil(ctx.measureText(t.text).width) + 9;
    const x0 = right - w;
    const y0 = Math.round(ys[i] - TAG_H / 2);
    const k = t.dim ? 0.45 : 1;
    ctx.fillStyle = rgba(PRO.bg, 0.82);
    ctx.fillRect(x0, y0, w, TAG_H);
    ctx.fillStyle = rgba(t.ink, 0.95 * k * a);
    ctx.fillRect(x0, y0, 2, TAG_H);
    if (Math.abs(ys[i] - t.y) > 3) {
      ctx.strokeStyle = rgba(t.ink, 0.5 * k * a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right + 1.5, Math.round(ys[i]) + 0.5);
      ctx.lineTo(right + 1.5, Math.round(t.y) + 0.5);
      ctx.stroke();
    }
    ctx.fillText(t.text, x0 + 5, y0 + TAG_H / 2 + 0.5);
  });
}
