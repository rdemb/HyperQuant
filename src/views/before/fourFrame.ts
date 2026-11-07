/**
 * Czwórka w Klatce: karta czterech liczb narysowana na płótnie tak jak `FourCardView` (podpis z rynkiem, kafel z tytułem,
 * wartością, plakietką i źródłem liczby) — 16:9 jeden rząd czterech kafli, 1:1 układ 2 × 2. Płótno trafia do
 * `composeFrame`; tekst alternatywny to `fourNumbersText`.
 */
import { tr, locale } from '../../i18n';
import { type FrameRatio, SANS, drawBadge, numberText, wrapLines } from '../../charts/pro/chart/frame';
import { PRO } from '../../charts/pro/chart/theme';
import type { BadgeTone } from '../../ui/Badge';
import { DASH } from '../../ui/format';
import type { FourNumber, FourNumbers } from '../../utils/fourNumbers';

/** Rozmiar karty (px) bliski proporcji miejsca na obraz w kadrze, `cols` — kafle w rzędzie. */
const SIZE: Record<FrameRatio, { w: number; h: number; cols: number }> = {
  '16:9': { w: 1128, h: 360, cols: 4 },
  '1:1': { w: 992, h: 620, cols: 2 },
};
// Tokeny surface-1 i line (src/index.css)
const SURFACE_1 = '#0b1019';
const LINE = '#1b2533';
const HEAD_H = 52;
const PAD = 22;

/** Ton plakietki kafla (jak na karcie): brak liczby — neutralny, wiek migawki albo „tylko BTC” — nieaktualny. */
export const fourTone = (n: FourNumber): BadgeTone => (n.value === DASH ? 'neutral' : n.note ? 'stale' : n.badge === 'LIVE' ? 'live' : 'model');

function drawTile(ctx: CanvasRenderingContext2D, n: FourNumber, x: number, y: number, w: number, h: number): void {
  const measure = (s: string) => ctx.measureText(s).width;
  const tw = w - 2 * PAD;
  let cy = y + 20;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `500 14px ${SANS}`;
  ctx.fillStyle = PRO.ink3;
  ctx.fillText(wrapLines(n.title.toLocaleUpperCase(locale), tw, measure, 1)[0] ?? '', x + PAD, cy);
  cy += 26;
  ctx.font = `500 20px ${SANS}`;
  ctx.fillStyle = n.value === DASH ? PRO.ink3 : PRO.ink1;
  for (const line of wrapLines(n.value, tw, measure, 2)) {
    ctx.fillText(line, x + PAD, cy);
    cy += 27;
  }
  cy += 4;
  // Plakietka (wiek migawki albo „tylko BTC” zamiast niej), „luka” obok
  const bw = drawBadge(ctx, n.note ?? n.badge, x + PAD, cy + 11, 12, fourTone(n));
  if (n.flag) drawBadge(ctx, n.flag, x + PAD + bw + 8, cy + 11, 12, 'stale');
  cy += 34;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `400 14px ${SANS}`;
  ctx.fillStyle = PRO.ink3;
  const lines = Math.max(1, Math.floor((y + h - 16 - cy) / 19));
  for (const line of wrapLines(n.hint, tw, measure, lines)) {
    ctx.fillText(line, x + PAD, cy);
    cy += 19;
  }
}

/** Karta Czwórki na płótnie dla proporcji Klatki `ratio`. */
export function fourCanvas(n: FourNumbers, ratio: FrameRatio): HTMLCanvasElement {
  const { w: W, h: H, cols } = SIZE[ratio];
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.fillStyle = SURFACE_1;
  ctx.fillRect(0, 0, W, H);
  // Podpis karty: rynek po lewej, „opis, nie sygnał” po prawej
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `500 15px ${SANS}`;
  ctx.fillStyle = PRO.ink3;
  ctx.fillText(`${tr('Czwórka', 'Four numbers')} · ${n.coin}`.toLocaleUpperCase(locale), PAD, HEAD_H / 2);
  ctx.textAlign = 'right';
  ctx.fillText(tr('Cztery liczby przed sesją. Opis, nie sygnał.', 'Four numbers before the session. A description, not a signal.'), W - PAD, HEAD_H / 2);
  ctx.fillStyle = LINE;
  ctx.fillRect(0, HEAD_H, W, 1);
  // Kafle z kreską 1 px między nimi
  const rows = Math.ceil(n.items.length / cols);
  const tileW = (W - (cols - 1)) / cols;
  const tileH = (H - HEAD_H - 1 - (rows - 1)) / rows;
  n.items.forEach((item, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = c * (tileW + 1);
    const y = HEAD_H + 1 + r * (tileH + 1);
    ctx.fillStyle = LINE;
    if (c > 0) ctx.fillRect(x - 1, y, 1, tileH);
    if (r > 0) ctx.fillRect(x, y - 1, tileW, 1);
    drawTile(ctx, item, x, y, tileW, tileH);
  });
  // Ramkę karty rysuje Klatka (wokół obrazu w kadrze)
  return out;
}

/** Domyślny tytuł Klatki Czwórki: rynek i dwie pierwsze liczby z danymi (z plakietkami); bez danych — sam podpis. */
export function fourTitle(n: FourNumbers): string {
  const head = tr(`Czwórka ${n.coin} przed sesją`, `Four numbers ${n.coin} before the session`);
  const shown = n.items.filter((i) => i.value !== DASH).slice(0, 2);
  return shown.length > 0 ? `${head}\n${shown.map((i) => numberText(i.title, i)).join('; ')}` : head;
}
