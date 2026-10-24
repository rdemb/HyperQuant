import { INTERVALS } from '../core/time';
import { type ChartSettings } from '../chart/settings';
import { STATIONS, type StationId } from '../chart/stations';
import { LAYERS_OFF } from '../chart/templates';
import { MARKETS, type Market } from '../store/proStore';

/**
 * Link do chwili w powtórce (także z lekcji):
 * `#charts?replay=history&m=BTC&i=5m&v=footprint&from=2026-10-24T16:00:00Z&to=…&t=…&layers=vwap,profile&zone=75000-75200`.
 * `replay` — źródło nagrania: `history` (gałąź historii serwera) albo `lessons` (kopia przy lekcjach); `m`, `i`, `v` jak w linku
 * do widoku; `from` i `to` — zakres nagrania (bez nich: ostatnia doba z nagrania), `t` — chwila pauzy na start (bez niej:
 * godzina przed końcem); `layers` — warstwy wykresu ceny (nazwy pól ustawień bez „show”, od małej litery: vwap,
 * vwapBands, sessionVwap, profile, periodProfiles, devPoc, tpo, levels, sessions, ib, zones, auctions, heatmap, bubbles,
 * clashes, lots; liq i whales w powtórce nic nie pokazują) albo `station` — wzorzec stacji (z `layers` warstwy z linku
 * zastępują warstwy stacji); `zone` — podświetlony przedział ceny `od-do`. Zakres najwyżej doba (dłuższy jest przycinany
 * od początku).
 */

/** Wersja formatu linku (lekcje sprawdzają ją przed zbudowaniem linków); zmiana znaczenia pól = nowa wersja. */
export const REPLAY_LINK_VERSION = 1;

export type ReplaySource = 'history' | 'lessons';

export interface ReplayLink {
  source: ReplaySource;
  coin: Market;
  interval: string | null;
  view: ChartSettings['view'] | null;
  from: number | null;
  to: number | null;
  t: number | null;
  /** Klucze ustawień warstw (showVwap…); null — warstwy z ustawień albo stacji. */
  layers: (keyof typeof LAYERS_OFF)[] | null;
  station: StationId | null;
  zone: [number, number] | null;
}

type LayerKey = keyof typeof LAYERS_OFF;
const LAYER_KEYS = Object.keys(LAYERS_OFF) as LayerKey[];
const layerName = (k: LayerKey) => k.slice(4, 5).toLowerCase() + k.slice(5);

const time = (s: string | null): number | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

/** Link powtórki z adresu strony; null, gdy adres nie prowadzi do powtórki. */
export function parseReplayLink(hash: string): ReplayLink | null {
  if (!hash.startsWith('#charts')) return null;
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const source = q.get('replay');
  if (source !== 'history' && source !== 'lessons') return null;
  const m = q.get('m');
  const i = q.get('i');
  const v = q.get('v');
  const st = q.get('station');
  const layers = q.get('layers');
  const zone = (q.get('zone') ?? '').split('-').map(Number);
  return {
    source,
    coin: m && (MARKETS as readonly string[]).includes(m) ? (m as Market) : 'BTC',
    interval: i && INTERVALS.some((x) => x.id === i) ? i : null,
    view: v === 'candles' || v === 'footprint' ? v : null,
    from: time(q.get('from')),
    to: time(q.get('to')),
    t: time(q.get('t')),
    layers: layers === null ? null : LAYER_KEYS.filter((k) => layers.split(',').includes(layerName(k))),
    station: STATIONS.some((s) => s.id === st) ? (st as StationId) : null,
    zone: zone.length === 2 && zone.every((x) => x > 0) ? [Math.min(zone[0], zone[1]), Math.max(zone[0], zone[1])] : null,
  };
}

/** Adres strony dla powtórki (pola bez wartości pomijane). */
export function replayHash(l: Partial<ReplayLink> & { source: ReplaySource; coin: Market }): string {
  const parts = [`replay=${l.source}`, `m=${l.coin}`];
  if (l.interval) parts.push(`i=${l.interval}`);
  if (l.view) parts.push(`v=${l.view}`);
  if (l.from != null) parts.push(`from=${iso(l.from)}`);
  if (l.to != null) parts.push(`to=${iso(l.to)}`);
  if (l.t != null) parts.push(`t=${iso(l.t)}`);
  if (l.station) parts.push(`station=${l.station}`);
  if (l.layers) parts.push(`layers=${l.layers.map(layerName).join(',')}`);
  if (l.zone) parts.push(`zone=${l.zone[0]}-${l.zone[1]}`);
  return `#charts?${parts.join('&')}`;
}

/** Zmiany ustawień wykresu z linku: interwał, rodzaj wykresu i warstwy (wszystkie poza wymienionymi wyłączone). */
export function linkPatch(l: ReplayLink): Partial<ChartSettings> {
  const out: Partial<ChartSettings> = { coin: l.coin };
  if (l.interval) out.interval = l.interval;
  if (l.view) out.view = l.view;
  if (l.layers) {
    for (const k of LAYER_KEYS) out[k] = false;
    for (const k of l.layers) out[k] = true;
  }
  return out;
}
