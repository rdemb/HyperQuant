import { PRO } from './theme';
import { fmtHm } from '../core/time';
import { MONO } from '../../orderflow/renderer';
import { DASH } from '../../../ui/format';
import { locale, tr } from '../../../i18n';

/**
 * Jakość danych obrazu (pasek jakości na zrzucie i w Klatce): pokrycie widocznego zakresu taśmą (`tapeCoveragePct`) i
 * pokrycie open interest przez mapę likwidacji skanera (`coverage.share`) — oba jako ułamek 0–1; brak — null.
 */
export interface FrameQuality {
  tapePct: number | null;
  mapPct: number | null;
  /** Powody braku (tekst alternatywny Klatki). */
  tapeWhy?: string;
  mapWhy?: string;
}

/** Ułamek pokrycia w procentach, w dół (100% tylko przy pełnym pokryciu); brak albo NaN — „—”. */
export const coverageText = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? DASH : `${Math.floor(Math.min(1, Math.max(0, v)) * 100 + 1e-9)}%`;

/** Pasek jakości: „taśma 12% · mapa 47% · 16:22” (godzina lokalna, jak oś wykresu); brak danych — „—”. */
export function qualityText(q: Pick<FrameQuality, 'tapePct' | 'mapPct'>, time: number): string {
  const tape = coverageText(q.tapePct);
  const map = coverageText(q.mapPct);
  return tr(`taśma ${tape} · mapa ${map} · ${fmtHm(time)}`, `tape ${tape} · map ${map} · ${fmtHm(time)}`);
}

/** Objaśnienie paska jakości (po prawej, gdy się mieści). */
export const QUALITY_LEGEND = tr('taśma: pokrycie widocznego zakresu · mapa: pokrycie open interest przez skaner', 'tape: coverage of the visible range · map: open interest covered by the scanner');

/** Wysokość paska jakości na zrzucie (px CSS). */
const QUALITY_BAND = 24;

/**
 * Zrzut wykresu z paskiem marki (do publikacji): nazwa, rynek, interwał, czas i adres strony; pod wykresem zawsze pasek
 * jakości (`qualityText`) — bez możliwości wyłączenia.
 */
export function brandedScreenshot(chartCanvas: HTMLCanvasElement, cssWidth: number, subtitle: string, when: Date, quality: FrameQuality): HTMLCanvasElement {
  const ratio = cssWidth > 0 ? chartCanvas.width / cssWidth : 1;
  const band = Math.round(40 * ratio);
  const strip = Math.round(QUALITY_BAND * ratio);
  const out = document.createElement('canvas');
  out.width = chartCanvas.width;
  out.height = chartCanvas.height + band + strip;
  const ctx = out.getContext('2d');
  if (!ctx) return chartCanvas;
  const hair = Math.max(1, Math.round(ratio));
  ctx.fillStyle = PRO.page;
  ctx.fillRect(0, 0, out.width, band);
  ctx.drawImage(chartCanvas, 0, band);
  ctx.fillStyle = PRO.divider;
  ctx.fillRect(0, band - hair, out.width, hair);

  const pad = Math.round(14 * ratio);
  const mid = band / 2;
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(16 * ratio)}px Outfit, sans-serif`;
  ctx.fillStyle = PRO.ink1;
  ctx.fillText('HyperQuant', pad, mid);
  const brandW = ctx.measureText('HyperQuant').width;
  ctx.font = `500 ${Math.round(12 * ratio)}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = PRO.ink2;
  const stamp = when.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`${subtitle} · ${stamp}`, pad + brandW + Math.round(12 * ratio), mid);
  ctx.textAlign = 'right';
  ctx.fillStyle = PRO.accent;
  ctx.fillText('hyperquant.tech', out.width - pad, mid);

  // Pasek jakości pod wykresem
  const top = band + chartCanvas.height;
  ctx.fillStyle = PRO.page;
  ctx.fillRect(0, top, out.width, strip);
  ctx.fillStyle = PRO.divider;
  ctx.fillRect(0, top, out.width, hair);
  const sm = top + strip / 2;
  ctx.textAlign = 'left';
  ctx.font = `500 ${Math.round(11 * ratio)}px ${MONO}`;
  ctx.fillStyle = PRO.ink2;
  const text = qualityText(quality, when.getTime());
  ctx.fillText(text, pad, sm);
  const textW = ctx.measureText(text).width;
  ctx.font = `500 ${Math.round(11 * ratio)}px "Plus Jakarta Sans", sans-serif`;
  // Objaśnienie tylko wtedy, gdy nie nachodzi na liczby (wąski wykres na telefonie)
  if (pad + textW + Math.round(24 * ratio) + ctx.measureText(QUALITY_LEGEND).width <= out.width - pad) {
    ctx.textAlign = 'right';
    ctx.fillStyle = PRO.ink3;
    ctx.fillText(QUALITY_LEGEND, out.width - pad, sm);
  }
  return out;
}

/** Znacznik czasu w nazwie pliku: RRRRMMDD-GGmm w czasie lokalnym. */
export function fileStamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Zapisuje płótno jako PNG (lokalnie, przez pobranie w przeglądarce — bez wysyłania gdziekolwiek). */
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
