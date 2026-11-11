import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildHeatLut } from '../../charts/orderflow/heatColor';
import { fmtVol } from '../../charts/orderflow/footprint';
import { compact } from '../../charts/pro/chart/FlowPanels';
import { fmtPx } from '../../charts/pro/chart/layout';
import { LIQ_RAMP } from '../../charts/pro/chart/theme';
import type { BookFrame, BookHistory } from '../../charts/pro/core/book';
import { type LadderRow, bidShare, bucketOf, heatHistory, ladderRows, levelKey, tradedAt } from '../../charts/pro/core/ladder';
import { fmtHms } from '../../charts/pro/core/time';
import type { HeadFlow, HeadNow } from '../../charts/pro/core/queueHead';
import { type OpenWall, type WallFate, distanceBins, nearPrice } from '../../charts/pro/core/wallFates';
import type { ProStore } from '../../charts/pro/store/proStore';
import type { WhaleOrder } from '../../utils/whaleLayer';
import { numLang } from '../../ui/format';
import { tr } from '../../i18n';
import { HelpButton } from '../../ui/HelpButton';
import { VERDICT, fateTitle } from './verdicts';

/**
 * Drabina „kto stoi w kolejce”: stała siatka cen wybranej agregacji arkusza Hyperliquid z wielkością, liczbą zleceń
 * i średnim zleceniem poziomu (jedna duża ręka czy tłum), mini mapą ciepła ostatnich 15 minut przy każdej cenie,
 * wartością transakcji, które w tym czasie zdjęły ten poziom, i znacznikami: zlecenia wielorybów (pseudonimy na dobę,
 * także stopy i TP spoza arkusza), ściany w arkuszu i losy ścian z ostatnich minut.
 */

export const HEAT_MS = 15 * 60_000;
const ROW_H = 15;
const MID_H = 22;
/** Wiersz czoła kolejki nad i pod środkiem. */
const HEAD_H = 14;
/** Bilans czoła z tylu ostatnich ms. */
export const HEAD_FLOW_MS = 5 * 60_000;
/** Najwięcej wierszy na stronę (dalej i tak tylko poza zasięgiem migawki). */
const MAX_PER_SIDE = 32;
/** Migawka starsza niż tyle ms jest nieaktualna (zerwane połączenie). */
const STALE_MS = 30_000;
/** Znacznik losu ściany zostaje przy cenie tyle ms. */
const FATE_MARK_MS = 120_000;
/** Ściana dostaje podpis czasu w arkuszu od tej długości życia. */
const WALL_MARK_MS = 60_000;
/** Krzywa jasności mapy: wielkość / p99 do tej potęgi (> 1 przygasza zwykłe poziomy, ściany zostają jasne). */
const HEAT_GAMMA = 1.6;
/** Przerwa między migawkami, po której kolumna mapy zostaje pusta. */
const HEAT_GAP_MS = 20_000;
/** Drabina węższa niż tyle px (komputer) chowa kolumnę średniego zlecenia i zwęża mapę, żeby „kto / co” zostało widoczne. */
const COMPACT_W = 660;
/** Drabina węższa niż tyle px (kolumna 400 px obok wykresu) ma węższe kolumny liczb i mapę. */
const TIGHT_W = 480;
/** Ściana w arkuszu najwyżej tyle poziomów od najlepszej ceny (jak przedziały `nearPrice`) dostaje bilans ścian zakończonych przy cenie, gdy było ich co najmniej NEAR_MIN. */
const NEAR_LEVELS = 1;
const NEAR_MIN = 3;
/** Ikona końca ściany na mapie: połowa szerokości (px, trzyma ikonę w polu) i najmniejszy odstęp ikon w jednym wierszu. */
const ICON_HALF = 5;
const ICON_GAP = 10;

const LUT = buildHeatLut(LIQ_RAMP);

/** Zlecenia wielorybów na wierszu: suma, rodzaje i pseudonim największego. */
interface WhaleMark {
  usd: number;
  n: number;
  top: WhaleOrder;
  kinds: Set<WhaleOrder['kind']>;
}

/** Wiersz drabiny dla zlecenia wieloryba: pod ceną po stronie bidów, nad — asków (stopy i TP też tam, gdzie wyzwolą). */
function whaleKey(o: WhaleOrder, mid: number, step: number): string {
  const bid = o.px < mid;
  return levelKey(bid, bucketOf(o.px, step, bid));
}

/** Wielkość poziomu lub zlecenia; poniżej 0,01 jednostki zapis z zerem przed przecinkiem. */
export const fmtSize = (sz: number) => (sz > 0 && sz < 0.01 ? numLang('<0.01') : fmtVol(sz));

const fmtDur = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
/** Jak długo cena stoi na czole: sekundy, potem minuty i sekundy. */
const fmtStand = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
const pctOf = (x: number, total: number) => (total > 0 ? `${numLang(String(Math.round((x / total) * 100)))}%` : '—');

/** Czoło kolejki z kanału bbo: najlepszy poziom teraz i bilans z ostatnich minut. */
export interface LadderHead {
  bid: HeadNow | null;
  ask: HeadNow | null;
  flow: { bid: HeadFlow; ask: HeadFlow };
  /** Początek rozliczonego czasu i pierwsza aktualizacja w tej sesji (ms). */
  from: number;
  first: number;
}

export interface LadderProps {
  store: ProStore;
  hist: BookHistory | null;
  steps: { id: string; step: number }[];
  stepId: string;
  onStep: (id: string) => void;
  whales: readonly WhaleOrder[] | null;
  fates: readonly WallFate[];
  open: readonly OpenWall[];
  /** Średnie zlecenie poziomu od tej wartości (USD) jest wyróżnione jako duże. */
  lotUsd: number;
  /** Najlepszy bid i ask z dokładnego arkusza (krok ceny) — środek i spread niezależne od agregacji drabiny. */
  top: { bid: number; ask: number } | null;
  /** Czoło kolejki (null bez kanału bbo). */
  head: LadderHead | null;
  narrow: boolean;
  className: string;
  /** Przyciski po prawej w nagłówku (powiększenie). */
  tools?: React.ReactNode;
}

export const Ladder: React.FC<LadderProps> = ({ store, hist, steps, stepId, onStep, whales, fates, open, lotUsd, top, head, narrow, className, tools }) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [{ h, w }, setBox] = useState({ h: 0, w: 0 });
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.h === el.clientHeight && b.w === el.clientWidth ? b : { h: el.clientHeight, w: el.clientWidth }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const compactW = !narrow && w > 0 && w < COMPACT_W;
  const tightW = compactW && w < TIGHT_W;
  const heatMs = HEAT_MS;
  const heads = !narrow && head !== null && (head.bid !== null || head.ask !== null);

  const f: BookFrame | null = hist?.latest() ?? null;
  const now = store.serverNow();
  const stale = f !== null && now - f.t > STALE_MS;
  const perSide = Math.max(4, Math.min(MAX_PER_SIDE, Math.floor((h - MID_H - (heads ? 2 * HEAD_H : 0)) / ROW_H / 2)));
  const ready = f !== null && f.nBids > 0 && f.nBids < f.px.length;
  const { asks, bids } = ready ? ladderRows(f, perSide) : { asks: [] as LadderRow[], bids: [] as LadderRow[] };
  const step = f?.step ?? Number.NaN;
  // Środek i spread z dokładnego arkusza: kubełki agregacji przesuwają środek o pół kroku i zawyżają spread do kroku
  const bestBid = top?.bid ?? (ready ? f.px[0] : Number.NaN);
  const bestAsk = top?.ask ?? (ready ? f.px[f.nBids] : Number.NaN);
  const mid = (bestBid + bestAsk) / 2;

  // Transakcje z ostatnich 15 min na poziomach (strona zdejmowana przez agresora)
  const traded = ready ? tradedAt((a, b, fn) => store.tape.forEach(a, b, fn), now - HEAT_MS, now + 1, step) : new Map<string, number>();
  let maxSz = 0;
  let maxTr = 0;
  for (const r of [...asks, ...bids]) {
    if (r.sz > maxSz) maxSz = r.sz;
    maxTr = Math.max(maxTr, traded.get(levelKey(r.bid, r.px)) ?? 0);
  }
  const bs = ready ? bidShare(f) : Number.NaN;

  // Znaczniki: wieloryby (na wierszu albo poza drabiną), ściany w arkuszu, losy ścian
  const rowKeys = new Set([...asks, ...bids].map((r) => levelKey(r.bid, r.px)));
  const whaleRows = new Map<string, WhaleMark>();
  const outside = { below: { usd: 0, n: 0, near: Number.NaN }, above: { usd: 0, n: 0, near: Number.NaN } };
  if (ready && whales) {
    for (const o of whales) {
      const k = whaleKey(o, mid, step);
      if (rowKeys.has(k)) {
        const w = whaleRows.get(k);
        if (w) {
          w.usd += o.usd;
          w.n++;
          w.kinds.add(o.kind);
          if (o.usd > w.top.usd) w.top = o;
        } else whaleRows.set(k, { usd: o.usd, n: 1, top: o, kinds: new Set([o.kind]) });
      } else {
        const s = o.px < mid ? outside.below : outside.above;
        s.usd += o.usd;
        s.n++;
        if (!(Math.abs(o.px - mid) >= Math.abs(s.near - mid))) s.near = o.px;
      }
    }
  }
  const fateAt = new Map<string, WallFate>();
  for (const x of fates) if (now - x.t <= FATE_MARK_MS) fateAt.set(levelKey(x.bid, x.px), x);
  const wallAt = new Map<string, OpenWall>();
  for (const w of open) wallAt.set(levelKey(w.bid, w.px), w);
  // Bilans ścian, które w ostatniej godzinie zniknęły przy cenie — podpis dla ściany stojącej teraz przy cenie
  const bins = distanceBins(fates);
  const near = nearPrice(bins);
  const nearMoved = bins.filter((b) => b.from <= NEAR_LEVELS).reduce((a, b) => a + b.moved, 0);
  const nearPulled = bins.filter((b) => b.from <= NEAR_LEVELS).reduce((a, b) => a + b.pulled, 0);
  const outsideText = [
    tr('Wieloryby poza drabiną:', 'Whales beyond the ladder:'),
    outside.below.n > 0 ? tr(`pod ceną ${compact(outside.below.usd)} USD (najbliżej ${fmtPx(outside.below.near)})`, `below ${compact(outside.below.usd)} USD (nearest ${fmtPx(outside.below.near)})`) : '',
    outside.above.n > 0 ? tr(`nad ceną ${compact(outside.above.usd)} USD (najbliżej ${fmtPx(outside.above.near)})`, `above ${compact(outside.above.usd)} USD (nearest ${fmtPx(outside.above.near)})`) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const legend = tr('(los ściany: na mapie w chwili jej końca, w wierszu ceny przez 2 min)', '(wall fate: on the map at the moment it ended, in the price row for 2 min)');
  const note =
    tr(
      `Migawka arkusza co ok. 5 s, 20 poziomów na stronę (dalej „·” = poza zasięgiem). Żółte: średnie zlecenie od ${compact(lotUsd)} USD, czyli jedna duża ręka, nie tłum. Mapa: ostatnie ${heatMs / 60_000} min przy tej cenie, szare = brak migawki (poza zasięgiem arkusza albo luka w zapisie).`,
      `Book snapshot every ~5 s, 20 levels per side (beyond: “·” = out of range). Yellow: average order from ${compact(lotUsd)} USD, one large hand rather than a crowd. Map: the last ${heatMs / 60_000} min at this price, grey = no snapshot (out of the book's range or a gap in the recording).`
    ) +
    (stepId === 'exact'
      ? tr(
          ' Przy kroku 1 USD arkusz sięga tylko kilkudziesięciu dolarów od ceny, więc mapa ma dane głównie przy ostatnich cenach.',
          ' At the 1 USD step the book reaches only a few dozen dollars from the price, so the map has data mostly near recent prices.'
        )
      : '');

  // Mini mapa ciepła: osobne płótno dla asków i bidów, kolumna = kilka sekund
  const heatW = narrow ? 44 : tightW ? 56 : compactW ? 96 : 132;
  const cols = narrow ? 44 : tightW ? 40 : compactW ? 64 : 90;
  const askCanvas = useRef<HTMLCanvasElement>(null);
  const bidCanvas = useRef<HTMLCanvasElement>(null);
  const frames = ready && hist ? hist.range(now - heatMs, now + 1) : [];
  const shownAsks = [...asks].reverse();
  useEffect(() => {
    if (!ready) return;
    const a = heatHistory(frames, shownAsks, now - heatMs, now, cols, HEAT_GAP_MS);
    const b = heatHistory(frames, bids, now - heatMs, now, cols, HEAT_GAP_MS);
    // Normalizacja do p99 wielkości z obu stron okna, potęga HEAT_GAMMA: poziomy agregacji są podobnego rzędu, więc
    // skala logarytmiczna (jak na wykresie) zlewa je w jeden gorący kolor, a tu gorące zostają tylko ściany
    const xs: number[] = [];
    for (const m of [a, b]) for (let i = 0; i < m.length; i++) if (m[i] > 0) xs.push(m[i]);
    xs.sort((x, y) => x - y);
    const norm = xs.length > 0 ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.99))] : 0;
    const paint = (cv: HTMLCanvasElement | null, m: Float32Array, n: number) => {
      if (!cv || n === 0) return;
      if (cv.width !== cols) cv.width = cols;
      if (cv.height !== n) cv.height = n;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(cols, n);
      const px = new Uint32Array(img.data.buffer);
      for (let i = 0; i < m.length; i++) {
        const v = m[i];
        if (Number.isNaN(v)) px[i] = 0x0fffffff; // poza zasięgiem migawki — słaby ślad (niewiadoma, nie pustka)
        else if (v > 0 && norm > 0) px[i] = LUT[Math.min(255, Math.round((v / norm) ** HEAT_GAMMA * 255))];
      }
      ctx.putImageData(img, 0, 0);
    };
    paint(askCanvas.current, a, shownAsks.length);
    paint(bidCanvas.current, b, bids.length);
  });

  const grid = narrow
    ? 'grid-cols-[4.6rem_1fr_2.1rem_1.6rem]'
    : tightW
      ? 'grid-cols-[4.4rem_minmax(3.2rem,1fr)_2rem_3.8rem_3.6rem]'
      : compactW
        ? 'grid-cols-[5.4rem_minmax(4.5rem,1fr)_2.6rem_4.6rem_6rem]'
        : 'grid-cols-[5.4rem_minmax(5rem,1fr)_2.6rem_3.8rem_4.6rem_7.5rem]';
  const showAvg = !narrow && !compactW;
  const row = (r: LadderRow) => {
    const k = levelKey(r.bid, r.px);
    const head = r.bid ? bids[0] : asks[0];
    const lvl = head ? Math.round(Math.abs(r.px - head.px) / step) : Number.POSITIVE_INFINITY;
    const far = Number.isNaN(r.sz);
    const usd = r.sz * r.px;
    const avg = r.n >= 1 ? usd / r.n : Number.NaN;
    const big = avg >= lotUsd;
    const trUsd = traded.get(k) ?? 0;
    const whale = whaleRows.get(k);
    const fate = fateAt.get(k);
    const wall = wallAt.get(k);
    const ink = r.bid ? 'text-of-buy-ink' : 'text-of-sell-ink';
    const mark = (() => {
      const parts: React.ReactNode[] = [];
      // Przy wielorybie komórka „kto / co” jest za wąska na dwa pełne podpisy: los ściany i bilans skrócone, wiek ściany ukryty
      const tight = narrow || compactW || !!whale;
      if (whale) {
        const stop = whale.kinds.has('stop') || whale.kinds.has('tp');
        parts.push(
          <span
            key="w"
            title={tr(
              `Zlecenia wielorybów na tej cenie: ${whale.n}, razem ${compact(whale.usd)} USD (największe: ${whale.top.id}, ${whale.top.kind === 'limit' ? 'limit' : whale.top.kind === 'stop' ? 'stop' : 'TP'}${whale.top.reduce ? ', tylko zmniejsza pozycję' : ''}). Pseudonim ważny jedną dobę.`,
              `Whale orders at this price: ${whale.n}, total ${compact(whale.usd)} USD (largest: ${whale.top.id}, ${whale.top.kind === 'limit' ? 'limit' : whale.top.kind === 'stop' ? 'stop' : 'TP'}${whale.top.reduce ? ', reduce only' : ''}). The pseudonym is valid for one day.`
            )}
            className={`inline-flex min-w-0 gap-1 px-1 rounded-sm text-[10px] font-semibold ${stop ? 'bg-warn/20 text-warn' : 'bg-surface-3 text-ink-1'}`}
          >
            {narrow ? (
              'W'
            ) : (
              <>
                {/* Przy braku miejsca skraca się pseudonim, kwota zostaje */}
                <span className="truncate">{`${stop && !compactW ? (whale.kinds.has('stop') ? 'stop ' : 'TP ') : ''}${whale.top.id}`}</span>
                <span className="shrink-0">{compact(whale.usd)}</span>
              </>
            )}
          </span>
        );
      }
      if (fate) {
        const v = VERDICT[fate.verdict];
        parts.push(
          <span key="f" title={fateTitle(fate)} className={`shrink-0 text-[10px] font-semibold ${v.cls}`}>
            {tight ? v.icon : `${v.icon} ${v.short()}`}
          </span>
        );
      } else if (wall && !narrow && lvl <= NEAR_LEVELS && near.n >= NEAR_MIN) {
        parts.push(
          <span
            key="n"
            title={tr(
              `Ściana ${compact(wall.usd)} USD stoi przy cenie (w arkuszu od ${fmtHms(wall.since)}). W ostatniej godzinie z ${near.n} ścian, które zniknęły przy cenie (najwyżej ${NEAR_LEVELS} poziom od najlepszej), zjedzono ${near.eaten}, przesunięto ${nearMoved}, zdjęto ${nearPulled}. To opis tego, co działo się z innymi ścianami, nie prognoza tej.`,
              `A wall of ${compact(wall.usd)} USD stands at the price (in the book since ${fmtHms(wall.since)}). In the last hour, of ${near.n} walls that vanished at the price (at most ${NEAR_LEVELS} level from the best), ${near.eaten} were eaten, ${nearMoved} moved and ${nearPulled} pulled. A description of what happened to other walls, not a forecast for this one.`
            )}
            className="shrink-0 text-[10px] text-ink-2"
          >
            {tight ? '' : tr('zjedz. ', 'eaten ')}
            <span className={near.eaten > 0 ? 'text-warn' : 'text-ink-1'}>{near.eaten}</span>/{near.n}
          </span>
        );
      } else if (wall && now - wall.since >= WALL_MARK_MS && !narrow && !whale) {
        parts.push(
          <span key="s" title={tr(`Ściana w arkuszu od ${fmtHms(wall.since)}`, `Wall in the book since ${fmtHms(wall.since)}`)} className="text-[10px] text-ink-3">
            {tr('ściana', 'wall')} {fmtDur(now - wall.since)}
          </span>
        );
      }
      return parts;
    })();
    return (
      <div key={k} data-ladder-row className={`relative grid ${grid} gap-x-2 pr-2 items-center h-[15px] font-mono text-[11px] leading-[15px] ${far ? 'opacity-40' : ''}`}>
        <span className={`relative ${ink}`}>{fmtPx(r.px)}</span>
        <span className="relative text-right" title={compactW && avg > 0 ? tr(`Średnie zlecenie ${compact(avg)} USD`, `Average order ${compact(avg)} USD`) : undefined}>
          {r.sz > 0 && (
            <span aria-hidden="true" className={`absolute inset-y-px right-0 ${r.bid ? 'bg-of-buy/20' : 'bg-of-sell/25'}`} style={{ width: `${maxSz > 0 ? (r.sz / maxSz) * 100 : 0}%` }} />
          )}
          <span className={`relative ${big ? 'text-warn font-semibold' : 'text-ink-1'}`}>{far ? '·' : r.sz > 0 ? fmtSize(r.sz) : ''}</span>
        </span>
        <span className="relative text-right text-ink-3" title={tr('Liczba zleceń na poziomie', 'Orders at the level')}>
          {r.n >= 1 ? r.n : ''}
        </span>
        {showAvg && (
          <span className={`relative text-right ${big ? 'text-warn font-semibold' : 'text-ink-3'}`} title={tr('Średnie zlecenie na poziomie (wartość / liczba zleceń)', 'Average order at the level (value / order count)')}>
            {avg > 0 ? compact(avg) : ''}
          </span>
        )}
        {!narrow && (
          <span className="relative text-right text-ink-2">
            {trUsd > 0 && <span aria-hidden="true" className={`absolute bottom-0 right-0 h-[2px] rounded-full ${r.bid ? 'bg-of-sell/70' : 'bg-of-buy/60'}`} style={{ width: `max(6px, ${maxTr > 0 ? (trUsd / maxTr) * 100 : 0}%)` }} />}
            <span className="relative">{trUsd > 0 ? compact(trUsd) : ''}</span>
          </span>
        )}
        <span className="relative flex items-center justify-end gap-1 min-w-0 overflow-hidden whitespace-nowrap">{mark}</span>
      </div>
    );
  };

  // Końce ścian z okna mapy: ikona werdyktu tam, gdzie smuga się urywa (czas × cena wiersza).
  // Ikona cała w polu mapy; w jednym wierszu bez nakładania (zostaje nowsza), żeby nie zakryć kolorów na wąskiej mapie.
  const ends = (rows: readonly LadderRow[], bid: boolean) => {
    const at = new Map(rows.map((r, i) => [r.px, i]));
    const placed = new Map<number, number[]>();
    const out: React.ReactNode[] = [];
    for (const x of [...fates].sort((a, b) => b.t - a.t)) {
      const y = x.bid === bid ? at.get(x.px) : undefined;
      if (y === undefined || x.t < now - heatMs || x.t > now) continue;
      const left = Math.min(heatW - ICON_HALF, Math.max(ICON_HALF, ((x.t - (now - heatMs)) / heatMs) * heatW));
      const taken = placed.get(y) ?? [];
      if (taken.some((p) => Math.abs(p - left) < ICON_GAP)) continue;
      taken.push(left);
      placed.set(y, taken);
      const v = VERDICT[x.verdict];
      out.push(
        <span
          key={`${x.px}|${x.t}`}
          title={`${fmtHms(x.t)} · ${fateTitle(x)}`}
          className={`absolute -translate-x-1/2 -translate-y-1/2 text-[9px] leading-none font-bold [text-shadow:0_0_2px_#000,0_0_2px_#000] ${v.cls}`}
          style={{ left, top: (y + 0.5) * ROW_H }}
        >
          {v.icon}
        </span>
      );
    }
    return out;
  };

  // Czoło kolejki (kanał bbo) przy środku: cena, wartość, zlecenia, jak długo stoi i bilans ubytku z 5 min
  const headLine = (x: HeadNow | null, f: HeadFlow, bid: boolean) => {
    const h0 = head!;
    const out = f.eaten + f.pulled;
    const fresh = !(h0.from <= now - HEAD_FLOW_MS);
    const atLeast = x !== null && x.since <= h0.first;
    const title = tr(
      `Czoło kolejki z kanału bbo Hyperliquid (najlepszy ${bid ? 'bid' : 'ask'}, aktualizacja kilka razy na sekundę): cena, wartość, liczba zleceń i jak długo ta cena jest najlepsza${atLeast ? ' (co najmniej od otwarcia strony)' : ''}. Ubytek czoła z ostatnich 5 min: zjedzone = transakcje na tej cenie, anulowane = reszta ubytku; ponad ubytek dolano ${compact(f.refill)} USD. Bilans netto między aktualizacjami, nie wykrywanie spoofingu.`,
      `Head of the queue from the Hyperliquid bbo channel (best ${bid ? 'bid' : 'ask'}, updated several times a second): price, value, order count and how long this price has been the best${atLeast ? ' (at least since the page opened)' : ''}. Head depletion in the last 5 min: eaten = trades at this price, cancelled = the rest of the depletion; ${compact(f.refill)} USD was added beyond it. Net balance between updates, not spoofing detection.`
    );
    return (
      <div className="flex items-center gap-2 px-3 shrink-0 font-mono text-[10px] text-ink-3 whitespace-nowrap overflow-hidden" style={{ height: HEAD_H }} title={title}>
        <span className={`font-semibold ${bid ? 'text-of-buy-ink' : 'text-of-sell-ink'}`}>
          {tr('czoło', 'head')}
          {x && !compactW && ` ${fmtPx(x.px)}`}
        </span>
        {x ? (
          <>
            <span className="text-ink-1">{compact(x.sz * x.px)}</span>
            <span>
              {x.n >= 1 ? x.n : '—'} {tr('zl.', 'ord.')}
            </span>
            <span>
              {compactW ? '' : `${tr('stoi', 'stands')} `}
              {atLeast ? '≥' : ''}
              {fmtStand(now - x.since)}
            </span>
          </>
        ) : (
          <span>—</span>
        )}
        <span className="ml-auto">
          {!compactW && (fresh ? (Number.isFinite(h0.from) ? tr(`od ${fmtHms(h0.from)} · `, `since ${fmtHms(h0.from)} · `) : '') : '5 min · ')}
          {compactW ? tr('zjedz. ', 'eaten ') : tr('zjedzone ', 'eaten ')}
          <span className="text-ink-1">{pctOf(f.eaten, out)}</span>
          {!compactW && (
            <>
              {' · '}
              {tr('anulowane ', 'cancelled ')}
              <span className="text-ink-1">{pctOf(f.pulled, out)}</span>
            </>
          )}
        </span>
      </div>
    );
  };

  const side = (rows: LadderRow[], ref: React.RefObject<HTMLCanvasElement | null>, top: boolean) => (
    <div className={`relative flex ${top ? 'items-end' : 'items-start'} min-h-0 flex-1 overflow-hidden`}>
      <div className="relative flex w-full">
        <canvas ref={ref} aria-hidden="true" className="shrink-0 [image-rendering:pixelated] border-r border-line" style={{ width: heatW, height: rows.length * ROW_H }} />
        <div className="absolute left-0 top-0" style={{ width: heatW, height: rows.length * ROW_H }}>
          {ends(rows, !top)}
        </div>
        <div className="flex-1 min-w-0 pl-2">{rows.map(row)}</div>
      </div>
    </div>
  );

  return (
    <section aria-label={tr('Drabina arkusza zleceń', 'Order book ladder')} className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
      <div className="relative flex items-center gap-2 px-3 h-9 border-b border-line shrink-0">
        <span className="min-w-0 truncate text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium mr-auto">{tr('Kto stoi w kolejce', 'Who is in the queue')}</span>
        {/* Objaśnienia drabiny (migawka, żółte poziomy, mapa, losy ścian, wieloryby poza drabiną) pod „?” — wiersze zostają dla poziomów */}
        <HelpButton label={tr('Jak czytać drabinę', 'How to read the ladder')}>
          <p>{note}</p>
          <p>
            {(['eaten', 'moved', 'pulled'] as const).map((k, i) => (
              <span key={k} className={VERDICT[k].cls}>
                {i > 0 && <span className="text-ink-3"> · </span>}
                {VERDICT[k].icon} {VERDICT[k].short()}
              </span>
            ))}
            <span className="text-ink-3"> {legend}</span>
          </p>
          {ready && whales && (outside.below.n > 0 || outside.above.n > 0) && <p>{outsideText}</p>}
        </HelpButton>
        {!tightW && <span className="text-[10px] text-ink-3 hidden sm:inline">{tr('poziomy co', 'levels every')}</span>}
        <div role="radiogroup" aria-label={tr('Krok poziomów', 'Level step')} className="inline-flex items-center gap-0.5 bg-page border border-line rounded-lg p-0.5">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === stepId}
              onClick={() => onStep(s.id)}
              className={`px-2 h-7 rounded-md font-mono text-[11px] ${s.id === stepId ? 'bg-surface-3 text-ink-1' : 'text-ink-3 hover:text-ink-1'}`}
            >
              {numLang(String(s.step))} USD
            </button>
          ))}
        </div>
        {tools}
      </div>
      <div className={`grid ${grid} gap-x-2 pr-2 py-1 border-b border-line font-mono text-[10px] text-ink-3 whitespace-nowrap shrink-0`} style={{ paddingLeft: heatW + 8 }}>
        <span>{tr('Cena', 'Price')}</span>
        <span className="text-right">{store.coin}</span>
        <span className="text-right" title={tr('Liczba zleceń na poziomie', 'Orders at the level')}>{tr('zl.', 'ord.')}</span>
        {showAvg && <span className="text-right">{tr('śr. zl.', 'avg ord.')}</span>}
        {!narrow && <span className="text-right" title={tr('Wartość transakcji, które w ostatnich 15 min zdjęły ten poziom', 'Value of trades that hit this level in the last 15 min')}>{tr('taśma 15m', 'tape 15m')}</span>}
        <span className="text-right">{narrow ? '' : tr('kto / co', 'who / what')}</span>
      </div>
      <div ref={bodyRef} className="relative flex-1 min-h-0 flex flex-col">
        {!ready ? (
          <p className="px-3 py-4 text-[11px] text-ink-3">{tr('Czekam na arkusz zleceń Hyperliquid…', 'Waiting for the Hyperliquid order book…')}</p>
        ) : (
          <>
            {side(shownAsks, askCanvas, true)}
            {heads && headLine(head.ask, head.flow.ask, false)}
            <div className="flex items-center justify-between gap-2 px-3 shrink-0 border-y border-line bg-surface-2 font-mono text-[11px]" style={{ height: MID_H }}>
              <span className="text-ink-3 hidden sm:inline whitespace-nowrap" style={{ width: heatW - 12 }}>
                {tightW ? '' : '← '}
                {`${heatMs / 60_000} min`}
                {!compactW && ` · ${tr('teraz', 'now')}`}
              </span>
              <span className="text-ink-1">{fmtPx(mid)}</span>
              <span className="text-ink-3" title={tr('Najlepszy bid i ask z dokładnego arkusza, bez agregacji', 'Best bid and ask from the exact book, without aggregation')}>
                spread {numLang(String(Number((bestAsk - bestBid).toPrecision(6))))}
              </span>
              <span title={tr('Udział bidów i asków w widocznej głębokości arkusza', 'Share of bids and asks in the visible book depth')}>
                <span className="text-of-buy-ink">{Number.isFinite(bs) ? Math.round(bs * 100) : '—'}%</span>
                <span className="text-ink-3"> / </span>
                <span className="text-of-sell-ink">{Number.isFinite(bs) ? 100 - Math.round(bs * 100) : '—'}%</span>
              </span>
            </div>
            {heads && headLine(head.bid, head.flow.bid, true)}
            {side(bids, bidCanvas, false)}
          </>
        )}
      </div>
      {/* Jedna linia stanu: wiek migawki i zasięg (objaśnienia pod „?” w nagłówku) */}
      <p className={`px-3 h-5 flex items-center gap-1.5 border-t border-line font-mono text-[10px] text-ink-3 shrink-0 whitespace-nowrap overflow-hidden ${stale ? 'text-warn' : ''}`}>
        {!ready || !f ? (
          '—'
        ) : stale ? (
          tr(`Arkusz nieaktualny — ostatnia migawka ${fmtHms(f.t)}`, `Book out of date — last snapshot ${fmtHms(f.t)}`)
        ) : (
          <>
            <span>
              {tr('migawka', 'snapshot')} {fmtHms(f.t)}
            </span>
            <span>· {tr('20 poz. na stronę', '20 levels per side')}</span>
            {whales && outside.below.n + outside.above.n > 0 && (
              <span className="truncate" title={outsideText}>
                · {tr('wieloryby poza drabiną', 'whales beyond the ladder')}: {outside.below.n + outside.above.n}
              </span>
            )}
          </>
        )}
      </p>
    </section>
  );
};
