import React, { useEffect, useState } from 'react';
import type { Candle } from '../hl/parse';
import { MAX_CANDLES } from '../hl/rest';
import { utcDayStart } from '../core/sessions';
import { intervalById } from '../core/time';
import type { ProStore } from '../store/proStore';
import { type HonestyCard as Card, MIN_CASES, TEMPLATE_HONESTY, honestyCard, honestyStats } from './templateStats';
import { tr } from '../../../i18n';

/**
 * Karta uczciwości szablonu: jak często układ z pytania szablonu wystąpił i czym się skończył na historii świec rynku
 * wykresu. Świece pobierane raz na rynek, interwał i dobę UTC (w powtórce do końca nagrania), liczone w przeglądarce.
 */

const memo = new WeakMap<ProStore, Map<string, Promise<readonly Candle[]>>>();

function historyOf(store: ProStore, interval: string): Promise<readonly Candle[]> {
  const now = store.apiNow();
  const ms = intervalById(interval).ms;
  const key = `${interval}:${utcDayStart(now)}`;
  let m = memo.get(store);
  if (!m) memo.set(store, (m = new Map()));
  let p = m.get(key);
  if (!p) {
    p = store.candles(interval, now - MAX_CANDLES * ms, now + ms);
    m.set(key, p);
    // Pusta odpowiedź (błąd sieci) nie zostaje w pamięci — następne otwarcie pyta ponownie
    void p.then((list) => list.length === 0 && m.delete(key)).catch(() => m.delete(key));
  }
  return p;
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; card: Card };

export const HonestyCard: React.FC<{ store: ProStore; templateId: string; className?: string }> = ({ store, templateId, className = '' }) => {
  const spec = TEMPLATE_HONESTY[templateId];
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    if (!spec) return;
    let live = true;
    setState({ kind: 'loading' });
    historyOf(store, spec.interval)
      .then((bars) => live && setState(bars.length > 1 ? { kind: 'ready', card: honestyCard(honestyStats(spec.kind, bars)) } : { kind: 'error' }))
      .catch(() => live && setState({ kind: 'error' }));
    return () => {
      live = false;
    };
  }, [store, spec]);
  if (!spec) return null;
  return (
    <section aria-label={tr('Karta uczciwości szablonu', 'Template honesty card')} className={`rounded-lg border border-line bg-surface-1 px-2.5 py-2 text-[11px] leading-snug ${className}`}>
      <div className="uppercase tracking-[0.08em] text-ink-3 font-medium">
        {tr('Karta uczciwości', 'Honesty card')} · <span className="normal-case tracking-normal">{tr('opis historii, nie test strategii', 'a description of history, not a strategy test')}</span>
      </div>
      {state.kind === 'loading' && <p className="mt-1 text-ink-3">{tr('Liczę na historii świec…', 'Counting on the candle history…')}</p>}
      {state.kind === 'error' && <p className="mt-1 text-ink-3">{tr('Świece chwilowo niedostępne.', 'Candles are temporarily unavailable.')}</p>}
      {state.kind === 'ready' && (
        <>
          <p className="mt-1 text-ink-2">{state.card.intro}</p>
          <dl className="mt-1.5 space-y-1">
            {state.card.rows.map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <dt className="text-ink-2">{label}</dt>
                <dd className="font-mono tabular-nums text-ink-1">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-ink-3">
            {tr(
              `Świece rynku wykresu z API Hyperliquid (ok. ${MAX_CANDLES} ostatnich), liczone w Twojej przeglądarce. Bez kosztów, wykonania i kierunku. W nawiasie 95% przedział Wilsona (zakłada niezależne przypadki); poniżej ${MIN_CASES} przypadków bez odsetka.`,
              `Candles of the chart's market from the Hyperliquid API (about the last ${MAX_CANDLES}), computed in your browser. No costs, execution or direction. In brackets the 95% Wilson interval (assumes independent cases); below ${MIN_CASES} cases no percentage.`
            )}
          </p>
        </>
      )}
    </section>
  );
};
