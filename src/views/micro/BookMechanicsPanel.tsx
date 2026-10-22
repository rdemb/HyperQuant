import React, { useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useMicroMechanics } from '../../state/useMicroMechanics';
import { Badge, Panel, Stat, DASH, fmtPrice, fmtSigned } from '../../ui';
import { MicroMetrics } from '../../utils/microEngine';
import { useElementWidth } from '../market/MarketMap';

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const btc = (v: number) => `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} BTC`;
const usd = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? DASH : `${fmtSigned(v, d)} $`);

/** Mikrostruktura jako mechanika: OFI → cena, endogeniczność (Hawkes), mikrocena, przepływ zleceń przy cenie, absorpcja. */
export const BookMechanicsPanel: React.FC = () => {
  const m = useMicroMechanics();
  const minutes = m.since !== null ? Math.max(0, Math.round((Date.now() - m.since) / 60_000)) : 0;
  return (
    <Panel
      eyebrow={`Z literatury · historia od otwarcia strony${m.since !== null ? ` (${minutes} min, maks. 30)` : ''}`}
      title="Mechanika arkusza"
      actions={
        <Badge tone="model" title="Estymatory z publicznego arkusza i taśmy Hyperliquid — opis mechaniki, nie sygnał">
          MODEL
        </Badge>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <OfiCard m={m} />
        <HawkesCard m={m} />
        <MicroCard m={m} />
        <FlowCard m={m} />
        <AbsorptionCard m={m} />
        <div className="rounded-lg border border-line bg-surface-2/50 p-3 text-[11px] text-ink-2 leading-relaxed">
          <div className="text-ink-1 font-medium mb-1">Metoda</div>
          Publiczne kanały Hyperliquid od otwarcia tej strony (API nie udostępnia historii arkusza): <code>bbo</code> (najlepsze kwotowania, ok. co
          150 ms) do OFI i mikroceny, <code>l2Book</code> (migawka arkusza, ok. co 5 s) do bilansu zleceń, <code>trades</code> do wolumenu agresora i
          procesu Hawkesa. Interwały 10 s. OFI według Cont, Kukanov &amp; Stoikov (2014). Hawkes z jądrem wykładniczym (MLE), gdzie
          zdarzeniem jest blok z transakcjami (Filimonov &amp; Sornette 2012). Mikrocena: średnia ważona i empiryczna korekta wg nierównowagi
          (Stoikov 2018). Dodania i anulowania to bilans netto między migawkami w paśmie ±10 bp, nie zapis każdego zlecenia. Absorpcja to reszta
          odpornej regresji ruchu ceny na wolumenie agresora.
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

const Collecting: React.FC<{ what: string }> = ({ what }) => <div className="text-xs text-ink-3">Zbieram dane — {what}.</div>;

/** OFI → zmiana ceny: wykres punktowy interwałów 10 s z prostą regresji (jedna oś na zmienną). */
const OfiCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const fit = m.ofi.fit;
  return (
    <Card title="OFI → zmiana ceny" cite="Cont, Kukanov & Stoikov 2014">
      {!fit ? (
        <Collecting what={`potrzeba 30 interwałów 10 s (jest ${m.ofi.intervals})`} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Wpływ β" value={<span className="font-mono tabular-nums text-base">{usd(fit.beta, 2)}</span>} hint="na 1 BTC OFI" />
            <Stat label="R²" value={<span className="font-mono tabular-nums text-base">{fit.r2.toFixed(2)}</span>} hint={`${fit.n} interwałów`} />
            <Stat
              label="Ostatnie 10 s"
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
        <svg width={width} height={H} role="img" aria-label="Zmiana ceny względem OFI w interwałach 10 s z prostą regresji">
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
            +{ye.toFixed(1)}$
          </text>
          <text x={pad.l - 4} y={H - pad.b} textAnchor="end" className="fill-ink-3 font-mono" fontSize={9}>
            −{ye.toFixed(1)}$
          </text>
          <text x={width - pad.r} y={H - 6} textAnchor="end" className="fill-ink-3" fontSize={9}>
            OFI (BTC) →
          </text>
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute top-0 left-12 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[11px] text-ink-2 shadow-lg">
          OFI {fmtSigned(hp.x, 2)} BTC · Δcena {usd(hp.y, 1)}
        </div>
      )}
    </div>
  );
};

/** Endogeniczność: współczynnik rozgałęzienia Hawkesa na skali 0–1. */
const HawkesCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const h = m.hawkes;
  return (
    <Card title="Endogeniczność transakcji" cite="Hawkes · Filimonov & Sornette 2012">
      {!h ? (
        <Collecting what="potrzeba co najmniej 50 bloków z transakcjami (dopasowanie co 30 s)" />
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold font-mono tabular-nums text-ink-1">{h.branching.toFixed(2)}</span>
            <span className="text-xs text-ink-2">
              ≈ {Math.round(h.branching * 100)}% transakcji to reakcje na wcześniejsze transakcje (współczynnik rozgałęzienia n)
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-surface-3" role="img" aria-label={`Współczynnik rozgałęzienia ${h.branching.toFixed(2)} na skali od 0 do 1`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, h.branching * 100)}%` }} />
            <div className="absolute -top-1 h-4 w-px bg-warn" style={{ left: '90%' }} title="n ≥ 0.9 — rynek blisko krytyczności (samonapędzający się)" />
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="Tło μ" value={<span className="font-mono tabular-nums text-base">{h.mu.toFixed(2)}</span>} hint="bloków/s z zewnątrz" />
            <Stat label="Półokres" value={<span className="font-mono tabular-nums text-base">{h.halfLife < 1 ? `${Math.round(h.halfLife * 1000)} ms` : `${h.halfLife.toFixed(1)} s`}</span>} hint="wygasanie pobudzenia" />
            <Stat label="Zdarzenia" value={<span className="font-mono tabular-nums text-base">{h.n}</span>} hint={`dopasowanie ${timeFmt.format(h.at)}`} />
          </div>
        </>
      )}
    </Card>
  );
};

const MicroCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const mc = m.micro;
  return (
    <Card title="Mikrocena" cite="Stoikov 2018">
      {!mc ? (
        <Collecting what="czekam na arkusz" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Mid" value={<span className="font-mono tabular-nums text-base">{fmtPrice(mc.mid, 1)}</span>} />
          <Stat
            label="Średnia ważona"
            value={<span className="font-mono tabular-nums text-base">{usd(mc.weighted - mc.mid, 2)}</span>}
            hint={`nierównowaga I = ${mc.imb.toFixed(2)}`}
          />
          <Stat
            label="Korekta empiryczna"
            value={<span className="font-mono tabular-nums text-base">{mc.adj === null ? DASH : usd(mc.adj, 2)}</span>}
            hint={mc.adj === null ? `od 200 par (jest ${mc.samples})` : 'średnia zmiana mid po 5 s przy tej nierównowadze'}
          />
          <Stat
            label="R² predykcji"
            value={<span className="font-mono tabular-nums text-base">{mc.r2 === null ? DASH : mc.r2.toFixed(3)}</span>}
            hint="jak dużo zmiany mid wyjaśnia nierównowaga"
          />
        </div>
      )}
    </Card>
  );
};

const FlowCard: React.FC<{ m: MicroMetrics }> = ({ m }) => {
  const rows = [
    { side: 'Bid (kupno)', f: m.flow5m.bid },
    { side: 'Ask (sprzedaż)', f: m.flow5m.ask },
  ];
  const any = rows.some((r) => r.f.added + r.f.cancelled + r.f.executed > 0);
  return (
    <Card title="Zlecenia przy cenie · 5 min · ±10 bp" cite="bilans migawek arkusza (co ~5 s)">
      {!any ? (
        <Collecting what="czekam na zmiany arkusza" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">Dodane, anulowane i wykonane zlecenia przy cenie w ostatnich 5 minutach</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">Strona</th>
                <th className="py-1 pr-3 font-medium">Dodane</th>
                <th className="py-1 pr-3 font-medium">Anulowane</th>
                <th className="py-1 pr-3 font-medium">Wykonane</th>
                <th className="py-1 font-medium" title="Anulowane / dodane — wysokie wartości: płynność wycofywana zamiast wykonywana (pulling)">
                  Anul./dod.
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
                  <td className="py-1">{r.f.added > 0 ? (r.f.cancelled / r.f.added).toFixed(2) : DASH}</td>
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
    <Card title="Absorpcja: wysiłek vs efekt" cite="reszta regresji ΔP na wolumenie agresora">
      {a.lambda === null ? (
        <Collecting what={`potrzeba 30 interwałów 10 s (jest ${m.ofi.intervals})`} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Wpływ λ" value={<span className="font-mono tabular-nums text-base">{usd(a.lambda, 2)}</span>} hint="na 1 BTC wolumenu agresora / 10 s" />
            <Stat label="R²" value={<span className="font-mono tabular-nums text-base">{a.r2 === null ? DASH : a.r2.toFixed(2)}</span>} hint="dopasowanie odporne" />
          </div>
          {a.events.length === 0 ? (
            <div className="text-xs text-ink-3">Brak zdarzeń absorpcji: duży wolumen agresora przesuwał cenę zgodnie z modelem.</div>
          ) : (
            <ul className="flex flex-col gap-1 text-[11px] font-mono tabular-nums">
              {a.events
                .slice(-6)
                .reverse()
                .map((e) => (
                  <li key={e.t} className="flex flex-wrap gap-x-2">
                    <span className="text-ink-3">{timeFmt.format(e.t)}</span>
                    <span className={e.side === 'buy' ? 'text-buy-ink' : 'text-sell-ink'}>{e.side === 'buy' ? 'kupno pochłonięte' : 'sprzedaż pochłonięta'}</span>
                    <span>{btc(Math.abs(e.signedVol))}</span>
                    <span className="text-ink-3">
                      oczekiwano {usd(e.expected)} · było {usd(e.realized)}
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
