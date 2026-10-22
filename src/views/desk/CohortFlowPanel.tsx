import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useCohortFlow } from '../../state/useCohortFlow';
import { Badge, EmptyState, Panel, Segmented, Stat, DASH, fmtCompact, fmtSigned } from '../../ui';
import { COHORTS, COHORT_LABEL, CohortFlow, CohortId, cumulativeNet, netOf, takerNetOf } from '../../utils/cohorts';
import { useElementWidth } from '../market/MarketMap';

/**
 * Kolory kohort: tożsamość, nie kierunek — dlatego bez series-2/series-3 (zbyt bliskie barwom sprzedaży/kupna).
 * Zestaw zwalidowany dla ciemnego tła (CVD, kontrast): series-1, -4, -5, -7.
 */
const COLOR: Record<CohortId, string> = {
  mm: 'var(--color-series-1)',
  informed: 'var(--color-series-4)',
  whale: 'var(--color-series-5)',
  rest: 'var(--color-series-7)',
};
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
/** Krótkie nazwy do etykiet bezpośrednich na wykresie */
const SHORT: Record<CohortId, string> = { mm: 'MM', informed: 'Poinf.', whale: 'Wieloryby', rest: 'Reszta' };
const usd = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v), '$')}`;
const bp = (v: number | null) => (v === null ? DASH : fmtSigned(v, 1, ' bp'));
type Mode = 'net' | 'taker';

/** Kto kupuje, kto sprzedaje: przepływ netto (zmiana zapasów) i agresywna delta per kohorta uczestników Hyperliquid. */
export const CohortFlowPanel: React.FC = () => {
  const { status, flow } = useCohortFlow();
  const [mode, setMode] = useState<Mode>('net');
  if (status === 'unconfigured') return null;

  const badge =
    status === 'ready' ? (
      <Badge tone="live" title="Agregaty z publicznej taśmy Hyperliquid (adresy obu stron, strona agresora); bez adresów">
        LIVE
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title="Skaner nie publikuje aktualnych danych — liczby ukryte">
        STALE
      </Badge>
    ) : null;

  return (
    <Panel eyebrow="Kto kupuje, kto sprzedaje · Hyperliquid" title="Przepływ kohort" actions={badge}>
      {status !== 'ready' || !flow ? (
        <EmptyState
          title={
            status === 'loading'
              ? 'Pobieram przepływ kohort…'
              : (status === 'stale' || status === 'expired') && flow
              ? `Dane nieaktualne — ostatnia publikacja ${timeFmt.format(flow.asOf)}; liczby ukryte`
              : 'Przepływ kohort chwilowo niedostępny'
          }
          detail="Każda transakcja na Hyperliquid ma publiczne adresy obu stron. Skaner przypisuje je do kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta) i publikuje wyłącznie agregaty."
        />
      ) : (
        <FlowBody flow={flow} mode={mode} setMode={setMode} />
      )}
    </Panel>
  );
};

const FlowBody: React.FC<{ flow: CohortFlow; mode: Mode; setMode: (m: Mode) => void }> = ({ flow, mode, setMode }) => {
  const partial = flow.since > flow.asOf - 24 * 3600_000;
  const inf = flow.informed;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          ariaLabel="Rodzaj przepływu"
          options={[
            { value: 'net', label: 'Netto (zapasy)', title: 'Kupno − sprzedaż wszystkich fillów kohorty; suma po kohortach = 0' },
            { value: 'taker', label: 'Agresor (CVD)', title: 'Kupno − sprzedaż kohorty jako biorcy płynności' },
          ]}
        />
        <span className="text-[11px] text-ink-3">
          ostatnia godzina · kubełki {flow.bucketMin} min{partial ? ` · obserwacja od ${timeFmt.format(flow.since)}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
        {COHORTS.map((c) => {
          const t = flow.totals.h1[c];
          const v = mode === 'net' ? netOf(t) : takerNetOf(t);
          const other = mode === 'net' ? takerNetOf(t) : netOf(t);
          return (
            <Stat
              key={c}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLOR[c] }} aria-hidden="true" />
                  {COHORT_LABEL[c]}
                </span>
              }
              value={<span className="font-mono tabular-nums">{t.buy + t.sell > 0 ? usd(v) : DASH}</span>}
              hint={`${mode === 'net' ? 'agresor' : 'netto'} ${t.buy + t.sell > 0 ? usd(other) : DASH} · ${flow.members[c].toLocaleString('pl-PL')} adr. (24 h)${
                t.hidden ? ` · ukryte ${t.hidden}` : ''
              }`}
            />
          );
        })}
      </div>

      <CumulativeChart flow={flow} mode={mode} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Markout transakcji biorców · poza próbą · 24 h</div>
          <Badge tone="model" title="Kohorta ustalona w chwili transakcji z danych wcześniejszych; markout = kierunek × zmiana ceny po h, ważony nominałem">
            MODEL
          </Badge>
        </div>
        <OosTable flow={flow} />
        <p className="text-[11px] text-ink-3 leading-relaxed">
          „Poinformowani”: adresy, których markout biorcy po 5 min jest istotnie dodatni — test jednostronny na adresach z co najmniej {inf.minN}{' '}
          rozliczonymi transakcjami, kontrola odsetka fałszywych odkryć (Benjamini–Hochberg, q = {Math.round(inf.fdrQ * 100)}%) i dodatnia średnia
          a posteriori w empirycznym Bayesie. Kandydaci {inf.candidates.toLocaleString('pl-PL')}, wybrani {inf.selected.toLocaleString('pl-PL')}
          {inf.mu0Bp !== null ? ` · średnia populacji ${bp(inf.mu0Bp)}, rozrzut umiejętności ${inf.tauBp === null ? DASH : `${inf.tauBp.toFixed(1)} bp`}` : ''}
          {inf.classifiedAt !== null ? ` · klasyfikacja ${timeFmt.format(inf.classifiedAt)}` : ' · klasyfikacja jeszcze nie wykonana'}. Tabela pokazuje, czy
          przewaga utrzymuje się na transakcjach wykonanych po klasyfikacji — jeśli nie, kohorta nie ma przewagi, niezależnie od nazwy.
        </p>
      </div>

      <details className="rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Metoda i prywatność</summary>
        <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
          <li>
            Każda transakcja z publicznej taśmy BTC ma adresy kupującego i sprzedającego oraz stronę agresora. Netto kohorty = kupno − sprzedaż
            wszystkich jej fillów, czyli zmiana jej zapasów — co jedna kohorta kupuje, inna sprzedaje, więc netto sumuje się do zera.
          </li>
          <li>
            Market makerzy: ≥ 80% nominału jako maker i ≥ 1 mln USD (z wygaszaniem, połowa po 7 dniach). Wieloryby: pozycja BTC ≥ 1 mln USD albo
            konto z publicznego rankingu ≥ 10 mln USD. Kohorty są rozłączne w tej kolejności: market makerzy, poinformowani, wieloryby, reszta.
          </li>
          <li>
            Prywatność: adresy i przynależność zostają na serwerze. Komórka (kohorta × kubełek) z mniej niż {flow.kMin} uczestnikami albo z jednym
            uczestnikiem powyżej 50% obrotu jest ukrywana — liczba ukrytych komórek jest podana przy sumach.
          </li>
          <li>To opis przepływu, nie sygnał — „poinformowani” to wynik statystyczny z przeszłości, bez gwarancji na przyszłość.</li>
        </ul>
      </details>
    </div>
  );
};

/** Skumulowany przepływ per kohorta (24 h): jedna oś USD, linia zera, etykiety bezpośrednie, krzyżyk z wartościami. */
const CumulativeChart: React.FC<{ flow: CohortFlow; mode: Mode }> = ({ flow, mode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  /** Etykiety bezpośrednie tylko, gdy jest na nie miejsce (na wąskim ekranie wystarcza legenda) */
  const direct = width >= 480;
  const pad = { l: 56, r: direct ? 124 : 10, t: 10, b: 24 };
  const series = useMemo(() => COHORTS.map((c) => ({ c, pts: cumulativeNet(flow, c, mode === 'taker') })), [flow, mode]);
  const ts = flow.buckets.map((b) => b.t + flow.bucketMin * 60_000);
  if (ts.length === 0) {
    return <div className="text-xs text-ink-3">Brak transakcji w okresie obserwacji.</div>;
  }
  const all = series.flatMap((s) => s.pts.map((p) => p.v));
  const ext = Math.max(1, ...all.map(Math.abs));
  const x = scaleLinear()
    .domain([Math.min(...ts) - flow.bucketMin * 60_000, Math.max(...ts)])
    .range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const y = scaleLinear().domain([-ext, ext]).range([H - pad.b, pad.t]).nice();
  const path = (pts: { v: number }[]) => [`M${x(ts[0] - flow.bucketMin * 60_000).toFixed(1)},${y(0).toFixed(1)}`, ...pts.map((p, i) => `L${x(ts[i]).toFixed(1)},${y(p.v).toFixed(1)}`)].join('');
  // Etykiety bezpośrednie po prawej: rozsunięte, żeby się nie nakładały (min. 12 px)
  const labels = series
    .map((s) => ({ c: s.c, y: y(s.pts[s.pts.length - 1].v), v: s.pts[s.pts.length - 1].v }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
  const hi = hover;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2" aria-hidden="true">
        {COHORTS.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ background: COLOR[c] }} />
            {COHORT_LABEL[c]}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`Skumulowany przepływ ${mode === 'net' ? 'netto' : 'agresora'} kohort w czasie`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const t = x.invert(e.clientX - r.left);
              let best = 0;
              ts.forEach((v, i) => (Math.abs(v - t) < Math.abs(ts[best] - t) ? (best = i) : null));
              setHover(best);
            }}
          >
            {y.ticks(4).map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono" fontSize={10}>
                  {usd(t)}
                </text>
              </g>
            ))}
            {series.map((s) => (
              <path key={s.c} d={path(s.pts)} fill="none" stroke={COLOR[s.c]} strokeWidth={2} strokeLinejoin="round" />
            ))}
            {direct &&
              labels.map((l) => (
                <text key={l.c} x={width - pad.r + 6} y={l.y} dy="0.32em" className="fill-ink-2" fontSize={10}>
                  {SHORT[l.c]} <tspan className="font-mono">{usd(l.v)}</tspan>
                </text>
              ))}
            {hourTicks(x.domain()[0], x.domain()[1]).map((t) => (
              <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={10}>
                {timeFmt.format(t)}
              </text>
            ))}
            {hi !== null && (
              <g>
                <line x1={x(ts[hi])} x2={x(ts[hi])} y1={pad.t} y2={H - pad.b} stroke="var(--color-ink-3)" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.c} cx={x(ts[hi])} cy={y(s.pts[hi].v)} r={4} fill={COLOR[s.c]} stroke="var(--color-surface-1)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hi !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-lg"
            style={{ left: Math.min(Math.max(0, x(ts[hi]) - 90), Math.max(0, width - 200)) }}
          >
            <div className="font-mono tabular-nums text-ink-1">do {timeFmt.format(ts[hi])}</div>
            {series.map((s) => (
              <div key={s.c} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR[s.c] }} />
                {COHORT_LABEL[s.c]}: <span className="font-mono tabular-nums">{usd(s.pts[hi].v)}</span>
                {s.pts[hi].hidden && <span className="text-ink-3">(kubełek ukryty)</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Znaczniki osi czasu co 6 h (pełne godziny lokalne), najwyżej 5 — czytelne zamiast „18:26”. */
function hourTicks(from: number, to: number): number[] {
  const step = (to - from > 12 * 3600_000 ? 6 : to - from > 3 * 3600_000 ? 2 : 1) * 3600_000;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  const out: number[] = [];
  for (let t = d.getTime(); t <= to; t += 3600_000) if (t >= from && new Date(t).getHours() % (step / 3600_000) === 0) out.push(t);
  return out.slice(0, 6);
}

/** Markouty poza próbą per kohorta — tabela (dostęp do liczb bez wykresu). */
const OosTable: React.FC<{ flow: CohortFlow }> = ({ flow }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left font-mono tabular-nums text-[11px]">
      <caption className="sr-only">Markout transakcji biorców według kohorty</caption>
      <thead className="text-ink-3">
        <tr>
          <th className="py-1 pr-3 font-medium font-sans">Kohorta</th>
          <th className="py-1 pr-3 font-medium">1 min</th>
          <th className="py-1 pr-3 font-medium">5 min</th>
          <th className="py-1 pr-3 font-medium">60 min</th>
          <th className="py-1 pr-3 font-medium">Transakcje</th>
          <th className="py-1 font-medium">Nominał</th>
        </tr>
      </thead>
      <tbody>
        {COHORTS.map((c) => {
          const m = flow.oos[c];
          return (
            <tr key={c} className="border-t border-line">
              <td className="py-1 pr-3 font-sans">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR[c] }} aria-hidden="true" />
                  {COHORT_LABEL[c]}
                </span>
              </td>
              <td className="py-1 pr-3">{bp(m.m1)}</td>
              <td className="py-1 pr-3">{bp(m.m5)}</td>
              <td className="py-1 pr-3">{bp(m.m60)}</td>
              <td className="py-1 pr-3">{m.n > 0 ? m.n.toLocaleString('pl-PL') : DASH}</td>
              <td className="py-1">{m.usd > 0 ? fmtCompact(m.usd, '$') : DASH}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
