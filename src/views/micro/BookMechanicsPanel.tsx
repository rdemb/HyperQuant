import React, { useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useMicroMechanics } from '../../state/useMicroMechanics';
import { Badge, Panel, Stat, DASH, fmtPrice, fmtSigned, fmtFixed } from '../../ui';
import { MicroMetrics } from '../../utils/microEngine';
import { useElementWidth } from '../market/MarketMap';
import { locale, tr } from '../../i18n';

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const btc = (v: number) => `${fmtFixed(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} BTC`;
const usd = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? DASH : `${fmtSigned(v, d)} $`);

/** Mikrostruktura jako mechanika: OFI → cena, endogeniczność (Hawkes), mikrocena, przepływ zleceń przy cenie, absorpcja. */
export const BookMechanicsPanel: React.FC = () => {
  const m = useMicroMechanics();
  const minutes = m.since !== null ? Math.max(0, Math.round((Date.now() - m.since) / 60_000)) : 0;
  return (
    <Panel
      eyebrow={tr(
        `Z literatury · historia od otwarcia strony${m.since !== null ? ` (${minutes} min, maks. 30)` : ''}`,
        `From the literature · history since the page opened${m.since !== null ? ` (${minutes} min, max 30)` : ''}`
      )}
      title={tr('Mechanika arkusza', 'Book mechanics')}
      actions={
        <span className="flex items-center gap-1.5">
          {m.stale && m.since !== null && (
            <Badge tone="stale" title={tr('Kanał kwotowań Hyperliquid milczy dłużej niż 15 s — wartości mogą być nieaktualne', 'The Hyperliquid quote channel has been silent for more than 15 s; values may be stale')}>
              STALE
            </Badge>
          )}
          <Badge tone="model" title={tr('Estymatory z publicznego arkusza i taśmy Hyperliquid — opis mechaniki, nie sygnał', 'Estimators from the public Hyperliquid book and tape; a description of mechanics, not a signal')}>
            MODEL
          </Badge>
        </span>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <OfiCard m={m} />
        <HawkesCard m={m} />
        <MicroCard m={m} />
        <FlowCard m={m} />
        <AbsorptionCard m={m} />
        <div className="rounded-lg border border-line bg-surface-2/50 p-3 text-[11px] text-ink-2 leading-relaxed">
          <div className="text-ink-1 font-medium mb-1">{tr('Metoda', 'Method')}</div>
          {tr(
            <>
              Publiczne kanały Hyperliquid od otwarcia tej strony (API nie udostępnia historii arkusza): <code>bbo</code> (najlepsze kwotowania, ok. co
              150 ms) do OFI i mikroceny, <code>l2Book</code> (migawka arkusza, ok. co 5 s) do bilansu zleceń, <code>trades</code> do wolumenu agresora
              i procesu Hawkesa (powtórki transakcji po ponownym połączeniu pomijane). Interwały 10 s. OFI według Cont, Kukanov &amp; Stoikov (2014).
              Hawkes z jądrem wykładniczym (MLE), gdzie zdarzeniem jest blok z transakcjami (Filimonov &amp; Sornette 2012). Mikrocena: średnia
              ważona i empiryczna korekta wg nierównowagi z próbek symetryzowanych (Stoikov 2018), R² poza próbą. Dodania i anulowania to bilans
              netto między migawkami w paśmie ±10 bp, tylko w zakresie widocznym w obu migawkach (arkusz ucięty do 20 poziomów), nie zapis każdego
              zlecenia. Absorpcja to reszta regresji Theila–Sena ruchu ceny na wolumenie agresora (odporna na wartości odstające).
            </>,
            <>
              Public Hyperliquid channels since this page opened (the API has no book history): <code>bbo</code> (best quotes, about every 150 ms) for
              OFI and the microprice, <code>l2Book</code> (book snapshot, about every 5 s) for the order balance, <code>trades</code> for aggressor volume
              and the Hawkes process (trade replays after a reconnect are skipped). 10 s intervals. OFI after Cont, Kukanov &amp; Stoikov (2014). Hawkes
              with an exponential kernel (MLE), where an event is a block with trades (Filimonov &amp; Sornette 2012). Microprice: the weighted mid and an
              empirical correction by imbalance from symmetrised samples (Stoikov 2018), out-of-sample R². Additions and cancellations are the net
              balance between snapshots within ±10 bp, only in the range visible in both snapshots (book cut to 20 levels), not a record of every
              order. Absorption is the residual of a Theil–Sen regression of the price move on aggressor volume (robust to outliers).
            </>
          )}
        </div>
      </div>
    </Panel>
  );
};

const Card: React.FC<{ title: string; cite: string; children: React.ReactNode }> = ({ title, cite, children }) => (
  <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
    <div className="flex items-baseline justify-between gap-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{title}</div>
      <span className="text-[10px] text-ink-3">{cite}</span>
    </div>
    {children}
  </div>
);

const Collecting: React.FC<{ what: string }> = ({ what }) => (
  <div className="text-xs text-ink-3">
    {tr('Zbieram dane', 'Collecting data')}: {what}.
  </div>
);

/** OFI → zmiana ceny: wykres punktowy interwałów 10 s z prostą regresji (jedna oś na zmienną). */
const OfiCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const fit = m.ofi.fit;
  return (
    <Card title={tr('OFI → zmiana ceny', 'OFI → price change')} cite="Cont, Kukanov & Stoikov 2014">
      {!fit ? (
        m.ofi.intervals >= 30 ? (
          <div className="text-xs text-ink-3">
            {tr('Za mało zmienności w interwałach (cena albo OFI bez zmian) — zależności nie da się oszacować.', 'Too little variation in the intervals (price or OFI unchanged); the relationship cannot be estimated.')}
          </div>
        ) : (
          <Collecting what={tr(`potrzeba 30 interwałów 10 s (jest ${m.ofi.intervals})`, `30 intervals of 10 s needed (have ${m.ofi.intervals})`)} />
        )
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr('Wpływ β', 'Impact β')} value={<span className="font-mono tabular-nums text-base">{usd(fit.beta, 2)}</span>} hint={tr('na 1 BTC OFI', 'per 1 BTC of OFI')} />
            <Stat label="R²" value={<span className="font-mono tabular-nums text-base">{fmtFixed(fit.r2, 2)}</span>} hint={tr(`${fit.n} interwałów`, `${fit.n} intervals`)} />
            <Stat
              label={tr('Ostatnie 10 s', 'Last 10 s')}
              value={<span className="font-mono tabular-nums text-base">{m.ofi.last === null ? DASH : `${fmtSigned(m.ofi.last, 1)}`}</span>}
              hint={m.ofi.lastZ === null ? 'BTC' : `BTC · z ${fmtSigned(m.ofi.lastZ, 1)} · ${usd(m.ofi.implied)}`}
            />
          </div>
          <Scatter points={m.ofi.points} alpha={fit.alpha} beta={fit.beta} />
        </>
      )}
    </Card>
  );
};

const Scatter: React.FC<{ points: { x: number; y: number }[]; alpha: number; beta: number }> = ({ points, alpha, beta }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 150;
  const pad = { l: 44, r: 8, t: 6, b: 20 };
  const xe = Math.max(1e-9, ...points.map((p) => Math.abs(p.x)));
  const ye = Math.max(1e-9, ...points.map((p) => Math.abs(p.y)));
  const x = scaleLinear().domain([-xe, xe]).range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const y = scaleLinear().domain([-ye, ye]).range([H - pad.b, pad.t]);
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={tr('Zmiana ceny względem OFI w interwałach 10 s z prostą regresji', 'Price change against OFI in 10 s intervals with the regression line')}>
          <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" />
          <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} stroke="var(--color-line-strong)" />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={x(p.x)}
              cy={y(p.y)}
              r={hover === i ? 4 : 2.5}
              fill="var(--color-accent)"
              opacity={hover === null || hover === i ? 0.75 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          <line x1={x(-xe)} y1={y(alpha - beta * xe)} x2={x(xe)} y2={y(alpha + beta * xe)} stroke="var(--color-level)" strokeWidth={2} />
          <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" className="fill-ink-3 font-mono" fontSize={9}>
            +{fmtFixed(ye, 1)}$
          </text>
          <text x={pad.l - 4} y={H - pad.b} textAnchor="end" className="fill-ink-3 font-mono" fontSize={9}>
            −{fmtFixed(ye, 1)}$
          </text>
          <text x={width - pad.r} y={H - 6} textAnchor="end" className="fill-ink-3" fontSize={9}>
            OFI (BTC) →
          </text>
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute top-0 left-12 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[11px] text-ink-2 shadow-lg">
          OFI {fmtSigned(hp.x, 2)} BTC · {tr('Δcena', 'Δprice')} {usd(hp.y, 1)}
        </div>
      )}
    </div>
  );
};

/** Endogeniczność: współczynnik rozgałęzienia Hawkesa na skali 0–1. */
const HawkesCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const h = m.hawkes;
  return (
    <Card title={tr('Endogeniczność transakcji', 'Trade endogeneity')} cite="Hawkes · Filimonov & Sornette 2012">
      {!h ? (
        <Collecting what={tr('potrzeba co najmniej 300 bloków z transakcjami (dopasowanie co 30 s)', 'at least 300 blocks with trades needed (fit every 30 s)')} />
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold font-mono tabular-nums text-ink-1">{fmtFixed(h.branching, 2)}</span>
            <span className="text-xs text-ink-2">
              {tr(
                `współczynnik rozgałęzienia n: w modelu ${Math.round(h.branching * 100)}% zdarzeń (bloków z transakcjami) przypisanych samopobudzeniu`,
                `branching ratio n: in the model ${Math.round(h.branching * 100)}% of events (blocks with trades) are attributed to self-excitation`
              )}
            </span>
          </div>
          {h.branching > 0.98 && (
            <div className="text-[11px] text-warn leading-snug">
              {tr(
                'n na granicy 1 — typowe, gdy natężenie tła zmienia się w oknie (Filimonov & Sornette 2015); to nie dowód krytyczności rynku.',
                'n at the edge of 1 is typical when the background intensity changes within the window (Filimonov & Sornette 2015); it is not proof of market criticality.'
              )}
            </div>
          )}
          <div className="relative h-2 rounded-full bg-surface-3" role="img" aria-label={tr(`Współczynnik rozgałęzienia ${fmtFixed(h.branching, 2)} na skali od 0 do 1`, `Branching ratio ${fmtFixed(h.branching, 2)} on a scale from 0 to 1`)}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, h.branching * 100)}%` }} />
            <div className="absolute -top-1 h-4 w-px bg-warn" style={{ left: '90%' }} title={tr('n ≥ 0,9 — rynek blisko krytyczności (samonapędzający się)', 'n ≥ 0.9: market close to criticality (self-reinforcing)')} />
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label={tr('Tło μ', 'Background μ')} value={<span className="font-mono tabular-nums text-base">{fmtFixed(h.mu, 2)}</span>} hint={tr('bloków/s z zewnątrz', 'external blocks/s')} />
            <Stat
              label={tr('Półokres', 'Half-life')}
              value={
                <span className="font-mono tabular-nums text-base">
                  {h.branching < 0.05 ? DASH : h.halfLife < 1 ? `${Math.round(h.halfLife * 1000)} ms` : `${fmtFixed(h.halfLife, 1)} s`}
                </span>
              }
              hint={h.branching < 0.05 ? tr('przy n ≈ 0 nieokreślony', 'undefined at n ≈ 0') : tr('wygasanie pobudzenia', 'excitation decay')}
            />
            <Stat
              label={tr('Zdarzenia', 'Events')}
              value={<span className="font-mono tabular-nums text-base">{h.n}</span>}
              hint={`${tr('dopasowanie', 'fit')} ${timeFmt.format(h.at)}`}
            />
          </div>
          <div className="text-[11px] text-ink-3 leading-snug">
            {tr(
              'Zdarzenie to blok z transakcjami, nie pojedyncza transakcja: łączenie w bloki zaniża n, a zmienne tło je zawyża — czytaj jako opis bieżącego okna, nie stałą rynku.',
              'An event is a block with trades, not a single trade: grouping into blocks lowers n and a changing background raises it. Read it as a description of the current window, not a market constant.'
            )}
          </div>
        </>
      )}
    </Card>
  );
};

const MicroCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const mc = m.micro;
  return (
    <Card title={tr('Mikrocena', 'Microprice')} cite="Stoikov 2018">
      {!mc ? (
        <Collecting what={tr('czekam na arkusz', 'waiting for the book')} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Mid" value={<span className="font-mono tabular-nums text-base">{fmtPrice(mc.mid, 1)}</span>} />
          <Stat
            label={tr('Średnia ważona', 'Weighted mid')}
            value={<span className="font-mono tabular-nums text-base">{usd(mc.weighted - mc.mid, 2)}</span>}
            hint={`${tr('nierównowaga', 'imbalance')} I = ${fmtFixed(mc.imb, 2)}`}
          />
          <Stat
            label={tr('Korekta empiryczna', 'Empirical correction')}
            value={<span className="font-mono tabular-nums text-base">{mc.adj === null ? DASH : usd(mc.adj, 2)}</span>}
            hint={
              mc.adj === null
                ? tr(`od 10 min kwotowań (jest ${Math.floor(mc.span / 60_000)} min)`, `from 10 min of quotes (have ${Math.floor(mc.span / 60_000)} min)`)
                : tr('średnia zmiana mid po 5 s przy tej nierównowadze (próbki symetryzowane)', 'average mid change after 5 s at this imbalance (symmetrised samples)')
            }
          />
          <Stat
            label={tr('R² poza próbą', 'Out-of-sample R²')}
            value={<span className="font-mono tabular-nums text-base">{mc.r2Oos === null ? DASH : fmtFixed(mc.r2Oos, 3)}</span>}
            hint={tr('ostatnia 1/3 historii vs założenie „mid się nie zmieni”; ≤ 0 = brak przewagi', 'last 1/3 of history vs the "mid will not change" assumption; ≤ 0 = no edge')}
          />
        </div>
      )}
    </Card>
  );
};

const FlowCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const rows = [
    { side: tr('Bid (kupno)', 'Bid (buy)'), f: m.flow5m.bid },
    { side: tr('Ask (sprzedaż)', 'Ask (sell)'), f: m.flow5m.ask },
  ];
  const any = rows.some((r) => r.f.added + r.f.cancelled + r.f.executed > 0);
  return (
    <Card title={tr('Zlecenia przy cenie · 5 min · ±10 bp', 'Orders near price · 5 min · ±10 bp')} cite={tr('bilans migawek arkusza (co ~5 s)', 'balance of book snapshots (every ~5 s)')}>
      {!any ? (
        <Collecting what={tr('czekam na zmiany arkusza', 'waiting for book changes')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">{tr('Dodane, anulowane i wykonane zlecenia przy cenie w ostatnich 5 minutach', 'Added, cancelled and executed orders near price in the last 5 minutes')}</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">{tr('Strona', 'Side')}</th>
                <th className="py-1 pr-3 font-medium">{tr('Dodane', 'Added')}</th>
                <th className="py-1 pr-3 font-medium">{tr('Anulowane', 'Cancelled')}</th>
                <th className="py-1 pr-3 font-medium">{tr('Wykonane', 'Executed')}</th>
                <th className="py-1 font-medium" title={tr('Anulowane / dodane — wysokie wartości: płynność wycofywana zamiast wykonywana (pulling)', 'Cancelled / added; high values: liquidity pulled instead of executed (pulling)')}>
                  {tr('Anul./dod.', 'Canc./add.')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.side} className="border-t border-line">
                  <td className="py-1 pr-3 font-sans">{r.side}</td>
                  <td className="py-1 pr-3">{btc(r.f.added)}</td>
                  <td className="py-1 pr-3">{btc(r.f.cancelled)}</td>
                  <td className="py-1 pr-3">{btc(r.f.executed)}</td>
                  <td className="py-1">{r.f.added > 0 ? fmtFixed(r.f.cancelled / r.f.added, 2) : DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

const AbsorptionCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const a = m.absorption;
  return (
    <Card title={tr('Absorpcja: wysiłek vs efekt', 'Absorption: effort vs result')} cite={tr('reszta regresji ΔP na wolumenie agresora', 'residual of the ΔP regression on aggressor volume')}>
      {a.lambda === null ? (
        <Collecting what={tr(`potrzeba 30 interwałów 10 s (jest ${m.ofi.intervals})`, `30 intervals of 10 s needed (have ${m.ofi.intervals})`)} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label={tr('Wpływ λ', 'Impact λ')}
              value={<span className="font-mono tabular-nums text-base">{usd(a.lambda, 2)}</span>}
              hint={tr('na 1 BTC wolumenu agresora / 10 s', 'per 1 BTC of aggressor volume / 10 s')}
            />
            <Stat
              label="R²"
              value={<span className="font-mono tabular-nums text-base">{a.r2 === null ? DASH : fmtFixed(a.r2, 2)}</span>}
              hint={tr('Theil–Sen, bez wartości odstających', 'Theil–Sen, without outliers')}
            />
          </div>
          {a.events.length === 0 ? (
            <div className="text-xs text-ink-3">
              {!(a.lambda > 0)
                ? tr(
                    'Wpływ λ ≤ 0 — wolumen agresora nie przesuwał ceny w swoją stronę, więc zdarzeń absorpcji nie wyznaczam.',
                    'Impact λ ≤ 0: aggressor volume did not move price its way, so no absorption events are flagged.'
                  )
                : a.large === 0
                ? tr('Brak dużych interwałów wolumenu (≥ 2× typowej wielkości) — nie było czego pochłaniać.', 'No large volume intervals (≥ 2× the typical size); nothing to absorb.')
                : tr(
                    `Brak zdarzeń absorpcji: ${a.large} ${a.large === 1 ? 'duży interwał przesunął' : 'duże interwały przesuwały'} cenę zgodnie z dopasowaniem.`,
                    `No absorption events: ${a.large} large ${a.large === 1 ? 'interval moved' : 'intervals moved'} price in line with the fit.`
                  )}
            </div>
          ) : (
            <ul className="flex flex-col gap-1 text-[11px] font-mono tabular-nums">
              {a.events
                .slice(-6)
                .reverse()
                .map((e) => (
                  <li key={e.t} className="flex flex-wrap gap-x-2">
                    <span className="text-ink-3">{timeFmt.format(e.t)}</span>
                    <span className={e.side === 'buy' ? 'text-buy-ink' : 'text-sell-ink'}>{e.side === 'buy' ? tr('kupno pochłonięte', 'buying absorbed') : tr('sprzedaż pochłonięta', 'selling absorbed')}</span>
                    <span>{btc(Math.abs(e.signedVol))}</span>
                    <span className="text-ink-3">
                      {tr('oczekiwano', 'expected')} {usd(e.expected)} · {tr('było', 'actual')} {usd(e.realized)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
};
