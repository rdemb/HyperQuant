import { PRO } from './theme';
import { C, MONO, rgba } from '../../orderflow/renderer';
import type { BadgeTone } from '../../../ui/Badge';
import { DASH } from '../../../ui/format';
import { TITLE_GUARDS, guardHits } from '../../../utils/safeguards.mjs';
import { WAIT_TEXT, liqScan } from './layerSources';
import type { LayoutNumber } from './layoutNumbers';
import { type FrameQuality, QUALITY_LEGEND, SANS, coverageText, fileStamp, qualityText, stampText } from './screenshot';
import { locale, tr } from '../../../i18n';

/**
 * Klatka (zadanie 9): obraz do publikacji w stałym rozmiarze — 1200 × 675 (16:9) albo 1080 × 1080 (1:1) — z tytułem
 * z liczbą, godziną i źródłem, obrazem (zrzut wykresu albo karta Czwórki) wpisanym w kadr bez przycinania, paskiem
 * jakości i „hyperquant.tech” w rogu. Tekst alternatywny z tymi samymi liczbami, ostrzeżenie przy więcej niż 4 warstwach
 * ceny i blokada rad w tytule (bezpieczniki bloga, utils/safeguards). Plik zostaje na komputerze: tylko pobranie PNG.
 */

export type FrameRatio = '16:9' | '1:1';

export const FRAME_SIZE = {
  '16:9': { w: 1200, h: 675 },
  '1:1': { w: 1080, h: 1080 },
} as const satisfies Record<FrameRatio, { w: number; h: number }>;

/** Najwięcej warstw na wykresie ceny, przy których Klatka zostaje czytelna. */
export const FRAME_MAX_LAYERS = 4;

export { type FrameQuality, SANS };

export interface FrameInput {
  /** Obraz do kadru: zrzut wykresu albo karta Czwórki. */
  canvas: HTMLCanvasElement;
  ratio: FrameRatio;
  /** Tytuł z liczbą; „\n” zaczyna nową linię. */
  title: string;
  /** Chwila danych (ms), w czasie lokalnym jak oś wykresu. */
  time: number;
  /** Źródło danych, np. „BTC-PERP · Hyperliquid · 5m · Świece”. */
  source: string;
  quality: FrameQuality;
  /**
   * Warstwy na wykresie ceny (`priceLayerCount`); Czwórka — 0. Kadr ich nie zmienia (obraz pokazuje wszystkie), ostrzeżenie
   * ponad 4 i ponad wzorzec układu daje `frameWarnings` w oknie Klatki.
   */
  layersShown: number;
}

/** Rozmiary w kadrze (px): marginesy, marka, tytuł (linie), godzina ze źródłem, pasek jakości. */
const METRICS: Record<FrameRatio, { pad: number; brand: number; title: number; titleLh: number; titleLines: number; meta: number; strip: number; q: number; legend: number; gap: number }> = {
  '16:9': { pad: 36, brand: 18, title: 26, titleLh: 33, titleLines: 3, meta: 15, strip: 46, q: 15, legend: 12, gap: 12 },
  '1:1': { pad: 44, brand: 22, title: 34, titleLh: 43, titleLines: 4, meta: 18, strip: 58, q: 18, legend: 14, gap: 16 },
};

const ELLIPSIS = '…';

/** Tekst skrócony z końca (najpierw całe słowa) tak, by z „…” mieścił się w `maxW`. */
function ellipsize(s: string, maxW: number, measure: (s: string) => number): string {
  let t = s.trimEnd();
  while (t.length > 0 && measure(t + ELLIPSIS) > maxW) {
    const i = t.lastIndexOf(' ');
    t = (i > 0 ? t.slice(0, i) : t.slice(0, -1)).trimEnd();
  }
  return t + ELLIPSIS;
}

/** Słowo szersze niż linia pocięte na kawałki, które się mieszczą. */
function splitLong(w: string, maxW: number, measure: (s: string) => number): string[] {
  if (measure(w) <= maxW) return [w];
  const out: string[] = [];
  let part = '';
  for (const ch of w) {
    if (part && measure(part + ch) > maxW) {
      out.push(part);
      part = '';
    }
    part += ch;
  }
  if (part) out.push(part);
  return out;
}

/**
 * Tekst w liniach o szerokości `maxW` (słowami; „\n” zaczyna nową linię, puste akapity odpadają), najwyżej `maxLines`
 * linii — przy nadmiarze ostatnia kończy się „…”.
 */
export function wrapLines(text: string, maxW: number, measure: (s: string) => number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w0 of para.trim().split(/\s+/).filter(Boolean)) {
      for (const w of splitLong(w0, maxW, measure)) {
        const next = line ? `${line} ${w}` : w;
        if (measure(next) <= maxW) line = next;
        else {
          if (line) lines.push(line);
          line = w;
        }
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const keep = lines.slice(0, Math.max(1, maxLines));
  keep[keep.length - 1] = ellipsize(keep[keep.length - 1], maxW, measure);
  return keep;
}

/** Obraz `sw × sh` wpisany w prostokąt bez przycinania, na środku; pusty obraz albo prostokąt — null. */
function contain(sw: number, sh: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } | null {
  if (!(sw > 0 && sh > 0 && box.w > 0 && box.h > 0)) return null;
  const s = Math.min(box.w / sw, box.h / sh);
  const w = sw * s;
  const h = sh * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Klatka 1200 × 675 albo 1080 × 1080 (zawsze ten rozmiar, niezależnie od gęstości pikseli ekranu). Bez kontekstu 2D — null
 * (nigdy obraz bez paska jakości).
 */
export function composeFrame(o: FrameInput): HTMLCanvasElement | null {
  const { w: W, h: H } = FRAME_SIZE[o.ratio];
  const m = METRICS[o.ratio];
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const measure = (s: string) => ctx.measureText(s).width;
  const inner = W - 2 * m.pad;
  ctx.fillStyle = PRO.page;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Marka, tytuł z liczbą, godzina i źródło
  let y = m.pad;
  ctx.font = `700 ${m.brand}px Outfit, sans-serif`;
  ctx.fillStyle = PRO.ink1;
  ctx.fillText('HyperQuant', m.pad, y);
  y += Math.round(m.brand * 1.3) + m.gap;
  ctx.font = `600 ${m.title}px ${SANS}`;
  for (const line of wrapLines(o.title, inner, measure, m.titleLines)) {
    ctx.fillText(line, m.pad, y);
    y += m.titleLh;
  }
  y += m.gap / 2;
  ctx.font = `500 ${m.meta}px ${SANS}`;
  ctx.fillStyle = PRO.ink2;
  ctx.fillText(wrapLines(`${stampText(o.time)} · ${o.source}`, inner, measure, 1)[0] ?? '', m.pad, y);
  y += Math.round(m.meta * 1.4) + m.gap;

  // Obraz wpisany w kadr bez przycinania (na środku wolnego miejsca), z cienką ramką
  const stripTop = H - m.strip;
  const box = { x: m.pad, y, w: inner, h: Math.max(0, stripTop - m.gap - y) };
  const fit = contain(o.canvas.width, o.canvas.height, box);
  if (fit) {
    ctx.drawImage(o.canvas, fit.x, fit.y, fit.w, fit.h);
    ctx.strokeStyle = PRO.divider;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(fit.x) + 0.5, Math.round(fit.y) + 0.5, Math.round(fit.w) - 1, Math.round(fit.h) - 1);
  }

  // Pasek jakości (zawsze) i adres strony w prawym dolnym rogu
  ctx.fillStyle = PRO.divider;
  ctx.fillRect(0, stripTop, W, 1);
  const mid = stripTop + m.strip / 2;
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${m.q}px ${MONO}`;
  ctx.fillStyle = PRO.ink2;
  const q = qualityText(o.quality, o.time);
  ctx.fillText(q, m.pad, mid);
  const qEnd = m.pad + measure(q);
  ctx.font = `600 ${m.q}px ${SANS}`;
  const brandW = measure('hyperquant.tech');
  ctx.textAlign = 'right';
  ctx.fillStyle = PRO.accent;
  ctx.fillText('hyperquant.tech', W - m.pad, mid);
  ctx.font = `500 ${m.legend}px ${SANS}`;
  if (qEnd + m.gap * 2 + measure(QUALITY_LEGEND) <= W - m.pad - brandW - m.gap * 2) {
    ctx.textAlign = 'left';
    ctx.fillStyle = PRO.ink3;
    ctx.fillText(QUALITY_LEGEND, qEnd + m.gap * 2, mid);
  }
  return out;
}

/** Zdanie z kropką na końcu (bez podwójnej po „.”, „?”, „!” i „…”). */
const dot = (s: string) => (/[.?!…]$/.test(s) ? s : `${s}.`);

/** Tekst alternatywny Klatki: tytuł (te same liczby), opis obrazu (`body`, np. Czwórka), źródło z godziną i jakość danych. */
export function frameAlt(o: { title: string; time: number; source: string; quality: FrameQuality; body?: string }): string {
  const title = o.title
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(dot)
    .join(' ');
  const q = o.quality;
  const has = (v: number | null): v is number => v !== null && Number.isFinite(v);
  const none = tr('brak danych', 'no data');
  const tape = has(q.tapePct)
    ? tr(`taśma pokrywa ${coverageText(q.tapePct)} widocznego zakresu`, `the tape covers ${coverageText(q.tapePct)} of the visible range`)
    : tr(`taśma ${DASH} (${q.tapeWhy ?? none})`, `tape ${DASH} (${q.tapeWhy ?? none})`);
  const map = has(q.mapPct)
    ? tr(`mapa likwidacji obejmuje ${coverageText(q.mapPct)} open interest`, `the liquidation map covers ${coverageText(q.mapPct)} of open interest`)
    : tr(`mapa ${DASH} (${q.mapWhy ?? none})`, `map ${DASH} (${q.mapWhy ?? none})`);
  const body = o.body?.trim() ? ` ${dot(o.body.trim())}` : '';
  return tr(
    `Klatka HyperQuant: ${title}${body} Źródło: ${o.source}, ${stampText(o.time)}. Jakość danych: ${tape}, ${map}. hyperquant.tech`,
    `HyperQuant frame: ${title}${body} Source: ${o.source}, ${stampText(o.time)}. Data quality: ${tape}, ${map}. hyperquant.tech`
  );
}

/**
 * Ostrzeżenia przed pobraniem: więcej warstw ceny niż 4 i niż we wzorcu panelu układu (`presetLayers`), czyli warstwy
 * dodane przez użytkownika ponad wzorzec; nietknięty wzorzec — bez ostrzeżenia. Pobrać można mimo to (obraz pokazuje
 * wszystkie warstwy).
 */
export function frameWarnings(layersShown: number, presetLayers = 0): string[] {
  const limit = Math.max(FRAME_MAX_LAYERS, presetLayers);
  if (!(layersShown > limit)) return [];
  return [
    tr(
      `Na wykresie ceny jest ${layersShown} warstw, więcej niż we wzorcu układu (${presetLayers}) i niż ${FRAME_MAX_LAYERS} czytelne w Klatce. Możesz ukryć dodane w menu Wskaźniki albo pobrać Klatkę mimo to: obraz pokaże wszystkie warstwy.`,
      `The price chart shows ${layersShown} layers, more than the layout preset (${presetLayers}) and the ${FRAME_MAX_LAYERS} a frame shows readably. You can hide the added ones in the Indicators menu or download the frame anyway: the image will show every layer.`
    ),
  ];
}

/** Nazwa pliku: hyperquant-<układ>-<RRRRMMDD-GGmm>.png (czas lokalny), kwadrat z dopiskiem „-1x1”. */
export function frameFileName(layout: string, time: number, ratio: FrameRatio = '16:9'): string {
  const slug = layout.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `hyperquant-${slug}-${fileStamp(time)}${ratio === '1:1' ? '-1x1' : ''}.png`;
}

/** Liczba w tekście Klatki: „Etykieta: wartość (plakietka)”; brak — „—” z uwagą albo „brak danych” (jak `fourNumbersText`). */
export function numberText(label: string, n: { value: string; badge: string; note?: string; flag?: string }): string {
  const tag = n.value === DASH ? (n.note ?? tr('brak danych', 'no data')) : [n.badge, n.note, n.flag].filter(Boolean).join(', ');
  return `${label}: ${n.value} (${tag})`;
}

/** Domyślny tytuł Klatki wykresu: pytanie układu i trzy liczby nagłówka z plakietkami; panel bez nagłówka — samo pytanie. */
export function defaultFrameTitle(question: string, nums: readonly LayoutNumber[] | null): string {
  if (!nums || nums.length === 0) return question;
  return `${question}\n${nums.map((n) => numberText(n.label, n)).join('; ')}`;
}

/** Powody, dla których tytułu nie można użyć (pusty, rada transakcyjna, dane prywatne); pusta lista — można pobrać. */
export function titleProblems(title: string): string[] {
  if (!title.trim()) return [tr('Wpisz tytuł Klatki, najlepiej z liczbą z wykresu.', 'Enter a frame title, ideally with a number from the chart.')];
  return guardHits(title, TITLE_GUARDS).map(({ guard, fragment }) =>
    guard.kind === 'privacy'
      ? tr(`Tytuł zawiera ${guard.why}: „${fragment}”. Klatka nie pokazuje danych prywatnych.`, `The title contains ${guard.en}: “${fragment}”. A frame shows no private data.`)
      : tr(`Tytuł zawiera ${guard.why}: „${fragment}”. Klatka opisuje rynek, nie doradza transakcji.`, `The title contains ${guard.en}: “${fragment}”. A frame describes the market; it does not advise trades.`)
  );
}

/** Pokrycie open interest przez mapę likwidacji skanera (BTC, aktualna mapa, poza powtórką); inaczej null z powodem. */
export function mapQuality(
  liq: { status: string; map: { asOf: number; coverage: { share: number; oiBtc: number } } | null },
  coin: string,
  replay: boolean
): Pick<FrameQuality, 'mapPct' | 'mapWhy'> {
  if (coin !== 'BTC') return { mapPct: null, mapWhy: tr('tylko BTC: skaner mapuje pozycje na BTC', 'BTC only: the scanner maps BTC positions') };
  if (replay) return { mapPct: null, mapWhy: tr('w powtórce bez mapy: mapa skanera to stan na teraz', 'none in a replay: the scanner map is the current state') };
  const s = liqScan(liq);
  if ('why' in s) return { mapPct: null, mapWhy: s.why };
  const c = liq.map?.coverage;
  if (!c) return { mapPct: null, mapWhy: WAIT_TEXT };
  // Bez open interest z API udział byłby zerem zastępczym
  if (!(c.oiBtc > 0) || !Number.isFinite(c.share)) return { mapPct: null, mapWhy: tr('mapa bez open interest z API', 'the map has no open interest from the API') };
  return { mapPct: c.share };
}

/** Pokrycie taśmą widocznego zakresu (`tapeCoveragePct`); NaN (brak świec) — null z powodem. */
export function tapeQuality(pct: number): Pick<FrameQuality, 'tapePct' | 'tapeWhy'> {
  return Number.isFinite(pct) ? { tapePct: pct } : { tapePct: null, tapeWhy: tr('brak świec w widocznym zakresie', 'no candles in the visible range') };
}

// ───────────────────────── plakietki na płótnie ─────────────────────────

/** Kolory plakietek jak `ui/Badge` (tokeny src/index.css): tekst, obrys 40%, tło 10%. */
const BADGE: Record<BadgeTone, { ink: string; line: string; fill: string }> = {
  live: { ink: PRO.buyInk, line: rgba(PRO.buy, 0.4), fill: rgba(PRO.buy, 0.1) },
  model: { ink: PRO.accent, line: rgba(PRO.accent, 0.4), fill: rgba(PRO.accent, 0.1) },
  sim: { ink: C.zone, line: rgba(C.zone, 0.5), fill: rgba(C.zone, 0.1) },
  stale: { ink: PRO.warn, line: rgba(PRO.warn, 0.4), fill: rgba(PRO.warn, 0.1) },
  warn: { ink: PRO.warn, line: rgba(PRO.warn, 0.4), fill: rgba(PRO.warn, 0.1) },
  // Tło surface-2
  neutral: { ink: PRO.ink2, line: PRO.divider, fill: PRO.surface2 },
};

/** Plakietka (wielkie litery) od `x`, wyśrodkowana na `mid`; zwraca jej szerokość. */
export function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, mid: number, px: number, tone: BadgeTone): number {
  const t = text.toLocaleUpperCase(locale);
  const k = BADGE[tone];
  ctx.font = `600 ${px}px ${SANS}`;
  const padX = Math.round(px * 0.5);
  const w = Math.ceil(ctx.measureText(t).width) + 2 * padX;
  const h = Math.round(px * 1.7);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x + 0.5, mid - h / 2 + 0.5, w - 1, h - 1, 3);
  else ctx.rect(x + 0.5, mid - h / 2 + 0.5, w - 1, h - 1);
  ctx.fillStyle = k.fill;
  ctx.fill();
  ctx.strokeStyle = k.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = k.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x + padX, mid);
  return w;
}
