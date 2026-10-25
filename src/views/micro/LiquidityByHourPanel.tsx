import React, { useMemo, useRef, useState } from 'react';
import { useLiquidityProfile } from '../../state/useLiquidityProfile';
import { Badge, EmptyState, Panel, Segmented, Stat, DASH, fmtCompact, fmtFixed } from '../../ui';
import { costByHour, nowCost } from '../../utils/execCost';
import type { LiquidityProfile } from '../../utils/liquidity';
import { DEFAULT_TAKER_FEE } from '../../utils/planAnalyzer';
import { useElementWidth } from '../market/MarketMap';
import { locale, tr } from '../../i18n';

const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hmFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const minFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const daysWord = (n: number) => (n === 1 ? tr('dnia', 'day') : tr('dni', 'days'));
/** Godzina liczona od 30 minut danych — mniej to pojedyncza sesja, nie norma */
const MIN_HOUR_N = 30;

/**
 * Płynność arkusza w czasie (rejestrator skanera): mediana głębokości obu stron w ±10 bp wg godziny UTC, bieżąca minuta
 * względem normy jej godziny i odporność po gwałtownych ruchach. Historia arkusza, której publiczne API nie udostępnia.
 */
export const LiquidityByHourPanel: React.FC = () => {
  const { status, profile } = useLiquidityProfile();
  if (status === 'unconfigured') return null;
  return (
    <Panel
      eyebrow={tr(
        `Rejestrator arkusza HyperQuant${profile?.since ? ` · historia od ${dayFmt.format(profile.since)}` : ''} · godziny UTC`,
        `HyperQuant book recorder${profile?.since ? ` · history since ${dayFmt.format(profile.since)}` : ''} · UTC hours`
      )}
      title={tr('Płynność arkusza w ciągu doby', 'Book liquidity through the day')}
      actions={
        status === 'ready' ? (
          <Badge tone="live" title={tr('Migawki arkusza Hyperliquid (co ~5 s) zapisywane przez skaner; publikowane tylko agregaty', 'Hyperliquid book snapshots (every ~5 s) recorded by the scanner; only aggregates are published')}>
            LIVE
          </Badge>
        ) : status === 'stale' ? (
          <Badge tone="stale" title={tr('Profil nie był aktualizowany od ponad 30 min', 'The profile has not been updated for more than 30 min')}>
            STALE
          </Badge>
        ) : null
      }
    >
      {!profile ? (
        <EmptyState
          title={status === 'loading' ? tr('Pobieram profil płynności…', 'Loading the liquidity profile…') : tr('Profil płynności chwilowo niedostępny', 'Liquidity profile temporarily unavailable')}
          detail={tr(
            'Skaner zapisuje głębokość arkusza co ~5 s i publikuje medianę wg godziny doby — widać, kiedy płynność przy cenie jest najcieńsza.',
            'The scanner records book depth every ~5 s and publishes the median by hour of day, showing when liquidity near price is thinnest.'
          )}
        />
      ) : (
        <Body p={profile} />
      )}
    </Panel>
  );
};

const Body: React.FC<{ p: LiquidityProfile }> = ({ p }) => {
  const valid = p.byHour.filter((b) => b.d10 !== null && b.n >= MIN_HOUR_N);
  const r = p.resilience;
  const thinnest = valid.length ? valid.reduce((a, b) => ((b.d10 as number) < (a.d10 as number) ? b : a)) : null;
  const deepest = valid.length ? valid.reduce((a, b) => ((b.d10 as number) > (a.d10 as number) ? b : a)) : null;
  const nowHour = p.now ? new Date(p.now.t).getUTCHours() : null;
  const usd = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : fmtCompact(v, '$'));
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-ink-2 leading-relaxed">
        {tr(
          `Mediana dolarów w zleceniach po obu stronach w odległości ±10 bp od środka, dla każdej godziny doby UTC, z ${p.days} ${daysWord(p.days)} historii (${p.minutes.toLocaleString(locale)} minut). Cienka płynność = większy poślizg i łatwiejsze przesunięcie ceny.`,
          `Median dollars in orders on both sides within ±10 bp of the mid, for every UTC hour of the day, from ${p.days} ${daysWord(p.days)} of history (${p.minutes.toLocaleString(locale)} minutes). Thin liquidity = more slippage and an easier price push.`
        )}
      </p>
      <HourBars p={p} nowHour={nowHour} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label={p.now ? `${tr('Teraz', 'Now')} ±10 bp · ${hmFmt.format(p.now.t)} UTC` : `${tr('Teraz', 'Now')} ±10 bp`}
          value={<span className="font-mono tabular-nums text-base">{usd(p.now?.d10)}</span>}
          hint={
            !p.now
              ? tr('rejestrator nie zapisał świeżej minuty', 'the recorder has no fresh minute')
              : p.now.ratio10 !== null
              ? tr(`${Math.round(p.now.ratio10 * 100)}% normy tej godziny (inne dni)`, `${Math.round(p.now.ratio10 * 100)}% of this hour's norm (other days)`)
              : tr('norma od 3 dni historii tej godziny', 'norm from 3 days of history for this hour')
          }
        />
        <Stat
          label={tr('Najcieńsza godzina', 'Thinnest hour')}
          value={<span className="font-mono tabular-nums text-base">{thinnest ? `${hh(thinnest.h)} UTC` : DASH}</span>}
          hint={
            thinnest
              ? tr(
                  `${usd(thinnest.d10)} · najgłębsza ${deepest ? hh(deepest.h) : DASH} · z ${thinnest.days} ${daysWord(thinnest.days)}`,
                  `${usd(thinnest.d10)} · deepest ${deepest ? hh(deepest.h) : DASH} · from ${thinnest.days} ${daysWord(thinnest.days)}`
                )
              : tr(`od ${MIN_HOUR_N} min danych na godzinę`, `from ${MIN_HOUR_N} min of data per hour`)
          }
        />
        <Stat label={`${tr('Teraz', 'Now')} ±20 bp`} value={<span className="font-mono tabular-nums text-base">{usd(p.now?.d20)}</span>} hint={tr('obie strony', 'both sides')} />
        <Stat
          label={tr('Odporność', 'Resilience')}
          value={<span className="font-mono tabular-nums text-base">{r.medianMin === null ? DASH : `${minFmt.format(r.medianMin)} min`}</span>}
          hint={
            r.events
              ? tr(
                  `mediana powrotu głębokości po ruchu ≥ 15 bp z wycofaniem płynności (${r.events}${r.unrecovered ? `, bez powrotu w 1 h: ${r.unrecovered}` : ''}; bez wycofania: ${r.noDrop})`,
                  `median depth recovery after a ≥ 15 bp move with liquidity pulled (${r.events}${r.unrecovered ? `, not recovered within 1 h: ${r.unrecovered}` : ''}; without pulling: ${r.noDrop})`
                )
              : r.noDrop
              ? tr(`${r.noDrop} ruchów ≥ 15 bp bez wycofania płynności`, `${r.noDrop} moves ≥ 15 bp without liquidity pulled`)
              : tr('brak ruchów ≥ 15 bp w historii', 'no moves ≥ 15 bp in the history')
          }
        />
      </div>
      <ExecCost p={p} nowHour={nowHour} />
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {tr(
          `Metoda: migawki arkusza Hyperliquid co ~5 s, zagregowane w koszyki dobierane do ceny tak, by 20 poziomów pokrywało ±20 bp (~10–20 USD), koszyk na granicy pasma liczony proporcjonalnie; minutowe mediany. Godzina z mniej niż ${MIN_HOUR_N} min danych jest wyszarzona; norma „teraz” — z co najmniej 3 innych dni tej godziny. Odporność: po minucie, w której środek ruszył się o ≥ 15 bp, liczba minut (ciągłych) do powrotu głębokości ±10 bp do 80% mediany z poprzedniej godziny; przerwy w danych pomijane${r.censored ? ` (${r.censored})` : ''}. Arkusz pokazuje zlecenia widoczne — ukryte i szybko anulowane nie są tu widoczne. Opis, nie prognoza.`,
          `Method: Hyperliquid book snapshots every ~5 s, aggregated into buckets sized to price so that 20 levels cover ±20 bp (~10–20 USD), with the bucket on the band edge counted proportionally; minute medians. An hour with less than ${MIN_HOUR_N} min of data is greyed out; the "now" norm comes from at least 3 other days of that hour. Resilience: after a minute in which the mid moved ≥ 15 bp, the number of (consecutive) minutes until ±10 bp depth returns to 80% of the previous hour's median; data gaps skipped${r.censored ? ` (${r.censored})` : ''}. The book shows visible orders; hidden and quickly cancelled ones are not visible here. A description, not a forecast.`
        )}
      </p>
    </div>
  );
};

const SIZES = [250_000, 1_000_000, 5_000_000, 25_000_000] as const;
const bp = (v: number | null) => (v === null ? DASH : `${fmtFixed(v, v < 1 ? 2 : 1)} bp`);

/**
 * Koszt wykonania zlecenia rynkowego wybranej wielkości wg godziny UTC: poślizg z krzywej głębokości strony arkusza
 * (liniowo do ±20 bp, dalej prawo pierwiastka kwadratowego) + opłata takera; typowo (mediana) i w warunkach cienkich
 * (25. percentyl głębokości), teraz z bieżącej minuty rejestratora.
 */
const ExecCost: React.FC<{ p: LiquidityProfile; nowHour: number | null }> = ({ p, nowHour }) => {
  const [size, setSize] = useState<number>(1_000_000);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const fee = DEFAULT_TAKER_FEE;
  const { typ, thin, now, best, worst, hasSides } = useMemo(() => {
    const valid = p.byHour.map((b) => (b.n >= MIN_HOUR_N ? b : { ...b, d10: null, d20: null, b10: null, a10: null, b20: null, a20: null, thin10: null }));
    const t = costByHour(valid, size, side, fee);
    return {
      typ: t.hours,
      thin: costByHour(valid, size, side, fee, { thin: true }).hours,
      now: nowCost(p.now, nowHour === null ? undefined : p.byHour[nowHour], size, side, fee),
      best: t.best,
      worst: t.worst,
      hasSides: p.byHour.some((b) => b.b10 != null),
    };
  }, [p, size, side, nowHour, fee]);
  const typNow = nowHour === null ? null : typ[nowHour]?.slipBp ?? null;
  const fmtH = (hs: number[]) => (hs.length ? hs.map((h) => `${hh(h)} (${bp(typ[h].slipBp)})`).join(', ') : DASH);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-3" aria-label={tr('Koszt wykonania wg godziny', 'Execution cost by hour')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Koszt wykonania zlecenia rynkowego', 'Market order execution cost')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel={tr('Strona zlecenia', 'Order side')}
            value={side}
            onChange={setSide}
            options={[
              { value: 'buy', label: tr('Kupno', 'Buy'), title: tr('Zjada aski', 'Eats the asks') },
              { value: 'sell', label: tr('Sprzedaż', 'Sell'), title: tr('Zjada bidy', 'Eats the bids') },
            ]}
          />
          <Segmented ariaLabel={tr('Wielkość zlecenia', 'Order size')} value={size} onChange={setSize} options={SIZES.map((s) => ({ value: s, label: fmtCompact(s, '$') }))} />
        </div>
      </div>
      <CostBars typ={typ} thin={thin} nowHour={nowHour} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-ink-3">
            {tr('Poślizg teraz', 'Slippage now')}
            {p.now ? ` · ${hmFmt.format(p.now.t)} UTC` : ''}
          </div>
          <div className="font-mono tabular-nums text-ink-1 text-base">{bp(now?.slipBp ?? null)}</div>
          <div className="text-ink-3">
            {tr(`typowo o tej godzinie ${bp(typNow)}; z opłatą takera razem ${bp(now?.totalBp ?? null)}`, `typical at this hour ${bp(typNow)}; with the taker fee ${bp(now?.totalBp ?? null)} in total`)}
          </div>
        </div>
        <div>
          <div className="text-ink-3">{tr('Najmniejszy poślizg (typowo)', 'Lowest slippage (typical)')}</div>
          <div className="font-mono tabular-nums text-ink-1">{fmtH(best)}</div>
        </div>
        <div>
          <div className="text-ink-3">{tr('Największy poślizg (typowo)', 'Highest slippage (typical)')}</div>
          <div className="font-mono tabular-nums text-ink-1">{fmtH(worst)}</div>
        </div>
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {tr(
          `Średni poślizg od środka ceny przy natychmiastowym zjedzeniu arkusza: głębokość strony rośnie liniowo do ±10 i ±20 bp (mediany rejestratora${hasSides ? ', osobno bidy i aski' : ', połowa sumy obu stron'}), dalej zgodnie z prawem pierwiastka kwadratowego wpływu ceny (Tóth i in. 2011; Bouchaud i in. 2018) skalibrowanym na ±20 bp. Do tego opłata takera Hyperliquid (poziom bazowy ${fmtFixed(fee * 100, 3)}%). Jaśniejszy słupek: warunki cienkie (25. percentyl głębokości tej godziny). Słupki pokazują sam poślizg — opłata jest stała. Widoczne zlecenia — bez ukrytych; duże zlecenie przesuwa arkusz i cenę bardziej, niż pokazuje statyczna krzywa. Szacunek kosztu, nie rekomendacja pory transakcji.`,
          `Average slippage from the mid when eating the book at once: side depth grows linearly to ±10 and ±20 bp (recorder medians${hasSides ? ', bids and asks separately' : ', half the sum of both sides'}), and beyond that per the square-root law of price impact (Tóth et al. 2011; Bouchaud et al. 2018) calibrated at ±20 bp. Plus the Hyperliquid taker fee (base tier ${fmtFixed(fee * 100, 3)}%). Lighter bar: thin conditions (25th percentile of depth for that hour). The bars show slippage alone; the fee is constant. Visible orders only, no hidden ones; a large order moves the book and price more than the static curve shows. A cost estimate, not a recommendation on when to trade.`
        )}
      </p>
    </section>
  );
};

/** Słupki kosztu wg godziny: typowo (pełny) i warunki cienkie (jaśniejszy, wyższy); bieżąca godzina wyróżniona. */
const CostBars: React.FC<{ typ: { h: number; slipBp: number | null; totalBp: number | null }[]; thin: { h: number; slipBp: number | null }[]; nowHour: number | null }> = ({
  typ,
  thin,
  nowHour,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 110;
  const pad = { l: 44, r: 6, t: 8, b: 18 };
  const max = Math.max(0.1, ...typ.map((x) => x.slipBp ?? 0), ...thin.map((x) => x.slipBp ?? 0));
  const bw = Math.max(1, width - pad.l - pad.r) / 24;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const h = hover !== null ? hover : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={tr('Poślizg zlecenia rynkowego (bp) w każdej godzinie doby UTC: typowo i w warunkach cienkich', 'Market order slippage (bp) in every UTC hour of the day: typical and in thin conditions')}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-line)" />
              <text x={pad.l - 4} y={y(max * f) + 3} textAnchor="end" className="fill-ink-3 font-mono" fontSize={9}>
                {fmtFixed(max * f, max < 1 ? 2 : 1)} bp
              </text>
            </g>
          ))}
          {typ.map((t) => {
            const x = pad.l + t.h * bw + 1;
            const w = Math.max(1, bw - 2);
            const th = thin[t.h]?.slipBp ?? null;
            const isNow = t.h === nowHour;
            return (
              <g key={t.h} onMouseEnter={() => setHover(t.h)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + t.h * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {th !== null && <rect x={x} y={y(th)} width={w} height={Math.max(0, H - pad.b - y(th))} rx={Math.min(4, bw / 4)} fill={isNow ? 'var(--color-accent)' : 'var(--color-ink-3)'} opacity={0.22} />}
                {t.slipBp !== null && (
                  <rect
                    x={x}
                    y={y(t.slipBp)}
                    width={w}
                    height={Math.max(0, H - pad.b - y(t.slipBp))}
                    rx={Math.min(4, bw / 4)}
                    fill={isNow ? 'var(--color-accent)' : 'var(--color-ink-3)'}
                    opacity={hover === null || hover === t.h ? 0.85 : 0.5}
                  />
                )}
                {t.h % 3 === 0 && (
                  <text x={x + bw / 2} y={H - 5} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={9}>
                    {String(t.h).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {h !== null && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[11px] text-ink-2 shadow-lg">
          {tr(
            `${hh(h)} UTC · poślizg typowo ${bp(typ[h]?.slipBp ?? null)} · cienko ${bp(thin[h]?.slipBp ?? null)} · z opłatą ${bp(typ[h]?.totalBp ?? null)}`,
            `${hh(h)} UTC · slippage typical ${bp(typ[h]?.slipBp ?? null)} · thin ${bp(thin[h]?.slipBp ?? null)} · with fee ${bp(typ[h]?.totalBp ?? null)}`
          )}
        </div>
      )}
    </div>
  );
};

/** Słupki 24 godzin UTC (jedna seria — bez legendy), bieżąca godzina wyróżniona, podpowiedź po najechaniu. */
const HourBars: React.FC<{ p: LiquidityProfile; nowHour: number | null }> = ({ p, nowHour }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const H = 140;
  const pad = { l: 44, r: 6, t: 8, b: 18 };
  const max = Math.max(1, ...p.byHour.map((b) => b.d10 ?? 0));
  const innerW = Math.max(1, width - pad.l - pad.r);
  const bw = innerW / 24;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const hb = hover !== null ? p.byHour[hover] : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={tr('Mediana głębokości arkusza ±10 bp w każdej godzinie doby UTC', 'Median ±10 bp book depth in every UTC hour of the day')}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-line)" />
              <text x={pad.l - 4} y={y(max * f) + 3} textAnchor="end" className="fill-ink-3 font-mono" fontSize={9}>
                {fmtCompact(max * f, '$')}
              </text>
            </g>
          ))}
          {p.byHour.map((b) => {
            const v = b.d10 ?? 0;
            const x = pad.l + b.h * bw + 1;
            const thin = b.n < MIN_HOUR_N;
            const isNow = b.h === nowHour;
            return (
              <g key={b.h} onMouseEnter={() => setHover(b.h)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + b.h * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {b.d10 !== null && (
                  <rect
                    x={x}
                    y={y(v)}
                    width={Math.max(1, bw - 2)}
                    height={Math.max(0, H - pad.b - y(v))}
                    rx={Math.min(4, bw / 4)}
                    fill={isNow ? 'var(--color-accent)' : 'var(--color-ink-3)'}
                    opacity={thin ? 0.3 : hover === null || hover === b.h ? 0.85 : 0.5}
                  />
                )}
                {b.h % 3 === 0 && (
                  <text x={x + bw / 2} y={H - 5} textAnchor="middle" className="fill-ink-3 font-mono" fontSize={9}>
                    {String(b.h).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}
          {p.now && nowHour !== null && (
            <g>
              <line
                x1={pad.l + nowHour * bw}
                x2={pad.l + (nowHour + 1) * bw}
                y1={y(Math.min(max, p.now.d10))}
                y2={y(Math.min(max, p.now.d10))}
                stroke="var(--color-level)"
                strokeWidth={2}
              />
              {p.now.d10 > max && (
                <text x={pad.l + (nowHour + 0.5) * bw} y={pad.t + 2} textAnchor="middle" className="fill-ink-1" fontSize={9}>
                  ▲
                </text>
              )}
            </g>
          )}
        </svg>
      )}
      {hb && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[11px] text-ink-2 shadow-lg">
          {hh(hb.h)} UTC · ±10 bp {hb.d10 === null ? DASH : fmtCompact(hb.d10, '$')} · ±20 bp {hb.d20 === null ? DASH : fmtCompact(hb.d20, '$')} · {hb.n}{' '}
          {tr('min z', 'min from')} {hb.days} {daysWord(hb.days)}
        </div>
      )}
    </div>
  );
};
