import React, { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3';
import { useCohortFlow } from '../../state/useCohortFlow';
import { Badge, EmptyState, Panel, Segmented, Stat, DASH, fmtCompact, fmtSigned, fmtFixed } from '../../ui';
import { COHORTS, COHORT_LABEL, CohortFlow, CohortId, CohortTotal, cumulativeNet } from '../../utils/cohorts';
import { useElementWidth } from '../market/MarketMap';
import { locale, tr } from '../../i18n';

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
/** Krótkie nazwy do etykiet bezpośrednich na wykresie */
const SHORT: Record<CohortId, string> = { mm: 'MM', informed: tr('Poinf.', 'Inf.'), whale: tr('Wieloryby', 'Whales'), rest: tr('Reszta', 'Rest') };
const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const usd = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v), '$')}`;
const bp = (v: number | null) => (v === null ? DASH : fmtSigned(v, 1, ' bp'));
/** Liczności publikowane w dół do dziesiątek: 0 = mniej niż 10 */
const approx = (n: number) => (n < 10 ? '< 10' : `≈ ${n.toLocaleString(locale)}`);
const netTotal = (t: CohortTotal) => t.buy - t.sell;
const takerTotal = (t: CohortTotal) => t.takerBuy - t.takerSell;
type Mode = 'net' | 'taker';

/** Kto kupuje, kto sprzedaje: przepływ netto (zmiana zapasów) i agresywna delta per kohorta uczestników Hyperliquid. */
export const CohortFlowPanel: React.FC = () => {
  const { status, flow } = useCohortFlow();
  const [mode, setMode] = useState<Mode>('net');
  if (status === 'unconfigured') return null;

  const badge =
    status === 'ready' ? (
      <Badge
        tone="live"
        title={tr('Agregaty z publicznej taśmy Hyperliquid (adresy obu stron, strona agresora); bez adresów', 'Aggregates from the public Hyperliquid tape (both sides\' addresses, aggressor side); no addresses shown')}
      >
        LIVE
      </Badge>
    ) : status === 'stale' || status === 'expired' ? (
      <Badge tone="stale" title={tr('Skaner nie publikuje aktualnych danych — liczby ukryte', 'The scanner is not publishing current data, numbers hidden')}>
        STALE
      </Badge>
    ) : null;

  return (
    <Panel eyebrow={tr('Kto kupuje, kto sprzedaje · Hyperliquid', 'Who buys, who sells · Hyperliquid')} title={tr('Przepływ kohort', 'Cohort flow')} actions={badge}>
      {status !== 'ready' || !flow ? (
        <EmptyState
          title={
            status === 'loading'
              ? tr('Pobieram przepływ kohort…', 'Loading cohort flow…')
              : (status === 'stale' || status === 'expired') && flow
              ? tr(`Dane nieaktualne — ostatnia publikacja ${timeFmt.format(flow.asOf)}; liczby ukryte`, `Data out of date, last published ${timeFmt.format(flow.asOf)}; numbers hidden`)
              : tr('Przepływ kohort chwilowo niedostępny', 'Cohort flow temporarily unavailable')
          }
          detail={tr(
            'Każda transakcja na Hyperliquid ma publiczne adresy obu stron. Skaner przypisuje je do kohort (market makerzy, statystycznie poinformowani, wieloryby, reszta) i publikuje wyłącznie agregaty.',
            'Every Hyperliquid trade has public addresses on both sides. The scanner assigns them to cohorts (market makers, statistically informed, whales, rest) and publishes aggregates only.'
          )}
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
  const last = flow.buckets[flow.buckets.length - 1];
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          ariaLabel={tr('Rodzaj przepływu', 'Flow type')}
          options={[
            {
              value: 'net',
              label: tr('Netto (zapasy)', 'Net (inventory)'),
              title: tr('Kupno − sprzedaż wszystkich fillów kohorty; suma po kohortach = 0', 'Buys − sells across all cohort fills; sum over cohorts = 0'),
            },
            { value: 'taker', label: tr('Agresor (CVD)', 'Aggressor (CVD)'), title: tr('Kupno − sprzedaż kohorty jako biorcy płynności', 'Cohort buys − sells as liquidity taker') },
          ]}
        />
        <span className="text-[11px] text-ink-3">
          {tr(`ostatnia godzina = 4 zamknięte kubełki ${flow.bucketMin} min`, `last hour = 4 closed ${flow.bucketMin}-min buckets`)}
          {last ? ` (${tr('do', 'to')} ${timeFmt.format(last.t + flow.bucketMin * 60_000)})` : ''}
          {partial ? ` · ${tr('obserwacja od', 'observed since')} ${timeFmt.format(flow.since)}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3">
        {COHORTS.map((c) => {
          const t = flow.totals.h1[c];
          const active = t.buy + t.sell > 0;
          const v = mode === 'net' ? netTotal(t) : takerTotal(t);
          const other = mode === 'net' ? takerTotal(t) : netTotal(t);
          const hid = mode === 'net' ? t.hidden : t.hidden + t.takerHidden;
          return (
            <Stat
              key={c}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLOR[c] }} aria-hidden="true" />
                  {COHORT_LABEL[c]}
                </span>
              }
              value={<span className="font-mono tabular-nums">{active || hid ? usd(v) : DASH}</span>}
              hint={`${mode === 'net' ? tr('agresor', 'aggressor') : tr('netto', 'net')} ${active ? usd(other) : DASH} · ${tr('adresy 24 h', 'addresses 24 h')} ${approx(flow.members[c])}${
                hid ? ` · ${tr('ukryte kubełki', 'hidden buckets')} ${hid}` : ''
              }`}
            />
          );
        })}
      </div>

      <CumulativeChart flow={flow} mode={mode} />
      <TotalsTable flow={flow} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Markout transakcji biorców · poza próbą · 24 h', 'Taker trade markout · out of sample · 24 h')}</div>
          <Badge
            tone="model"
            title={tr(
              'Kohorta ustalona w chwili transakcji z danych wcześniejszych; markout = kierunek × zmiana ceny po h, ważony nominałem',
              'Cohort fixed at trade time from earlier data; markout = direction × price change after h, notional-weighted'
            )}
          >
            MODEL
          </Badge>
        </div>
        <OosTable flow={flow} />
        <p className="text-[11px] text-ink-3 leading-relaxed">
          {tr(
            `„Poinformowani”: adresy, których markout biorcy po 5 min jest istotnie dodatni. Obserwacją jest blok 5 min adresu, więc jedno zlecenie zamiatające wielu makerów liczy się raz. Test jednostronny obejmuje adresy z co najmniej ${inf.minN} blokami, z kontrolą odsetka fałszywych odkryć (Benjamini–Hochberg, q = ${Math.round(inf.fdrQ * 100)}%) i dodatnią średnią a posteriori w empirycznym Bayesie. Kandydaci ${approx(inf.candidates)}, wybrani ${approx(inf.selected)}`,
            `"Informed": addresses whose 5-min taker markout is significantly positive. The unit of observation is an address's 5-min block, so one order sweeping many makers counts once. The one-sided test covers addresses with at least ${inf.minN} blocks, with false discovery rate control (Benjamini–Hochberg, q = ${Math.round(inf.fdrQ * 100)}%) and a positive posterior mean under empirical Bayes. Candidates ${approx(inf.candidates)}, selected ${approx(inf.selected)}`
          )}
          {inf.mu0Bp !== null
            ? ` · ${tr('średnia populacji', 'population mean')} ${bp(inf.mu0Bp)}, ${tr('rozrzut umiejętności', 'skill dispersion')} ${inf.tauBp === null ? DASH : `${fmtFixed(inf.tauBp, 1)} bp`}`
            : ''}
          {inf.classifiedAt !== null
            ? ` · ${tr('klasyfikacja', 'classified')} ${timeFmt.format(inf.classifiedAt)}`
            : tr(' · klasyfikacja jeszcze nie wykonana', ' · classification not run yet')}
          .{' '}
          {tr(
            'Tabela pokazuje, czy przewaga utrzymuje się na transakcjach wykonanych po klasyfikacji. Jeśli nie, kohorta nie ma przewagi, niezależnie od nazwy.',
            'The table shows whether the edge holds on trades made after classification. If it does not, the cohort has no edge, whatever its name.'
          )}
        </p>
      </div>

      <details className="rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Metoda i prywatność', 'Method and privacy')}</summary>
        <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
          <li>
            {tr(
              'Każda transakcja z publicznej taśmy BTC ma adresy kupującego i sprzedającego oraz stronę agresora. Netto kohorty = kupno − sprzedaż wszystkich jej fillów, czyli zmiana jej zapasów. Co jedna kohorta kupuje, inna sprzedaje, więc netto sumuje się do zera.',
              'Every trade on the public BTC tape carries the buyer and seller addresses and the aggressor side. Cohort net = buys − sells across all its fills, i.e. the change in its inventory. What one cohort buys another sells, so net sums to zero.'
            )}
          </li>
          <li>
            {tr(
              'Market makerzy: ≥ 80% nominału jako maker i ≥ 1 mln USD (z wygaszaniem, połowa po 7 dniach). Wieloryby: pozycja BTC ≥ 1 mln USD albo konto z publicznego rankingu ≥ 10 mln USD. Kohorty są rozłączne w tej kolejności: market makerzy, poinformowani, wieloryby, reszta.',
              'Market makers: ≥ 80% of notional as maker and ≥ USD 1M (decaying, half-life 7 days). Whales: BTC position ≥ USD 1M or a public leaderboard account ≥ USD 10M. Cohorts are disjoint in this order: market makers, informed, whales, rest.'
            )}
          </li>
          <li>
            {tr(
              `Prywatność: adresy i przynależność zostają na serwerze. Publikowane są tylko zamknięte kubełki. Komórka z mniej niż ${flow.kMin} uczestnikami albo z jednym powyżej 50% obrotu jest ukrywana. Wtedy ukrywana jest też kolejna, bo suma kohort to publiczny wolumen i jedną ukrytą dałoby się odtworzyć odejmowaniem. Warstwa agresora ma osobne ukrywanie. Kwoty są zaokrąglone do 10 tys. USD, liczności do dziesiątek. Markouty pochodzą tylko z w pełni rozliczonych godzin (ta sama reguła ukrywania) i są publikowane bez liczności i nominału.`,
              `Privacy: addresses and membership stay on the server. Only closed buckets are published. A cell with fewer than ${flow.kMin} participants, or with one above 50% of volume, is hidden. A second cell is then hidden too, because the cohort sum is public volume and a single hidden cell could be recovered by subtraction. The aggressor layer has its own suppression. Amounts are rounded to USD 10k, counts to tens. Markouts come only from fully settled hours (same suppression rule) and are published without counts or notional.`
            )}
          </li>
          <li>
            {tr(
              'To opis przepływu, nie sygnał. „Poinformowani” to wynik statystyczny z przeszłości, bez gwarancji na przyszłość.',
              'This describes flow, it is not a signal. "Informed" is a statistical result from the past, with no guarantee for the future.'
            )}
          </li>
        </ul>
      </details>
    </div>
  );
};

/** Skumulowany przepływ per kohorta (24 h): jedna oś USD, linia zera, etykiety bezpośrednie, krzyżyk z wartościami, znaczniki ukrytych kubełków. */
const CumulativeChart: React.FC<{ flow: CohortFlow; mode: Mode }> = ({ flow, mode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const direct = width >= 480;
  const pad = { l: 56, r: direct ? 124 : 10, t: 10, b: 24 };
  const series = useMemo(() => COHORTS.map((c) => ({ c, pts: cumulativeNet(flow, c, mode === 'taker') })), [flow, mode]);
  const stepMs = flow.bucketMin * 60_000;
  const ts = flow.buckets.map((b) => b.t + stepMs);
  const ext = Math.max(0, ...series.flatMap((s) => s.pts.map((p) => Math.abs(p.v))));
  if (ts.length === 0 || ext === 0) {
    return (
      <div ref={ref} className="text-xs text-ink-3">
        {ts.length === 0
          ? tr('Brak zamkniętych kubełków w okresie obserwacji — pierwszy pojawi się po 15 min.', 'No closed buckets in the observation window yet, the first appears after 15 min.')
          : tr('Wszystkie kubełki w oknie są ukryte (k-anonimowość) albo zerowe.', 'All buckets in the window are hidden (k-anonymity) or zero.')}
      </div>
    );
  }
  const x = scaleLinear()
    .domain([Math.min(...ts) - stepMs, Math.max(...ts)])
    .range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const y = scaleLinear().domain([-ext, ext]).range([H - pad.b, pad.t]).nice();
  const path = (pts: { v: number }[]) => [`M${x(ts[0] - stepMs).toFixed(1)},${y(0).toFixed(1)}`, ...pts.map((p, i) => `L${x(ts[i]).toFixed(1)},${y(p.v).toFixed(1)}`)].join('');
  // Etykiety bezpośrednie: rozsunięcie w dół (min. 12 px), potem w górę, jeśli wyszły poza wykres
  const labels = series.map((s) => ({ c: s.c, y: y(s.pts[s.pts.length - 1].v), v: s.pts[s.pts.length - 1].v })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
  const bottom = H - pad.b - 4;
  if (labels.length && labels[labels.length - 1].y > bottom) {
    labels[labels.length - 1].y = bottom;
    for (let i = labels.length - 2; i >= 0; i--) if (labels[i + 1].y - labels[i].y < 12) labels[i].y = labels[i + 1].y - 12;
  }
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
        <span className="flex items-center gap-1.5 text-ink-3">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" />
          </svg>
          {tr('kubełek ukryty', 'hidden bucket')}
        </span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={tr(
              `Skumulowany przepływ ${mode === 'net' ? 'netto' : 'agresora'} kohort w czasie; liczby w tabeli poniżej`,
              `Cumulative ${mode === 'net' ? 'net' : 'aggressor'} cohort flow over time; numbers in the table below`
            )}
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
              <g key={s.c}>
                <path d={path(s.pts)} fill="none" stroke={COLOR[s.c]} strokeWidth={2} strokeLinejoin="round" />
                {s.pts.map((p, i) =>
                  p.hidden ? <circle key={i} cx={x(ts[i])} cy={y(p.v)} r={3} fill="var(--color-surface-1)" stroke={COLOR[s.c]} strokeWidth={1.5} /> : null
                )}
              </g>
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
            style={{ left: Math.min(Math.max(0, x(ts[hi]) - 90), Math.max(0, width - 210)) }}
          >
            <div className="font-mono tabular-nums text-ink-1">
              {timeFmt.format(ts[hi] - stepMs)}–{timeFmt.format(ts[hi])}
            </div>
            {series.map((s) => (
              <div key={s.c} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR[s.c] }} />
                {COHORT_LABEL[s.c]}: <span className="font-mono tabular-nums">{usd(s.pts[hi].v)}</span>
                {s.pts[hi].hidden && <span className="text-ink-3">({tr('kubełek ukryty', 'hidden bucket')})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Sumy 24 h per kohorta — liczby bez wykresu (także na telefonie i dla czytników ekranu). */
const TotalsTable: React.FC<{ flow: CohortFlow }> = ({ flow }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left font-mono tabular-nums text-[11px]">
      <caption className="sr-only">{tr('Przepływ kohort w 24 godzinach', 'Cohort flow over 24 hours')}</caption>
      <thead className="text-ink-3">
        <tr>
          <th className="py-1 pr-3 font-medium font-sans">{tr('Kohorta · 24 h', 'Cohort · 24 h')}</th>
          <th className="py-1 pr-3 font-medium">{tr('Netto', 'Net')}</th>
          <th className="py-1 pr-3 font-medium">{tr('Agresor', 'Aggressor')}</th>
          <th className="py-1 pr-3 font-medium">{tr('Obrót', 'Volume')}</th>
          <th className="py-1 font-medium">{tr('Ukryte', 'Hidden')}</th>
        </tr>
      </thead>
      <tbody>
        {COHORTS.map((c) => {
          const t = flow.totals.h24[c];
          return (
            <tr key={c} className="border-t border-line">
              <td className="py-1 pr-3 font-sans">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR[c] }} aria-hidden="true" />
                  {COHORT_LABEL[c]}
                </span>
              </td>
              <td className="py-1 pr-3">{usd(netTotal(t))}</td>
              <td className="py-1 pr-3">{usd(takerTotal(t))}</td>
              <td className="py-1 pr-3">{fmtCompact(t.buy + t.sell, '$')}</td>
              <td className="py-1">{t.hidden || t.takerHidden ? `${t.hidden} / ${t.takerHidden} ${tr('agr.', 'aggr.')}` : DASH}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/** Znaczniki osi czasu w pełnych godzinach lokalnych (co 6/2/1 h wg rozpiętości), najwyżej 6. */
function hourTicks(from: number, to: number): number[] {
  const stepH = to - from > 12 * 3600_000 ? 6 : to - from > 3 * 3600_000 ? 2 : 1;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  const out: number[] = [];
  for (let t = d.getTime(); t <= to; t += 3600_000) if (t >= from && new Date(t).getHours() % stepH === 0) out.push(t);
  return out.slice(0, 6);
}

/** Markouty poza próbą per kohorta — tabela. */
const OosTable: React.FC<{ flow: CohortFlow }> = ({ flow }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left font-mono tabular-nums text-[11px]">
      <caption className="sr-only">{tr('Markout transakcji biorców według kohorty', 'Taker trade markout by cohort')}</caption>
      <thead className="text-ink-3">
        <tr>
          <th className="py-1 pr-3 font-medium font-sans">{tr('Kohorta', 'Cohort')}</th>
          <th className="py-1 pr-3 font-medium">1 min</th>
          <th className="py-1 pr-3 font-medium">5 min</th>
          <th className="py-1 pr-3 font-medium">60 min</th>
          <th className="py-1 font-medium">{tr('Godziny', 'Hours')}</th>
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
              <td
                className="py-1"
                title={tr('Godziny włączone / pominięte (< 5 biorców, dominacja lub ukrywanie wtórne)', 'Hours included / skipped (< 5 takers, dominance or secondary suppression)')}
              >
                {m.hours || m.hiddenHours ? `${m.hours}${m.hiddenHours ? ` (+${m.hiddenHours} ${tr('ukr.', 'hid.')})` : ''}` : DASH}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
