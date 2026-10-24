import { PRO } from './theme';

/** Zrzut wykresu z paskiem marki (do publikacji): nazwa, rynek, interwał, czas i adres strony. */
export function brandedScreenshot(chartCanvas: HTMLCanvasElement, cssWidth: number, subtitle: string, when: Date): HTMLCanvasElement {
  const ratio = cssWidth > 0 ? chartCanvas.width / cssWidth : 1;
  const band = Math.round(40 * ratio);
  const out = document.createElement('canvas');
  out.width = chartCanvas.width;
  out.height = chartCanvas.height + band;
  const ctx = out.getContext('2d');
  if (!ctx) return chartCanvas;
  ctx.fillStyle = PRO.page;
  ctx.fillRect(0, 0, out.width, band);
  ctx.drawImage(chartCanvas, 0, band);
  ctx.fillStyle = PRO.divider;
  ctx.fillRect(0, band - Math.max(1, Math.round(ratio)), out.width, Math.max(1, Math.round(ratio)));

  const pad = Math.round(14 * ratio);
  const mid = band / 2;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(16 * ratio)}px Outfit, sans-serif`;
  ctx.fillStyle = PRO.ink1;
  ctx.fillText('HyperQuant', pad, mid);
  const brandW = ctx.measureText('HyperQuant').width;
  ctx.font = `500 ${Math.round(12 * ratio)}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = PRO.ink2;
  const stamp = when.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`${subtitle} · ${stamp}`, pad + brandW + Math.round(12 * ratio), mid);
  ctx.textAlign = 'right';
  ctx.fillStyle = PRO.accent;
  ctx.fillText('rdemb.github.io/HyperQuant', out.width - pad, mid);
  return out;
}

/** Zapisuje płótno jako PNG. */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
