// Pomocnik pól liczbowych (dawniej plan/hooks.ts)

/** Liczba z pola tekstowego: akceptuje przecinek dziesiętny i spacje tysięcy; pusta/niepoprawna → NaN. */
export function parseNum(s: string): number {
  const t = s.replace(/[\s $]/g, '').replace(',', '.');
  if (t === '') return Number.NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}
