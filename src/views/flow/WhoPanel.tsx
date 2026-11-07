import React, { useMemo } from 'react';
import { compact } from '../../charts/pro/chart/FlowPanels';
import { takerAlias } from '../../charts/pro/core/clashes';
import type { MakerTop } from '../../charts/pro/core/makers';
import type { ProStore } from '../../charts/pro/store/proStore';
import { numLang } from '../../ui/format';
import { tr } from '../../i18n';
import { BTC_ONLY, BTC_ONLY_TITLE } from './flowColumnModel';

/**
 * Kto przyjmuje uderzenia: Hyperliquid podaje przy każdej transakcji konto makera i biorcy, więc widać, czy płynność
 * po każdej stronie daje garstka kont, czy tłum, i czy uderza kilka rąk. Udział trzech największych kont w wartości
 * z 15 min (pseudonimy jak na taśmie) obok zwykłego udziału z ostatniej godziny. Opis, nie sygnał.
 */

export const WHO_MS = 15 * 60_000;
/** Udział liczymy dla trzech największych; w powiększeniu lista dwudziestu, na telefonie pięciu. */
const TOP = 3;
const LIST = 20;
const LIST_PHONE = 5;
/** Zwykły udział: mediana z okien 15 min kończących się co 5 min w ostatniej godzinie (z pełnym nagraniem kont). */
const BASE_STEP_MS = 5 * 60_000;
const BASE_WINDOWS = 10;
const BASE_COVER = 0.9;

export interface WhoRow {
  n: number;
  usd: number;
  top: { key: string; usd: number }[];
  /** Udział trzech największych teraz i zwykły z godziny (NaN bez danych). */
  share: number;
  usual: number;
  /** Udział trzech największych w oknach 15 min co 5 min w ostatniej godzinie, od najstarszego (NaN bez pełnego nagrania). */
  series: number[];
}

export interface WhoData {
  bid: WhoRow;
  ask: WhoRow;
  takers: WhoRow;
}

const share = (t: MakerTop) => (t.usd > 0 ? t.top.slice(0, TOP).reduce((a, x) => a + x.usd, 0) / t.usd : Number.NaN);

/** Biorcy w [from, to): konta zleceń agresora (bez konta — pominięte). */
function takerTop(store: ProStore, from: number, to: number): MakerTop {
  const m = new Map<string, number>();
  for (const o of store.orders.range(from, to)) if (o.taker) m.set(o.taker, (m.get(o.taker) ?? 0) + o.notional);
  let usd = 0;
  for (const v of m.values()) usd += v;
  const top = [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIST)
    .map(([key, v]) => ({ key, usd: v }));
  return { n: m.size, usd, top };
}

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.floor(s.length / 2)];
};

/** Koncentracja z 15 min i zwykła z godziny (przeliczana co 5 s). */
export function useWho(store: ProStore): WhoData {
  const key = Math.floor(store.serverNow() / 5_000);
  return useMemo(() => {
    const now = store.serverNow();
    const cut = (a: number, b: number) => ({ m: store.makerTop(a, b, LIST), t: takerTop(store, a, b) });
    const cur = cut(now - WHO_MS, now + 1);
    const base = { bid: [] as number[], ask: [] as number[], takers: [] as number[] };
    for (let k = BASE_WINDOWS - 1; k >= 0; k--) {
      const b = now - k * BASE_STEP_MS;
      const a = b - WHO_MS;
      const w = store.addressed.coveredMs(a, b) >= BASE_COVER * WHO_MS ? cut(a, b) : null;
      base.bid.push(w ? share(w.m.bid) : Number.NaN);
      base.ask.push(w ? share(w.m.ask) : Number.NaN);
      base.takers.push(w ? share(w.t) : Number.NaN);
    }
    const row = (t: MakerTop, b: number[]): WhoRow => ({ ...t, share: share(t), usual: median(b), series: b });
    return { bid: row(cur.m.bid, base.bid), ask: row(cur.m.ask, base.ask), takers: row(cur.t, base.takers) };
  }, [store, key]);
}

const pct = (x: number) => (Number.isFinite(x) ? `${numLang(String(Math.round(x * 100)))}%` : '—');
/** Polska forma liczebnika: 1 konto, 2–4 konta, 5 kont (12–14 jak 5). */
const kont = (n: number) => (n === 1 ? 'konto' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'konta' : 'kont');

const TONE = {
  bid: ['bg-of-buy', 'bg-of-buy/65', 'bg-of-buy/40'],
  ask: ['bg-of-sell', 'bg-of-sell/65', 'bg-of-sell/40'],
  takers: ['bg-accent', 'bg-accent/65', 'bg-accent/40'],
} as const;

/** Udział trzech największych w oknach z ostatniej godziny: linia, przerywana linia „zwykle”, kropka teraz. */
const Spark: React.FC<{ xs: number[]; usual: number; cls: string }> = ({ xs, usual, cls }) => {
  const H = 40;
  const x = (i: number) => (xs.length > 1 ? (i / (xs.length - 1)) * 100 : 50);
  const y = (v: number) => H - v * H;
  // Linia przerwana tam, gdzie okno nie miało pełnego nagrania
  const parts: string[] = [];
  let cur: string[] = [];
  xs.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push(`${x(i)},${y(v)}`);
    else if (cur.length) {
      parts.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) parts.push(cur.join(' '));
  const last = xs[xs.length - 1];
  return (
    <div className={cls}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full h-14 rounded-md bg-page" aria-hidden="true">
        {Number.isFinite(usual) && <line x1={0} x2={100} y1={y(usual)} y2={y(usual)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {parts.map((p) => (
          <polyline key={p} points={p} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {Number.isFinite(last) && <circle cx={x(xs.length - 1)} cy={y(last)} r={1.6} fill="currentColor" />}
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-ink-3 mt-0.5">
        <span>−45 min</span>
        <span>{tr('udział 3 największych, okna 15 min · 0–100%', 'top 3 share, 15 min windows · 0–100%')}</span>
        <span>{tr('teraz', 'now')}</span>
      </div>
      {!Number.isFinite(last) && (
        <p className="font-mono text-[9px] text-ink-3 mt-0.5">
          {tr('Okna z luką w nagraniu kont (np. tuż po otwarciu strony) są pominięte; linia dojdzie do „teraz” do 15 min po luce.', 'Windows with a gap in the account recording (e.g. right after opening the page) are skipped; the line reaches “now” within 15 min after the gap.')}
        </p>
      )}
    </div>
  );
};

export const WhoPanel: React.FC<{
  /** null — rynek bez danych skanera kont (inny niż BTC): komunikat zamiast liczb. */
  data: WhoData | null;
  highlight: string;
  onHighlight: (key: string) => void;
  /** Nagłówek zamiast tytułu (przełącznik zakładek na komputerze) i przyciski po prawej (powiększenie). */
  head?: React.ReactNode;
  tools?: React.ReactNode;
  /** Powiększony panel: trzy kolumny, dwadzieścia największych kont z resztą i przebieg z ostatniej godziny. */
  wide: boolean;
  narrow: boolean;
  className: string;
}> = ({ data, highlight, onHighlight, head, tools, wide, narrow, className }) => {
  const header = (
    <div className="flex items-center gap-2 px-3 h-10 border-b border-line shrink-0">
      {head ?? <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium truncate">{tr('Kto przyjmuje uderzenia', 'Who absorbs the hits')}</span>}
      <span className="ml-auto font-mono text-[10px] text-ink-3">15 min</span>
      {tools}
    </div>
  );
  if (!data)
    return (
      <section aria-label={tr('Kto przyjmuje uderzenia', 'Who absorbs the hits')} className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
        {header}
        <p className="px-3 py-4 font-mono text-[11px] text-ink-3" title={BTC_ONLY_TITLE}>
          {BTC_ONLY}
        </p>
      </section>
    );
  // Powiększenie i telefon: lista kont i przebieg z godziny (telefon: jedna kolumna, pięć kont)
  const list = wide || narrow;
  const line = (id: keyof WhoData, label: string, hint: string) => {
    const r = data[id];
    const ink = id === 'bid' ? 'text-of-buy-ink' : id === 'ask' ? 'text-of-sell-ink' : 'text-accent';
    const hot = Number.isFinite(r.share) && Number.isFinite(r.usual) && r.share >= r.usual * 1.25;
    const who = (x: { key: string; usd: number }, i: number) => (
      <button
        key={x.key}
        type="button"
        onClick={() => onHighlight(highlight === x.key ? '' : x.key)}
        aria-pressed={highlight === x.key}
        title={tr('Podświetl zlecenia agresora tego konta na taśmie (jeśli też uderza)', 'Highlight this account’s aggressor orders on the tape (if it also takes)')}
        className={
          list
            ? `grid grid-cols-[1.4rem_6.5rem_minmax(0,1fr)_3rem] items-center gap-2 w-full h-6 px-1 rounded-sm text-left ${highlight === x.key ? 'bg-surface-3 text-ink-1' : 'text-ink-2 hover:bg-surface-2 hover:text-ink-1'}`
            : `shrink-0 rounded-sm px-0.5 ${highlight === x.key ? 'bg-surface-3 text-ink-1' : 'text-ink-2 hover:text-ink-1'}`
        }
      >
        {list ? (
          <>
            <span className="text-ink-3 text-right">{i + 1}</span>
            <span className="truncate">{takerAlias(x.key)}</span>
            <span className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <span className={`absolute inset-y-0 left-0 ${TONE[id][Math.min(i, TOP - 1)]}`} style={{ width: `${r.usd > 0 ? (x.usd / r.usd) * 100 : 0}%` }} />
            </span>
            <span className="text-right">{pct(r.usd > 0 ? x.usd / r.usd : Number.NaN)}</span>
          </>
        ) : (
          `${takerAlias(x.key)} ${pct(r.usd > 0 ? x.usd / r.usd : Number.NaN)}`
        )}
      </button>
    );
    const summary = (
      <span className="shrink-0 whitespace-nowrap text-ink-3">
        {tr('3 największe', 'top 3')} <span className={hot ? 'text-warn font-semibold' : 'text-ink-1'}>{pct(r.share)}</span>
        {Number.isFinite(r.usual) && tr(` · zwykle ${pct(r.usual)}`, ` · usually ${pct(r.usual)}`)}
      </span>
    );
    // Lista kont i reszta strony poza nią (razem 100% wartości)
    const shown = wide ? r.top : r.top.slice(0, LIST_PHONE);
    const restN = r.n - shown.length;
    const restUsd = r.usd - shown.reduce((a, x) => a + x.usd, 0);
    return (
      <div className={list ? 'flex flex-col gap-2 px-4 py-3 min-h-0' : 'px-3 py-1.5'} title={hint}>
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className={`font-semibold ${ink}`}>{label}</span>
          <span className="ml-auto font-mono text-[10px] text-ink-3 whitespace-nowrap">
            {tr(`${r.n} ${kont(r.n)} · ${compact(r.usd)} USD`, `${r.n} ${r.n === 1 ? 'account' : 'accounts'} · ${compact(r.usd)} USD`)}
          </span>
        </div>
        {/* Pasek udziałów; w zwykłym panelu obok niego udział 3 największych, a pod nim pseudonimy na całą szerokość */}
        <div className={list ? '' : 'flex items-center gap-2 mt-1'}>
          <div className={`relative flex ${list ? 'h-3' : 'h-2 flex-1'} rounded-full bg-surface-3 overflow-hidden`} aria-hidden="true">
            {r.top.slice(0, TOP).map((x, i) => (
              <span key={x.key} className={`${TONE[id][i]} border-r border-surface-1`} style={{ width: `${r.usd > 0 ? (x.usd / r.usd) * 100 : 0}%` }} />
            ))}
          </div>
          {!list && <span className="font-mono text-[10px]">{summary}</span>}
        </div>
        {list ? (
          <>
            <div className="font-mono text-[10px] text-right">{summary}</div>
            <Spark xs={r.series} usual={r.usual} cls={ink} />
            <div className="font-mono text-[11px] space-y-0.5">
              {shown.map(who)}
              {restN > 0 && r.usd > 0 && (
                <div className="grid grid-cols-[1.4rem_6.5rem_minmax(0,1fr)_3rem] items-center gap-2 h-6 px-1 text-ink-3">
                  <span />
                  <span className="truncate">{tr(`+${restN} ${kont(restN)}`, `+${restN} more`)}</span>
                  <span className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 bg-ink-3/40" style={{ width: `${(restUsd / r.usd) * 100}%` }} />
                  </span>
                  <span className="text-right">{pct(restUsd / r.usd)}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-x-3 mt-1 font-mono text-[10px] min-w-0 overflow-hidden whitespace-nowrap">{r.top.slice(0, TOP).map(who)}</div>
        )}
      </div>
    );
  };
  const note = tr(
    'Hyperliquid podaje konto makera i biorcy przy każdej transakcji, więc widać, czy płynność daje garstka kont, czy tłum. Ostatnie 15 min; „zwykle” = mediana z okien 15 min w ostatniej godzinie, żółte od 1,25× zwykłego. Pseudonimy jak na taśmie; w zapisie serwera konto ma numer na dobę UTC w nowszych plikach (numeracja dobowa), a w starszych plikach — na godzinę UTC, więc na przełomie doby (w starszych plikach — godziny) jedno konto może liczyć się jako dwa. Opis, nie sygnał.',
    'Hyperliquid gives the maker and taker account of every trade, so you can see whether liquidity comes from a handful of accounts or a crowd. Last 15 min; “usually” = median of 15 min windows in the last hour, yellow from 1.25× usual. Pseudonyms as on the tape; in the server recording an account has a number per UTC day in newer files (daily numbering) and per UTC hour in older files, so at the turn of the day (in older files, of the hour) one account can count as two. A description, not a signal.'
  );
  return (
    <section aria-label={tr('Kto przyjmuje uderzenia', 'Who absorbs the hits')} className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
      {header}
      <div className={`flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] ${wide ? 'grid grid-cols-3 content-start divide-x divide-line' : 'divide-y divide-line'}`}>
        {line('bid', tr('Przyjmują sprzedaż (bidy)', 'Absorb selling (bids)'), tr('Makerzy kupujący: zlecenia w arkuszu po stronie bidów, w które weszli sprzedający', 'Buying makers: resting bid orders that sellers hit'))}
        {line('ask', tr('Przyjmują kupno (aski)', 'Absorb buying (asks)'), tr('Makerzy sprzedający: zlecenia w arkuszu po stronie asków, w które weszli kupujący', 'Selling makers: resting ask orders that buyers lifted'))}
        {line('takers', tr('Uderzają (agresorzy)', 'Hit (aggressors)'), tr('Biorcy: konta, które uderzały w arkusz zleceniami agresora (kupno i sprzedaż razem)', 'Takers: accounts that hit the book with aggressor orders (buy and sell together)'))}
      </div>
      <div className="px-3 py-1.5 border-t border-line shrink-0">
        <p className={`text-[10px] leading-snug text-ink-3 ${narrow ? '' : 'line-clamp-2'}`} title={narrow ? undefined : note}>
          {note}
        </p>
      </div>
    </section>
  );
};
