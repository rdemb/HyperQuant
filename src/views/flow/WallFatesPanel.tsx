import React from 'react';
import { fmtVol } from '../../charts/orderflow/footprint';
import { compact } from '../../charts/pro/chart/FlowPanels';
import { fmtPx } from '../../charts/pro/chart/layout';
import { fmtHms } from '../../charts/pro/core/time';
import { type WallFate, type WallVerdict, distanceBins, nearPrice } from '../../charts/pro/core/wallFates';
import { tr } from '../../i18n';
import { VERDICT, fateTitle } from './verdicts';

/**
 * Losy ścian z ostatniej godziny w wybranej agregacji: liczniki zjedzonych, przesuniętych i zdjętych oraz lista
 * najnowszych. Ściany krótsze niż MIN_LIFE_MS (migotanie kwotowań) liczą się w licznikach, ale nie na liście.
 */

const MIN_LIFE_MS = 30_000;
const LIST_MAX = 40;
const ORDER: WallVerdict[] = ['eaten', 'moved', 'pulled'];

const fmtLife = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
/** Podpis przedziału dystansu zniknięcia. */
const binLabel = (from: number) => (from === 0 ? tr('przy cenie', 'at price') : from === 1 ? tr('1 poziom', '1 level') : from === 2 ? tr('2–4 poz.', '2–4 lvl') : tr('5+ poz.', '5+ lvl'));
/** Kolory odcinków paska: zjedzone, przesunięte, zdjęte (jak ikony werdyktów). */
const SEG: Record<WallVerdict, string> = { eaten: 'bg-warn', moved: 'bg-ink-3', pulled: 'bg-ink-1/80' };

export const WallFatesPanel: React.FC<{
  fates: readonly WallFate[];
  /** Próg ściany (USD) i krok agregacji. */
  minUsd: number;
  step: number;
  /** Początek okna z danymi (ms) — od otwarcia strony albo z historii serwera. */
  since: number | null;
  narrow: boolean;
  className: string;
  /** Nagłówek zamiast tytułu (przełącznik zakładek na komputerze). */
  head?: React.ReactNode;
}> = ({ fates, minUsd, step, since, narrow, className, head }) => {
  const counts = ORDER.map((v) => {
    const xs = fates.filter((f) => f.verdict === v);
    return { v, n: xs.length, usd: xs.reduce((s, f) => s + f.peakUsd, 0) };
  });
  const untouched = fates.filter((f) => f.verdict !== 'eaten' && !f.touched).length;
  // Gdzie ściany znikały: dystans od najlepszej ceny w migawce zniknięcia
  const bins = distanceBins(fates);
  const binMax = Math.max(1, ...bins.map((b) => b.eaten + b.moved + b.pulled));
  const near = nearPrice(bins);
  const list = fates.filter((f) => f.t - f.since >= MIN_LIFE_MS).slice(-LIST_MAX).reverse();
  return (
    <section aria-label={tr('Losy ścian arkusza', 'Fates of book walls')} className={`@container flex flex-col min-h-0 bg-surface-1 ${className}`}>
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line shrink-0">
        {head ?? <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium">{tr('Ściany: zjedzone czy zdjęte', 'Walls: eaten or pulled')}</span>}
        {/* Przy zakładkach w nagłówku i wąskim panelu (laptop 1024 px) godzina początku okna się nie mieści */}
        <span className={`ml-auto font-mono text-[10px] text-ink-3 whitespace-nowrap ${head ? '@max-lg:hidden' : ''}`}>
          {since !== null ? tr(`od ${fmtHms(since)}`, `since ${fmtHms(since)}`) : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-line border-b border-line shrink-0">
        {counts.map((c) => (
          <div key={c.v} className="bg-surface-1 px-3 py-2" title={VERDICT[c.v].desc()}>
            <div className={`text-[10px] uppercase tracking-[0.06em] ${VERDICT[c.v].cls}`}>
              {VERDICT[c.v].icon} {VERDICT[c.v].short()}
            </div>
            <div className="font-mono text-[15px] text-ink-1">{c.n}</div>
            <div className="font-mono text-[10px] text-ink-3">{compact(c.usd)} USD</div>
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-4 @max-lg:grid-cols-2 gap-x-3 gap-y-1 px-3 py-1.5 border-b border-line shrink-0"
        title={tr(
          'Gdzie ściany znikały: ile poziomów od najlepszej ceny swojej strony stała ściana w migawce, w której zniknęła (żółte = zjedzone, szare = przesunięte, jasne = zdjęte). Ściana „przy cenie” stała na czele kolejki albo cena już przez nią przeszła.',
          'Where walls vanished: how many levels from the best price of their side the wall stood in the snapshot where it vanished (yellow = eaten, grey = moved, light = pulled). A wall “at price” was at the front of the queue or the price had already passed through it.'
        )}
      >
        {bins.map((b) => {
          const n = b.eaten + b.moved + b.pulled;
          return (
            <div key={b.from} className="min-w-0">
              <div className="flex items-baseline justify-between gap-1 font-mono text-[10px] whitespace-nowrap">
                <span className="text-ink-3 truncate">{binLabel(b.from)}</span>
                <span className="text-ink-1">
                  {n} <span className={b.eaten > 0 ? 'text-warn' : 'text-ink-3'}>●{b.eaten}</span>
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-surface-3 overflow-hidden flex" style={{ width: `${Math.max(n > 0 ? 8 : 0, (n / binMax) * 100)}%` }}>
                {(['eaten', 'moved', 'pulled'] as const).map((v) => (b[v] > 0 ? <span key={v} className={SEG[v]} style={{ width: `${(b[v] / n) * 100}%` }} /> : null))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {list.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-ink-3">{tr('Jeszcze żadna ściana nie zniknęła w tej agregacji.', 'No wall has disappeared in this aggregation yet.')}</p>
        )}
        {list.map((f) => {
          const v = VERDICT[f.verdict];
          return (
            <div
              key={`${f.bid ? 'b' : 'a'}${f.px}|${f.since}`}
              title={fateTitle(f)}
              className={`grid ${narrow ? 'grid-cols-[4rem_4.4rem_1fr_6rem]' : 'grid-cols-[4.2rem_4.8rem_1fr_3rem_5.6rem]'} gap-x-2 px-3 h-6 items-center font-mono text-[11px] whitespace-nowrap`}
            >
              <span className="text-ink-3">{fmtHms(f.t)}</span>
              <span className={f.bid ? 'text-of-buy-ink' : 'text-of-sell-ink'}>{fmtPx(f.px)}</span>
              <span className="text-right text-ink-1">
                {narrow ? (
                  compact(f.peakUsd)
                ) : (
                  <>
                    {fmtVol(f.peakUsd / f.px)} <span className="text-ink-3">· {compact(f.peakUsd)}</span>
                  </>
                )}
              </span>
              {!narrow && <span className="text-right text-ink-3">{fmtLife(f.t - f.since)}</span>}
              <span className={`text-right font-semibold ${v.cls}`}>
                {v.icon} {v.short()}
              </span>
            </div>
          );
        })}
      </div>
      <p className="px-3 py-1.5 border-t border-line text-[10px] leading-snug text-ink-3 shrink-0">
        {tr(
          `Ściana: poziom co ${step} USD od ${compact(minUsd)} USD (5% największych poziomów z ostatniej godziny). Werdykt z porównania migawek co ok. 5 s, netto: zlecenie krótsze niż odstęp migawek jest niewidoczne, więc to nie jest wykrywanie spoofingu. Bez żadnej transakcji zniknęło ${untouched} z ${fates.length}; przy cenie (do 1 poziomu) zjedzono ${near.eaten} z ${near.n}. Lista: ściany żyjące od 30 s.`,
          `Wall: a level every ${step} USD from ${compact(minUsd)} USD (top 5% of levels in the last hour). The verdict compares snapshots every ~5 s, net: an order shorter than the snapshot gap is invisible, so this is not spoofing detection. ${untouched} of ${fates.length} vanished without any trade; at the price (up to 1 level) ${near.eaten} of ${near.n} were eaten. List: walls alive for 30 s or more.`
        )}
      </p>
    </section>
  );
};
