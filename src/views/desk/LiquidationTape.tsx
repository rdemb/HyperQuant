import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useLiqTape } from '../../state/useLiqTape';
import { Badge, Stat, DASH, fmtCompact, fmtPrice, fmtSigned } from '../../ui';
import { LiqTape, calibErrorBp } from '../../utils/liqTape';
import { useElementWidth } from '../market/MarketMap';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const BUCKET = 5 * MIN;
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const bp = (v: number | null, signed = false) => (v === null ? DASH : signed ? fmtSigned(v, 0, ' bp') : `${Math.round(v)} bp`);

/** Zrealizowane likwidacje śledzonych pozycji (potwierdzone fillami) — uzupełnienie mapy: co faktycznie zostało zlikwidowane. */
export const LiquidationTape: React.FC<{ coverage: number | null }> = ({ coverage }) => {
  const { status, tape } = useLiqTape();
  if (status === 'unconfigured') return null;

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="liq-tape-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="liq-tape-title" className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
          Zrealizowane likwidacje · 24 h
        </h3>
        {status === 'ready' ? (
          <Badge tone="live" title="Likwidacje śledzonych pozycji potwierdzone fillami konta z polem liquidation (publiczne API Hyperliquid)">
            LIVE
          </Badge>
        ) : status === 'stale' || status === 'expired' ? (
          <Badge tone="stale" title="Skaner nie publikuje aktualnej taśmy — liczby ukryte">
            STALE
          </Badge>
        ) : null}
      </div>
      {status === 'loading' ? (
        <div className="text-xs text-ink-3">Pobieram taśmę likwidacji…</div>
      ) : status === 'error' || !tape ? (
        <div className="text-xs text-ink-3">Taśma likwidacji chwilowo niedostępna.</div>
      ) : status !== 'ready' ? (
        <div className="text-xs text-ink-3">Taśma nieaktualna — ostatnia publikacja {timeFmt.format(tape.asOf)}; liczby ukryte.</div>
      ) : (
        <TapeBody tape={tape} coverage={coverage} />
      )}
    </section>
  );
};

const TapeBody: React.FC<{ tape: LiqTape; coverage: number | null }> = ({ tape, coverage }) => {
  const { h1, h24 } = tape.totals;
  const c = tape.calib;
  const ch = tape.checks;
  const partial = tape.since > tape.asOf - DAY;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
        <Stat
          label="▼ Longi"
          value={<span className="font-mono tabular-nums">{fmtCompact(h24.longUsd, '$')}</span>}
          hint={`ostatnia godzina ${fmtCompact(h1.longUsd, '$')}`}
        />
        <Stat
          label="▲ Shorty"
          value={<span className="font-mono tabular-nums">{fmtCompact(h24.shortUsd, '$')}</span>}
          hint={`ostatnia godzina ${fmtCompact(h1.shortUsd, '$')}`}
        />
        <Stat
          label="Błąd ceny likw. z mapy"
          value={<span className="font-mono tabular-nums">{bp(c.medAbsErrBp)}</span>}
          hint={
            c.n > 0
              ? `mediana |błędu| z ${c.n} likw. · ze znakiem ${bp(c.medSignedErrBp, true)} · p90 ${bp(c.p90AbsErrBp)} · odczyt sprzed ${
                  c.medAgeMin === null ? DASH : `${c.medAgeMin.toFixed(1)} min`
                }`
              : 'brak likwidacji do porównania z mapą'
          }
        />
        <Stat
          label="Obserwacja"
          value={<span className="font-mono tabular-nums">{partial ? `od ${timeFmt.format(tape.since)}` : '24 h'}</span>}
          hint={`kandydaci ${ch.candidates} · potwierdzone ${ch.confirmed} · zamknięcia ${ch.rejected} · niesprawdzone ${ch.failed}`}
        />
      </div>
      <TapeTimeline tape={tape} />
      <EventTable tape={tape} />
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Hyperliquid nie publikuje strumienia likwidacji wszystkich kont. Skaner zauważa, że śledzona pozycja zmalała, gdy cena dotknęła jej ceny
        likwidacji, i potwierdza to w fillach konta (pole <code>liquidation</code>) — bez potwierdzenia zdarzenia nie ma na taśmie. Obejmuje więc
        tylko zmierzoną część open interest{coverage !== null ? ` (${(coverage * 100).toFixed(1)}%)` : ''}. Błąd ceny likwidacji: o ile cena mark
        przy likwidacji różniła się od ceny likwidacji z ostatniego odczytu (dodatni = głębiej niż mapa; ujemny = wcześniej, np. strata konta
        cross na innym rynku). Wykrywane są likwidacje do 0.5% przed poziomem z mapy; pozycje blisko ceny likwidacji skaner odczytuje co minutę,
        więc miara opisuje świeże odczyty, nie całą mapę. Bez adresów; czas do minuty, rozmiar zaokrąglony; opóźnienie do kilku minut.
      </p>
    </>
  );
};

/** Oś 24 h: kubełki 5 min, shorty nad osią (kupno), longi pod osią (sprzedaż), wspólna skala. */
const TapeTimeline: React.FC<{ tape: LiqTape }> = ({ tape }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  /** Kubełek wskazany kursorem — po czasie, nie indeksie (dane odświeżają się co minutę) */
  const [hover, setHover] = useState<number | null>(null);
  const H = 120;
  const pad = { l: 48, r: 10, t: 8, b: 22 };
  const from = tape.asOf - DAY;
  const maxY = Math.max(1, ...tape.buckets.map((b) => Math.max(b.longUsd, b.shortUsd)));
  const x = scaleLinear().domain([from, tape.asOf]).range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const mid = (H - pad.b + pad.t) / 2;
  const y = scaleLinear().domain([0, maxY]).range([0, mid - pad.t]);
  const bw = Math.max(1.5, x(from + BUCKET) - x(from) - 1);
  const hourTicks = useMemo(() => {
    const out: number[] = [];
    const first = Math.ceil(from / (6 * 60 * MIN)) * 6 * 60 * MIN;
    for (let t = first; t <= tape.asOf; t += 6 * 60 * MIN) out.push(t);
    return out;
  }, [from, tape.asOf]);
  const hb = hover !== null ? tape.buckets.find((b) => b.t === hover) ?? null : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Likwidacje śledzonych pozycji w ostatnich 24 godzinach, kubełki 5 minut">
          {tape.since > from && (
            <g>
              <rect x={pad.l} y={pad.t} width={Math.max(0, x(tape.since) - pad.l)} height={H - pad.b - pad.t} fill="var(--color-surface-2)" opacity={0.6} />
              {x(tape.since) - pad.l > 90 && (
                <text x={(pad.l + x(tape.since)) / 2} y={mid + 14} dy="0.32em" textAnchor="middle" className="fill-ink-3" fontSize={10}>
                  brak obserwacji
                </text>
              )}
            </g>
          )}
          <line x1={pad.l} x2={width - pad.r} y1={mid} y2={mid} stroke="var(--color-line-strong)" strokeWidth={1} />
          {tape.buckets.length > 0 && (
            <>
              <text x={pad.l - 6} y={pad.t + 6} textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                ▲{fmtCompact(maxY, '$')}
              </text>
              <text x={pad.l - 6} y={H - pad.b - 2} textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                ▼{fmtCompact(maxY, '$')}
              </text>
            </>
          )}
          {tape.buckets.map((b) => {
            const x0 = x(b.t);
            const hs = y(b.shortUsd);
            const hl = y(b.longUsd);
            return (
              <g key={b.t} opacity={hover === null || hover === b.t ? 1 : 0.5}>
                {b.shortUsd > 0 && <rect x={x0} y={mid - 1 - Math.max(2, hs)} width={bw} height={Math.max(2, hs)} rx={Math.min(2, bw / 2)} fill="var(--color-buy)" />}
                {b.longUsd > 0 && <rect x={x0} y={mid + 1} width={bw} height={Math.max(2, hl)} rx={Math.min(2, bw / 2)} fill="var(--color-sell)" />}
                <rect
                  x={x0 - 4}
                  y={pad.t}
                  width={bw + 8}
                  height={H - pad.b - pad.t}
                  fill="transparent"
                  onMouseEnter={() => setHover(b.t)}
                  onMouseLeave={() => setHover(null)}
                  onTouchStart={() => setHover((h) => (h === b.t ? null : b.t))}
                />
              </g>
            );
          })}
          {tape.buckets.length === 0 && (
            <text x={(pad.l + width - pad.r) / 2} y={pad.t + 10} textAnchor="middle" className="fill-ink-2" fontSize={11}>
              brak likwidacji śledzonych pozycji od {timeFmt.format(tape.since)}
            </text>
          )}
          {hourTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
              {timeFmt.format(t)}
            </text>
          ))}
        </svg>
      )}
      {hb && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-lg"
          style={{ left: Math.min(Math.max(0, x(hb.t) - 80), Math.max(0, width - 190)) }}
        >
          <div className="font-mono tabular-nums text-ink-1">
            {timeFmt.format(hb.t)}–{timeFmt.format(hb.t + BUCKET)}
          </div>
          <div>▲ shorty: {hb.shortUsd > 0 ? fmtCompact(hb.shortUsd, '$') : DASH}</div>
          <div>▼ longi: {hb.longUsd > 0 ? fmtCompact(hb.longUsd, '$') : DASH}</div>
          <div className="text-ink-3">{hb.n} likw.</div>
        </div>
      )}
    </div>
  );
};

/** Ostatnie zdarzenia — liczby dostępne bez wykresu. */
const EventTable: React.FC<{ tape: LiqTape }> = ({ tape }) => {
  const rows = tape.events.slice(0, 10);
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono tabular-nums text-[11px]">
        <caption className="sr-only">Ostatnie likwidacje śledzonych pozycji</caption>
        <thead className="text-ink-3">
          <tr>
            <th className="py-1 pr-3 font-medium">Czas</th>
            <th className="py-1 pr-3 font-medium">Strona</th>
            <th className="py-1 pr-3 font-medium">Rozmiar</th>
            <th className="py-1 pr-3 font-medium">Wartość</th>
            <th className="py-1 pr-3 font-medium">Cena</th>
            <th className="py-1 pr-3 font-medium">Tryb</th>
            <th className="py-1 font-medium" title="Cena mark przy likwidacji względem ceny likwidacji z ostatniego odczytu (wiek odczytu)">
              Błąd mapy
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.t}-${e.sz}-${e.px}`} className="border-t border-line">
              <td className="py-1 pr-3">{timeFmt.format(e.t)}</td>
              <td className={`py-1 pr-3 font-sans ${e.side === 'long' ? 'text-sell-ink' : 'text-buy-ink'}`}>{e.side === 'long' ? '▼ long' : '▲ short'}</td>
              <td className="py-1 pr-3">{e.sz} BTC</td>
              <td className="py-1 pr-3">{fmtCompact(e.usd, '$')}</td>
              <td className="py-1 pr-3">{fmtPrice(e.px, 0)}</td>
              <td className="py-1 pr-3 font-sans">{e.method === 'backstop' ? 'backstop' : 'arkusz'}</td>
              <td className="py-1">
                {bp(calibErrorBp(e), true)}
                {e.mapAgeMin !== null && <span className="text-ink-3"> · {Math.round(e.mapAgeMin)} min</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
