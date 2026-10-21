/**
 * Tokeny kolorów scen 3D (liczby hex dla three.js) — te same wartości co w docs/STYLEGUIDE.md §2.
 * Kupno/sprzedaż zawsze z drugim kanałem (pozycja, kształt, etykieta w podpowiedzi).
 */
export const T3 = {
  bg: 0x070a11,
  panel: 0x0b1019,
  surface2: 0x101826,
  surface3: 0x16202f,
  line: 0x1b2533,
  lineStrong: 0x283447,
  ink1: 0xeef2f7,
  ink2: 0xa9b4c4,
  ink3: 0x7a889c,
  accent: 0x3fc6dd,
  buy: 0x19a88e,
  sell: 0xd9582e,
  level: 0xe0a045,
  zone: 0x9085e9,
} as const;

/** Te same tokeny jako CSS (znaczniki w podpowiedziach HTML). */
export const T3_CSS = {
  accent: '#3fc6dd',
  buy: '#19a88e',
  sell: '#d9582e',
  level: '#e0a045',
  zone: '#9085e9',
  ink2: '#a9b4c4',
  ink3: '#7a889c',
} as const;

/** Subtelna emisja materiałów — Lab może lekko świecić, ale bez prześwietleń. */
export const GLOW = 0.12;

/** Gęstość pikseli: 1 dla programowego WebGL, 1.5 na telefonie, maks. 2 na desktopie. */
export function labPixelRatio(isSoftwareGl: boolean): number {
  if (isSoftwareGl) return 1;
  const phone =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  return Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
}

/** Na wąskim ekranie panel sterowania sceny startuje zwinięty (więcej miejsca na płótno). */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

/**
 * Pionowe FOV kamery zależne od proporcji płótna: w pionowej ramce (telefon) poszerzamy kąt,
 * żeby poziomy kadr sceny był taki jak na desktopie (inaczej boki sceny są ucięte).
 */
export function labFov(aspect: number, base = 42): number {
  const designAspect = 1.25;
  if (!(aspect > 0) || aspect >= designAspect) return base;
  const half = Math.atan(Math.tan((base * Math.PI) / 360) * (designAspect / aspect));
  return Math.min(80, (half * 360) / Math.PI);
}
