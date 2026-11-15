/**
 * Adres powtórki (`#charts?replay=…`) bez warstw: rdzeń `replayHash` bez zależności od ustawień wykresu, żeby pierwszy
 * kontakt W sesji (onboarding) nie ciągnął modułów wykresu przed pierwszym malowaniem. Warstwy dokłada `link.replayHash`.
 */
export interface HashCore {
  source: string;
  coin: string;
  interval?: string | null;
  view?: string | null;
  from?: number | null;
  to?: number | null;
  t?: number | null;
  station?: string | null;
}

// Ten sam zapis co link.ts: ucięte tylko zerowe milisekundy
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function replayHashParts(l: HashCore): string[] {
  const parts = [`replay=${l.source}`, `m=${l.coin}`];
  if (l.interval) parts.push(`i=${l.interval}`);
  if (l.view) parts.push(`v=${l.view}`);
  if (l.from != null) parts.push(`from=${iso(l.from)}`);
  if (l.to != null) parts.push(`to=${iso(l.to)}`);
  if (l.t != null) parts.push(`t=${iso(l.t)}`);
  if (l.station) parts.push(`station=${l.station}`);
  return parts;
}

export const replayHashCore = (l: HashCore): string => `#charts?${replayHashParts(l).join('&')}`;
