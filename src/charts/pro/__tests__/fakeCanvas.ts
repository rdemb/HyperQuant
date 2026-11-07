/**
 * Płótno bez przeglądarki do testów rysowania (Klatka, zrzut ekranu, karta Czwórki): kontekst zapisuje napisy i obrazy,
 * a szerokość tekstu liczy z liczby znaków i rozmiaru kroju (0,55 em na znak).
 */

export interface FakeText {
  text: string;
  x: number;
  y: number;
  font: string;
  fill: string;
  align: string;
}

export class FakeCtx {
  font = '10px sans-serif';
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  textAlign = 'start';
  textBaseline = 'alphabetic';
  globalAlpha = 1;
  texts: FakeText[] = [];
  images: { src: unknown; args: number[] }[] = [];

  fillText(text: string, x: number, y: number) {
    this.texts.push({ text, x, y, font: this.font, fill: String(this.fillStyle), align: this.textAlign });
  }
  measureText(text: string) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.55 };
  }
  drawImage(src: unknown, ...args: number[]) {
    this.images.push({ src, args });
  }
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  rect() {}
  roundRect() {}
  clip() {}
  fill() {}
  stroke() {}
  moveTo() {}
  lineTo() {}
}

export interface FakeCanvas {
  width: number;
  height: number;
  ctx: FakeCtx;
  getContext: () => FakeCtx;
  toDataURL: () => string;
}

export function fakeCanvas(width = 0, height = 0): FakeCanvas {
  const ctx = new FakeCtx();
  return { width, height, ctx, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,' };
}

/** Kontekst płótna z wyniku funkcji rysującej (atrapa z `fakeCanvas`). */
export const ctxOf = (c: HTMLCanvasElement): FakeCtx => (c as unknown as FakeCanvas).ctx;

/** Atrapa jako HTMLCanvasElement (wejście funkcji rysujących). */
export const asCanvas = (c: FakeCanvas): HTMLCanvasElement => c as unknown as HTMLCanvasElement;

/** `document.createElement('canvas')` w teście zwraca atrapę (wywołać po imporcie modułów — i18n czyta `document` przy imporcie). */
export const fakeDocument = () => ({ createElement: () => fakeCanvas() });
