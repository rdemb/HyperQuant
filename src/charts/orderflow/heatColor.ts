/**
 * Kolory heatmapy płynności: semantyczna rampa wielobarwna (wyjątek dataviz: skala „ciepła”
 * z legendą) i normalizacja intensywności log1p(rozmiar) do percentyla 99 w widocznym oknie.
 */

/** Rampa: przezroczysty → granat → niebieski → cyjan (akcent) → bursztyn → kremowa biel (ściany). */
export type HeatRamp = { t: number; color: string; alpha: number }[];

export const HEAT_RAMP: HeatRamp = [
  { t: 0, color: '#0b1019', alpha: 0 },
  { t: 0.14, color: '#121c33', alpha: 1 },
  { t: 0.38, color: '#1e4a7a', alpha: 1 },
  { t: 0.64, color: '#3fc6dd', alpha: 1 },
  { t: 0.86, color: '#e0a045', alpha: 1 },
  { t: 1, color: '#fff4dc', alpha: 1 },
];

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pakowanie RGBA do Uint32 w kolejności bajtów ImageData (little-endian: A B G R). */
export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function unpackRgba(v: number): [number, number, number, number] {
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
}

/** Tablica 256 kolorów (Uint32) do szybkiego zapisu w ImageData. */
export function buildHeatLut(ramp: HeatRamp = HEAT_RAMP): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < ramp.length - 2 && t > ramp[k + 1].t) k++;
    const a = ramp[k];
    const b = ramp[k + 1];
    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const ca = hexRgb(a.color);
    const cb = hexRgb(b.color);
    const mix = (x: number, y: number) => Math.round(x + (y - x) * u);
    lut[i] = packRgba(mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2]), Math.round(255 * (a.alpha + (b.alpha - a.alpha) * u)));
  }
  return lut;
}

/**
 * Intensywność 0..1: log1p(rozmiar BTC) / (p99 log1p w oknie / kontrast).
 * Kontrast > 1 = niższy próg nasycenia (słabsze poziomy jaśniejsze).
 */
export function heatT(sizeBtc: number, normLog: number, contrast: number): number {
  if (!(normLog > 0) || !(sizeBtc > 0)) return 0;
  const t = (Math.log1p(sizeBtc) * contrast) / normLog;
  return t >= 1 ? 1 : t;
}

/** Rozmiar BTC odpowiadający intensywności t (do opisu legendy). */
export function sizeAtT(t: number, normLog: number, contrast: number): number {
  return Math.expm1((t * normLog) / contrast);
}
