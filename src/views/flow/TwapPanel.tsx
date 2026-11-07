import React, { useEffect, useMemo } from 'react';
import { fmtVol } from '../../charts/orderflow/footprint';
import { compact } from '../../charts/pro/chart/FlowPanels';
import { takerAlias } from '../../charts/pro/core/clashes';
import { fmtHms, fmtSince } from '../../charts/pro/core/time';
import { END_GRACE_MS, matchPlan, planAhead, planDone, planEnd, twapStreams, type TwapPlan, type TwapStream } from '../../charts/pro/core/twapPlans';
import type { ProStore } from '../../charts/pro/store/proStore';
import { twapPlansFor, type PlanEntry } from '../../charts/pro/store/twapCache';
import { numLang } from '../../ui/format';
import { tr } from '../../i18n';
import { BTC_ONLY, BTC_ONLY_TITLE } from './flowColumnModel';

/**
 * TWAP-y w drodze: ciągi plasterków z taśmy na żywo połączone z planem konta z publicznego dziennika Hyperliquid.
 * Plan daje wielkość i koniec, więc wiadomo, ile jeszcze wejdzie w rynek i w którą stronę — o ile konto go nie przerwie.
 */

/** Okno plasterków do wyliczenia ciągów i ciąg uznany za trwający (ostatni plasterek najwyżej tyle ms temu). */
const WINDOW_MS = 10 * 60_000;
const ACTIVE_MS = 75_000;
const HORIZON_MS = 15 * 60_000;
/** Ile największych ciągów pobiera plan samo (telefon mniej); reszta po kliknięciu. */
const AUTO_DESKTOP = 6;
const AUTO_PHONE = 3;
/** Ciąg bez pasującego planu: ponowne zapytanie najwcześniej po tylu ms (np. TWAP ruszył po poprzednim zapytaniu). */
const REFETCH_MS = 3 * 60_000;
/** Ciągi wolniejsze niż tyle USD/min zwijamy do jednego wiersza (pył, np. plasterki po kilkanaście USD). */
const DUST_USD_MIN = 100;

interface Row {
  s: TwapStream;
  plan: TwapPlan | null;
  entry: PlanEntry | undefined;
  /** Średnia cena plasterków i wartość (USD), która według planu jeszcze zostało wykonać. */
  px: number;
  leftUsd: number;
}

const fmtLeft = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
/** Krótko do końca (wąski panel): „40 min”, „2 h 47”, od dwóch dób „3 d”. */
const fmtLeftShort = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60}` : `${Math.round(m / 1440)} d`;
};
/** Udział w procentach: poniżej 1% z jednym miejscem po przecinku. */
const fmtPct = (x: number) => `${numLang(x < 0.01 ? (x * 100).toFixed(1) : String(Math.round(x * 100)))}%`;
/** Polska forma liczebnika: 1 plan, 2–4 plany, 5 planów (12–14 jak 5). */
const plForm = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
/** Tempo ciągu z jego plasterków (USD/min przy takcie 30 s). */
const pace = (s: TwapStream) => (s.usd / s.slices) * 2;

/** Układ zależy od szerokości panelu (zapytanie kontenera): szeroki od 32rem, wąski poniżej (telefon, laptop 1024 px). */
const GRID = 'grid-cols-[10.75rem_minmax(3.5rem,1fr)_6.2rem_3.4rem_4.4rem] @max-lg:grid-cols-[5.6rem_1fr_3.6rem_3.6rem]';
const WIDE = '@max-lg:hidden';
const SMALL = 'hidden @max-lg:inline';

const SideLabel: React.FC<{ side: 1 | -1 }> = ({ side }) => (
  <span className={`font-semibold ${side === 1 ? 'text-of-buy-ink' : 'text-of-sell-ink'}`}>
    <span className={WIDE}>{side === 1 ? tr('kupno', 'buy') : tr('sprzedaż', 'sell')}</span>
    <span className={SMALL}>{side === 1 ? tr('K', 'B') : 'S'}</span>
  </span>
);

/** Ciągi TWAP z taśmy połączone z planami i bilans najbliższych 15 min (także dla paska na górze widoku). */
export interface TwapData {
  now: number;
  rows: Row[];
  shown: Row[];
  dust: Row[];
  buy: number;
  sell: number;
  net: number;
  known: number;
  /** Udział plasterków TWAP w wartości taśmy z 10 min (NaN bez taśmy). */
  share: number;
  auto: number;
  cache: ReturnType<typeof twapPlansFor>;
}

export function useTwaps(store: ProStore, narrow: boolean): TwapData {
  const cache = twapPlansFor(store.coin, () => store.serverNow());
  const now = store.serverNow();
  const sec = Math.floor(now / 1000);
  const { streams, share } = useMemo(() => {
    const t = store.serverNow();
    const orders = store.orders.range(t - WINDOW_MS, t + 1);
    // Udział plasterków TWAP w wartości całej taśmy z tego samego okna
    let all = 0;
    let zero = 0;
    for (const o of orders) {
      all += o.notional;
      if (o.zero) zero += o.notional;
    }
    return { streams: twapStreams(orders).filter((s) => t - s.last <= ACTIVE_MS), share: all > 0 ? zero / all : Number.NaN };
  }, [store, sec]);

  const rows: Row[] = streams
    .map((s) => {
      const entry = cache.get(s.taker);
      const plans = entry?.plans?.filter((p) => now <= planEnd(p) + END_GRACE_MS) ?? [];
      const plan = matchPlan(s, plans);
      const px = s.usd / s.sz;
      return { s, entry, plan, px, leftUsd: plan ? plan.sz * (1 - planDone(plan, now)) * px : 0 };
    })
    // Najpierw znane plany od największej reszty, potem ciągi bez planu od największej wartości
    .sort((a, b) => Number(!a.plan) - Number(!b.plan) || b.leftUsd - a.leftUsd || b.s.usd - a.s.usd);

  // Plan pobierany sam dla największych ciągów bez pasującego planu (jedno zapytanie naraz, poza renderem)
  const auto = narrow ? AUTO_PHONE : AUTO_DESKTOP;
  useEffect(() => {
    const top = [...streams].filter((s) => !s.taker.startsWith('~')).sort((a, b) => b.usd - a.usd).slice(0, auto);
    for (const s of top) {
      const plans = cache.get(s.taker)?.plans;
      if (!plans || !matchPlan(s, plans)) cache.want(s.taker, REFETCH_MS);
    }
  }, [streams, cache, auto]);

  let buy = 0;
  let sell = 0;
  let known = 0;
  for (const r of rows) {
    if (!r.plan) continue;
    known++;
    const v = planAhead(r.plan, now, HORIZON_MS, r.px);
    if (r.plan.side === 1) buy += v;
    else sell += v;
  }
  // Znane plany zawsze na liście; ciągi bez planu tylko od progu tempa, reszta w jednym wierszu
  const shown = rows.filter((r) => r.plan || pace(r.s) >= DUST_USD_MIN);
  const dust = rows.filter((r) => !r.plan && pace(r.s) < DUST_USD_MIN);
  return { now, rows, shown, dust, buy, sell, net: buy - sell, known, share, auto, cache };
}

export const TwapPanel: React.FC<{
  store: ProStore;
  /** null — rynek bez planów TWAP ze skanera (inny niż BTC): komunikat zamiast liczb. */
  data: TwapData | null;
  /** Nagłówek panelu (przełącznik zakładek na komputerze) i przyciski po prawej (powiększenie). */
  head: React.ReactNode;
  tools?: React.ReactNode;
  narrow: boolean;
  className: string;
}> = ({ store, data, head, tools, narrow, className }) => {
  const header = (
    <div className="flex items-center gap-2 px-3 h-10 border-b border-line shrink-0">
      {head}
      {tools && <span className="ml-auto flex items-center">{tools}</span>}
    </div>
  );
  if (!data)
    return (
      <section aria-label={tr('TWAP-y w drodze', 'TWAPs en route')} className={`@container flex flex-col min-h-0 bg-surface-1 ${className}`}>
        {header}
        <p className="px-3 py-4 font-mono text-[11px] text-ink-3" title={BTC_ONLY_TITLE}>
          {BTC_ONLY}
        </p>
      </section>
    );
  const { now, rows, shown, dust, buy, sell, net, known, share, auto, cache } = data;

  const status = (r: Row): React.ReactNode => {
    const { s, entry } = r;
    if (s.taker.startsWith('~')) return tr('z zapisu serwera, bez adresu do planu', 'from the server recording, no address for a plan');
    if (entry?.pending) return tr('pobieram plan…', 'fetching the plan…');
    if (!entry)
      return (
        <button type="button" onClick={() => cache.want(s.taker, 0)} className="underline decoration-dotted underline-offset-2 text-ink-2 hover:text-ink-1">
          {tr('pobierz plan', 'fetch the plan')}
        </button>
      );
    if (entry.plans === null) return tr('dziennik nie odpowiedział', 'the log did not respond');
    return tr('brak pasującego planu w dzienniku', 'no matching plan in the log');
  };

  const note = tr(
    `${Number.isFinite(share) ? `TWAP-y to ${fmtPct(share)} wartości taśmy z ostatnich 10 min. ` : ''}Plasterki TWAP (hash zerowy, co 30 s) z taśmy na żywo. Plan z publicznego dziennika Hyperliquid: sam dla ${auto} największych kont, reszta po kliknięciu; bez planu tempo z plasterków. Postęp z harmonogramu liniowego, a konto może przerwać TWAP w każdej chwili.`,
    `${Number.isFinite(share) ? `TWAPs are ${fmtPct(share)} of the tape value in the last 10 min. ` : ''}TWAP slices (zero hash, every 30 s) from the live tape. The plan comes from the public Hyperliquid log: automatically for the ${auto} largest accounts, the rest on click; without a plan, pace from slices. Progress follows the linear schedule, and the account can stop the TWAP at any time.`
  );
  return (
    <section aria-label={tr('TWAP-y w drodze', 'TWAPs en route')} className={`@container flex flex-col min-h-0 bg-surface-1 ${className}`}>
      {header}
      {/* Najbliższe 15 min według znanych planów: ile kupią, ile sprzedadzą, netto */}
      <div
        className="flex items-center gap-3 px-3 h-8 border-b border-line font-mono text-[11px] whitespace-nowrap shrink-0"
        title={tr(
          `Ile według znanych planów (${known}) wejdzie w rynek w najbliższych 15 min (harmonogram liniowy, cena ostatnich plasterków, USD)`,
          `How much the known plans (${known}) will put into the market in the next 15 min (linear schedule, price of recent slices, USD)`
        )}
      >
        <span className="text-ink-3">
          15 min<span className={WIDE}>{tr(` · ${known} ${plForm(known, 'plan', 'plany', 'planów')}`, ` · ${known} ${known === 1 ? 'plan' : 'plans'}`)}</span>
        </span>
        <span className="text-of-buy-ink">
          {tr('kupno', 'buy')} {compact(buy)}
        </span>
        <span className="text-of-sell-ink">
          {tr('sprzedaż', 'sell')} {compact(sell)}
        </span>
        <span className={`ml-auto font-semibold ${net >= 0 ? 'text-of-buy-ink' : 'text-of-sell-ink'}`}>
          {tr('netto', 'net')} {net > 0 ? '+' : ''}
          {compact(net)}
        </span>
      </div>
      <div className={`grid ${GRID} gap-x-2 px-3 py-1 border-b border-line font-mono text-[10px] text-ink-3 shrink-0`}>
        <span>{tr('Konto', 'Account')}</span>
        <span>{tr('wykonane', 'done')}</span>
        <span className="text-right">{tr('zostało', 'left')}</span>
        <span className={`text-right ${WIDE}`}>15 min</span>
        <span className="text-right">
          <span className={WIDE}>{tr('koniec', 'end')}</span>
          <span className={SMALL}>{tr('do końca', 'ends in')}</span>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {rows.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-ink-3">
            {tr('Żaden TWAP nie wykonał plasterka na BTC w ostatnich 75 s taśmy na żywo.', 'No TWAP executed a BTC slice in the last 75 s of the live tape.')}
          </p>
        )}
        {shown.map((r) => {
          const { s, plan } = r;
          const alias = takerAlias(s.taker);
          const key = `${s.taker}|${s.side}|${s.phase}`;
          if (!plan)
            return (
              <div
                key={key}
                title={tr(`${s.slices} ${plForm(s.slices, 'plasterek', 'plasterki', 'plasterków')} od ${fmtHms(s.first)}, razem ${compact(s.usd)} USD`, `${s.slices} ${s.slices === 1 ? 'slice' : 'slices'} since ${fmtHms(s.first)}, ${compact(s.usd)} USD in total`)}
                className={`grid ${GRID} gap-x-2 px-3 h-7 items-center font-mono text-[11px] whitespace-nowrap`}
              >
                <span className="truncate text-ink-2">
                  {alias} <SideLabel side={s.side} />
                </span>
                <span className="col-span-3 @max-lg:col-span-2 truncate text-[10px] text-ink-3">{status(r)}</span>
                <span className="text-right text-ink-2">~{compact(pace(s))}/min</span>
              </div>
            );
          const done = planDone(plan, now);
          const leftSz = plan.sz * (1 - done);
          const end = planEnd(plan);
          return (
            <div
              key={key}
              title={tr(
                `${alias}: TWAP ${plan.side === 1 ? 'kupna' : 'sprzedaży'} ${fmtVol(plan.sz)} ${store.coin} w ${plan.minutes} min, start ${fmtSince(plan.start, now)}, koniec ${fmtSince(end, now)} (za ${fmtLeft(end - now)})${plan.reduceOnly ? ', tylko zmniejsza pozycję' : ''}. Na taśmie ${s.slices} ${plForm(s.slices, 'plasterek', 'plasterki', 'plasterków')} od ${fmtHms(s.first)}.`,
                `${alias}: ${plan.side === 1 ? 'buy' : 'sell'} TWAP of ${fmtVol(plan.sz)} ${store.coin} over ${plan.minutes} min, start ${fmtSince(plan.start, now)}, end ${fmtSince(end, now)} (in ${fmtLeft(end - now)})${plan.reduceOnly ? ', reduce only' : ''}. ${s.slices} ${s.slices === 1 ? 'slice' : 'slices'} on the tape since ${fmtHms(s.first)}.`
              )}
              className={`grid ${GRID} gap-x-2 px-3 h-7 items-center font-mono text-[11px] whitespace-nowrap`}
            >
              <span className="truncate text-ink-1">
                {alias} <SideLabel side={plan.side} />
                {plan.reduceOnly && <span className={`ml-1 px-1 rounded-sm bg-surface-3 text-[10px] text-ink-2 ${WIDE}`}>{tr('zamyka', 'closes')}</span>}
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <span className={`absolute inset-y-0 left-0 ${plan.side === 1 ? 'bg-of-buy' : 'bg-of-sell'}`} style={{ width: `${done * 100}%` }} />
                </span>
                <span className="text-[10px] text-ink-3 w-8 text-right">{numLang(String(Math.round(done * 100)))}%</span>
              </span>
              <span className="text-right text-ink-1">
                <span className={WIDE}>{fmtVol(leftSz)} </span>
                <span className="text-ink-3 @max-lg:text-ink-1">
                  <span className={WIDE}>· </span>
                  {compact(r.leftUsd)}
                </span>
              </span>
              <span className={`text-right text-ink-2 ${WIDE}`}>{compact(planAhead(plan, now, HORIZON_MS, r.px))}</span>
              <span className="text-right text-ink-3">
                <span className={WIDE}>{fmtSince(end, now)}</span>
                <span className={SMALL}>{fmtLeftShort(end - now)}</span>
              </span>
            </div>
          );
        })}
        {dust.length > 0 && (
          <p className="px-3 h-7 flex items-center font-mono text-[10px] text-ink-3" title={tr(`Razem ~${compact(dust.reduce((a, r) => a + pace(r.s), 0))} USD/min`, `~${compact(dust.reduce((a, r) => a + pace(r.s), 0))} USD/min in total`)}>
            {tr(
              `i ${dust.length} ${plForm(dust.length, 'drobny TWAP', 'drobne TWAP-y', 'drobnych TWAP-ów')} poniżej ${DUST_USD_MIN} USD/min`,
              `and ${dust.length} small ${dust.length === 1 ? 'TWAP' : 'TWAPs'} below ${DUST_USD_MIN} USD/min`
            )}
          </p>
        )}
      </div>
      {/* Na komputerze dolny panel jest niski: dwie linie (udział na początku), całość w podpowiedzi */}
      {/* Odstęp na obudowie, nie na akapicie: przy line-clamp dopełnienie odsłaniałoby kawałek trzeciej linii */}
      <div className="px-3 py-1.5 border-t border-line shrink-0">
        <p className={`text-[10px] leading-snug text-ink-3 ${narrow ? '' : 'line-clamp-2'}`} title={narrow ? undefined : note}>
          {note}
        </p>
      </div>
    </section>
  );
};
