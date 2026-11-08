/**
 * Narzędzie `day_map`: dzisiejsza Mapa dnia z bloga, wybrana tak jak warstwa „Mapa z bloga” na wykresie (`pickMap`:
 * najnowsza Mapa dnia z bieżącej doby UTC), z rozliczeniem dotknięć poziomów tą samą regułą co ✓ na wykresie
 * (`mapWindow` + `settleRange` na świecach 1m Hyperliquid od wpisu) i pokryciem świec (`minutesCovered`).
 */
import { utcDayStart } from '../../../src/charts/pro/core/sessions';
import { tr } from '../../../src/i18n';
import { pickMap } from '../../../src/utils/blogMaps';
import { type VBar, toVBars } from '../../../src/utils/auction';
import { type MapKind, mapWindow, minutesCovered, settleRange } from '../../../src/utils/mapSettlement';
import { type Envelope, type Num, type SourceRef, envelope, guardedLabel, iso, num } from '../envelope';
import type { Sources } from '../sources';
import type { ToolDef } from './index';
import { BLOG_LEVEL_NOTE } from './shared';

const NAME = 'day_map';
const MIN = 60_000;

export interface DayMapLevel {
  /** Etykieta z wpisu; null — wstrzymana przez strażnika treści (powód w `labelWhy`), cena i dotknięcie zostają. */
  label: string | null;
  labelWhy: string | null;
  /** Poziom z tekstu wpisu (nie z modelu). */
  price: Num;
  /** true — dotknięty (low ≤ poziom ≤ high świecy 1m); false — bez dotknięcia do chwili świec przy pełnych świecach; null — nierozliczony. */
  touched: boolean | null;
  /** Początek świecy 1m pierwszego dotknięcia (ISO UTC). */
  touchedAt: string | null;
}

export interface DayMapData {
  map: { id: string; kind: MapKind; publishedAt: string; postUrl: string; levels: DayMapLevel[] } | null;
  why: string | null;
  /** Procent pełnych minut okna mapy (od wpisu do chwili świec) ze świecą 1m; 100 — rozliczenie pełne. */
  coverage: Num;
}

const NO_MINUTE = tr('od wpisu nie minęła jeszcze pełna minuta', 'not a full minute since the post yet');

/** Pełne minuty okna mapy w chwili `at`: [ceil(from), min(at, to) − 1 min] — ten sam przedział co `complete` w `settleRange`. */
function fullMinutes(from: number, to: number, at: number): { start: number; last: number } {
  return { start: Math.ceil(from / MIN) * MIN, last: Math.floor(Math.min(at, to) / MIN) * MIN - MIN };
}

/**
 * Pokrycie świecami 1m pełnych minut okna w chwili `at` (`fullMinutes`), więc 100% wtedy i tylko wtedy, gdy rozliczenie
 * jest pełne. Przy luce udział minut ze świecą, zaokrąglony w dół; bez pełnej minuty — null z powodem.
 */
function coverageOf(bars: readonly VBar[], from: number, to: number, at: number): Num {
  const { start, last } = fullMinutes(from, to, at);
  const method = 'minutesCovered';
  if (last < start) return num(null, 'pct', 'LIVE', { why: NO_MINUTE, method });
  if (minutesCovered(bars, start, last)) return num(100, 'pct', 'LIVE', { method });
  const total = (last - start) / MIN + 1;
  const have = new Set(bars.filter((b) => b.time >= start && b.time <= last && b.time % MIN === 0).map((b) => b.time)).size;
  return num(Math.floor((have / total) * 1000) / 10, 'pct', 'LIVE', { method, note: tr('luka w świecach 1m', 'gap in the 1m candles') });
}

async function run(src: Sources): Promise<Envelope<DayMapData>> {
  const now = src.now();
  // `pickMap` bierze tylko Mapę dnia z bieżącej doby UTC, więc świece od początku doby (≤ 1440) obejmują jej okno.
  // Oba żądania równolegle: całość mieści się w jednym limicie czasu (10 s), a klucz pamięci świec jest stały przez dobę.
  const [got, c] = await Promise.all([src.blogMaps(), src.candles('1m', utcDayStart(now))]);
  const sources: SourceRef[] = [{ name: tr('Mapy z bloga HyperQuant', 'HyperQuant blog maps'), url: got.url, asOf: got.ok ? iso(got.asOf ?? got.at) : null }];
  const none = (why: string, notes: string[] = []) => envelope(NAME, { map: null, why, coverage: num(null, 'pct', 'LIVE', { why }) }, sources, now, notes);
  if (!got.ok) return none(tr(`plik map z bloga niedostępny (${got.why})`, `the blog maps file is unavailable (${got.why})`));

  const m = pickMap(got.value.maps, now);
  if (!m) return none(tr('Brak Mapy dnia opublikowanej dziś (doba UTC).', 'No Day map published today (UTC day).'));

  const levels = (touch: (i: number) => { touched: boolean | null; touchedAt: number | null }): DayMapLevel[] =>
    m.levels.map((l, i) => {
      const t = touch(i);
      // Etykieta z radą albo adresem: sama etykieta wstrzymana (label null z powodem), poziom zostaje
      return { ...guardedLabel(l.label), price: num(l.price, 'price', 'LIVE', { note: BLOG_LEVEL_NOTE }), touched: t.touched, touchedAt: t.touchedAt === null ? null : iso(t.touchedAt) };
    });
  // Adres wpisu z identyfikatora (sprawdzonego wzorcem `isMapId`), nie z pola `url` pliku
  const head = { id: m.id, kind: m.kind, publishedAt: iso(m.publishedAt), postUrl: `${src.cfg.siteBase}/blog/${m.id}/` };
  const unsettled = (why: string, coverage = num(null, 'pct', 'LIVE', { why }), notes: string[] = []) =>
    envelope(NAME, { map: { ...head, levels: levels(() => ({ touched: null, touchedAt: null })) }, why, coverage }, sources, now, notes);

  const w = mapWindow(m.kind, m.publishedAt);
  // `pickMap` bez wybranego id zwraca tylko Mapę dnia (`dzien`), a ona zawsze ma okno: null tu to błąd programu (zwężenie typu)
  if (!w) throw new Error(`mapWindow: brak okna dla mapy rodzaju ${m.kind}`);

  sources.push({ name: 'Hyperliquid candleSnapshot BTC 1m', url: c.url, asOf: c.ok ? iso(c.at) : null });
  if (!c.ok) return unsettled(tr(`świece 1m Hyperliquid niedostępne (${c.why})`, `Hyperliquid 1m candles unavailable (${c.why})`));
  // Pusta lista to brak danych, jak nieudane żądanie, a nie „0% pokrycia”
  if (c.value.length === 0) return unsettled(tr('Hyperliquid nie zwrócił świec 1m', 'Hyperliquid returned no 1m candles'));

  const bars = toVBars(c.value);
  // Rozliczenie na chwilę migawki świec (z pamięci do 60 s starszej niż `now`): bez minut, których migawka nie widziała
  const settledAt = Math.min(now, c.at);
  const r = settleRange(m.levels, bars, w.from, w.to, settledAt);
  const coverage = coverageOf(bars, w.from, w.to, settledAt);
  const window = tr(
    `Okno mapy od wpisu do końca sesji NY (${iso(w.to)}); touched:false znaczy „bez dotknięcia do ${iso(settledAt)}” (chwila świec).`,
    `Map window from the post to the end of the NY session (${iso(w.to)}); touched:false means “not touched up to ${iso(settledAt)}” (the candle time).`
  );
  if (!r) return unsettled(tr('świece 1m nie sięgają wpisu', 'the 1m candles do not reach the post'), coverage, [window]);
  const { start, last } = fullMinutes(w.from, w.to, settledAt);
  // Przed pierwszą pełną minutą `complete` to prawda pustego przedziału: nic jeszcze nie rozliczono
  const settled = r.complete && last >= start;
  const data: DayMapData = {
    map: {
      ...head,
      levels: levels((i) => {
        const at = r.levels[i]?.touchedAt ?? null;
        // Przy luce w świecach albo przed pierwszą pełną minutą brak dotknięcia nic nie znaczy — null, nie false
        return { touched: at !== null ? true : settled ? false : null, touchedAt: at };
      }),
    },
    why: settled ? null : last < start ? NO_MINUTE : tr('luka w świecach 1m: poziomy bez dotknięcia są nierozliczone', 'gap in the 1m candles: levels without a touch are unsettled'),
    coverage,
  };
  return envelope(NAME, data, sources, now, [window]);
}

export const dayMap: ToolDef = {
  name: NAME,
  title: tr('Mapa dnia z bloga HyperQuant', 'HyperQuant blog day map'),
  description: tr(
    'Dzisiejsza mapa poziomów BTC z bloga HyperQuant (najnowsza „Mapa dnia” z bieżącej doby UTC, jak warstwa na wykresie strony): każdy poziom z informacją, czy cena go dotknęła od wpisu (świece 1m Hyperliquid) i o której minucie, pokrycie świec i link do wpisu. Bez argumentów. Dane publiczne, tylko odczyt; opis rynku, nie porada inwestycyjna.',
    "Today's BTC level map from the HyperQuant blog (the latest “Day map” post of the current UTC day, as drawn on the site's chart): each level with whether price has touched it since the post (Hyperliquid 1m candles) and at which minute, the candle coverage and a link to the post. No arguments. Public read-only data; market description, not investment advice."
  ),
  run: (src) => run(src),
};
