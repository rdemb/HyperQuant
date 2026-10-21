import React, { useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { scaleLinear } from 'd3';
import { useDesk } from '../../state/DeskContext';
import { freshness, PERIOD_MS, useCrossMarket } from '../../state/useCrossMarket';
import { FUNDING_VENUES, FundingVenue, VENUE_LABEL, VenueFunding } from '../../utils/hlMarkets';
import { Badge, EmptyState, Panel, SPRING, fmtCountdown, fmtPct, fmtSigned, DASH } from '../../ui';
import { useElementWidth } from './MarketMap';

const ROW_H = 40;
const BAR_H = 20;
/** Szacunkowa szerokość znaku etykiety (12 px, IBM Plex Mono) — do decyzji, gdzie zmieści się wartość. */
const CHAR_W = 7.3;

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });

function venueText(v: VenueFunding, now: number): string {
  const next = v.nextFundingTime !== null ? `${timeFmt.format(v.nextFundingTime)} (${fmtCountdown(v.nextFundingTime, now)})` : DASH;
  return `${VENUE_LABEL[v.venue]}: ${fmtPct(v.aprPct, 2)} APR, stawka ${fmtSigned(v.rate * 100, 4, '%')} co ${v.intervalH} h, następna płatność ${next}`;
}

function crowdText(z: number): string {
  const a = Math.abs(z);
  const side = z > 0 ? 'longów' : 'shortów';
  if (a < 1) return 'Funding HL w typowym zakresie tygodnia.';
  if (a < 2) return `Podwyższony tłok ${side} względem ostatnich 7 dni.`;
  return `Skrajny tłok ${side} — historycznie rośnie ryzyko gwałtownego zamykania pozycji.`;
}

/** Funding BTC między giełdami (HL, Binance, Bybit) znormalizowany do APR — słupki na wspólnej osi z zerem pośrodku. */
export const FundingVenues: React.FC = () => {
  const { feed } = useDesk();
  const cm = useCrossMarket(['funding']);
  const reduce = useReducedMotion();
  // Mierzymy zawsze obecny kontener (wykres pojawia się dopiero po danych)
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyW = useElementWidth(bodyRef);
  const wide = bodyW >= 520;
  const labelCol = wide ? 168 : 112;
  const plotW = Math.max(0, bodyW - labelCol);
  const [hover, setHover] = useState<FundingVenue | null>(null);
  const now = feed.nowTick;
  const f = cm.funding;
  const fr = freshness(cm.fundingAt, PERIOD_MS.funding, now);

  const scale = useMemo(() => {
    const vals = f ? FUNDING_VENUES.map((v) => f.byVenue[v]?.aprPct).filter((x): x is number => x !== undefined) : [];
    const maxAbs = Math.max(0, ...vals.map(Math.abs));
    // Symetryczna domena; minimum ±5% APR, by drobne stawki nie wypełniały osi
    let m = Math.max(5, maxAbs * 1.15);
    // Zapas na etykietę na końcu najdłuższego słupka: (połowa osi) · (1 − max/m) ≥ szerokość etykiety
    const half = plotW / 2;
    if (half > 0 && vals.length) {
      const labelW = Math.max(...vals.map((v) => fmtPct(v, 2).length)) * CHAR_W + 10;
      m = Math.max(m, maxAbs / (1 - Math.min(0.7, labelW / half)));
    }
    return scaleLinear().domain([-m, m]).nice(4);
  }, [f, plotW]);
  const ticks = scale.ticks(4);
  const [d0, d1] = scale.domain();
  const xPx = (v: number) => ((v - d0) / (d1 - d0)) * plotW;
  const zeroPx = xPx(0);

  return (
    <Panel
      title="Funding między giełdami"
      eyebrow="BTC-PERP · stawka znormalizowana do APR"
      actions={
        <Badge
          tone={fr === 'live' ? 'live' : 'stale'}
          title="predictedFundings z publicznego API Hyperliquid, odświeżane co 60 s; dane Binance/Bybit pośrednio przez API Hyperliquid"
        >
          {fr === 'live' ? 'LIVE' : fr === 'stale' ? 'STALE' : 'BRAK'}
        </Badge>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <p className="text-xs text-ink-2 leading-relaxed">
        Dodatni funding = longi płacą shortom (tłok po stronie long); ujemny — shorty płacą longom.
      </p>

      <div ref={bodyRef}>
      {!f ? (
        <EmptyState title="Czekam na prognozę fundingu" detail="predictedFundings z publicznego API Hyperliquid — pojawi się po pierwszej odpowiedzi." className="px-0 py-2" />
      ) : (
        <div>
          <div className="grid" style={{ gridTemplateColumns: `${labelCol}px minmax(0,1fr)` }}>
            {FUNDING_VENUES.map((venue) => {
              const v = f.byVenue[venue];
              return (
                <React.Fragment key={venue}>
                  <div className="flex flex-col justify-center pr-2 min-w-0" style={{ height: ROW_H }}>
                    <span className="text-[13px] font-medium text-ink-1 truncate">{VENUE_LABEL[venue]}</span>
                    <span className="text-[11px] text-ink-3 truncate">
                      {v
                        ? `${wide ? `co ${v.intervalH} h · ` : ''}${v.nextFundingTime !== null ? fmtCountdown(v.nextFundingTime, now) : DASH}`
                        : 'n/a'}
                    </span>
                  </div>
                  <div
                    className="relative min-w-0 rounded-sm"
                    style={{ height: ROW_H }}
                    tabIndex={v ? 0 : -1}
                    aria-label={v ? venueText(v, now) : `${VENUE_LABEL[venue]}: brak danych`}
                    onPointerEnter={() => setHover(venue)}
                    onPointerLeave={() => setHover((h) => (h === venue ? null : h))}
                    onFocus={() => setHover(venue)}
                    onBlur={() => setHover((h) => (h === venue ? null : h))}
                  >
                    {/* Siatka: ciągłe linie hairline, mocniejsza w zerze */}
                    {plotW > 0 &&
                      ticks.map((t) => (
                        <span
                          key={t}
                          aria-hidden="true"
                          className={`absolute inset-y-0 w-px ${t === 0 ? 'bg-line-strong' : 'bg-line'}`}
                          style={{ left: xPx(t) }}
                        />
                      ))}
                    {plotW > 0 && v ? (
                      <VenueBar v={v} xPx={xPx} zeroPx={zeroPx} plotW={plotW} reduce={!!reduce} highlighted={hover === venue} />
                    ) : (
                      plotW > 0 && (
                        <span className="absolute top-1/2 -translate-y-1/2 text-[11px] text-ink-3" style={{ left: zeroPx + 6 }}>
                          n/a
                        </span>
                      )
                    )}
                    {hover === venue && v && plotW > 0 && <VenueTooltip v={v} now={now} left={Math.min(Math.max(xPx(v.aprPct), 120), plotW - 120)} />}
                  </div>
                </React.Fragment>
              );
            })}
            {/* Oś X: wartości APR pod siatką */}
            <div />
            <div className="relative h-5 font-mono tabular-nums text-[10px] text-ink-3" aria-hidden="true">
              {plotW > 0 &&
                ticks.map((t) => (
                  <span key={t} className="absolute top-1 -translate-x-1/2 whitespace-nowrap" style={{ left: xPx(t) }}>
                    {t === 0 ? '0' : `${fmtSigned(t, 0)}%`}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
      </div>

      {f && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-line">
          <Spread label="HL − Binance" value={f.spreadHlBinancePp} />
          <Spread label="HL − Bybit" value={f.spreadHlBybitPp} />
          <div className="min-w-0 flex flex-col gap-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium truncate">Tłok HL (z vs 7 dni)</span>
              <Badge tone="model" title="Z-score przewidywanej stawki HL względem godzinowych stawek z 7 dni (fundingHistory). Schmeling–Schrimpf–Todorov 2023 (BIS), He–Manela–Ross–von Wachter 2022">
                MODEL
              </Badge>
            </div>
            <div className="text-xl font-semibold text-ink-1 leading-tight">{cm.fundingZ ? `${fmtSigned(cm.fundingZ.z, 2)}σ` : 'n/a'}</div>
            <div className="text-[11px] text-ink-3 leading-snug">
              {cm.fundingZ
                ? `${crowdText(cm.fundingZ.z)} n = ${cm.fundingZ.n} h, średnia ${fmtPct(cm.fundingZ.mean * 24 * 365 * 100, 1)} APR.`
                : 'Funding HL stały w oknie albo za mało historii (fundingHistory odświeżane co 15 min).'}
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-ink-3 leading-relaxed">
        Dane Binance/Bybit pośrednio przez API Hyperliquid (predictedFundings — prognoza najbliższej płatności). HL płaci co 1 h, CEX wg
        własnego interwału; APR = stawka × (24 / interwał) × 365.
      </p>
    </Panel>
  );
};

const VenueBar: React.FC<{
  v: VenueFunding;
  xPx: (v: number) => number;
  zeroPx: number;
  plotW: number;
  reduce: boolean;
  highlighted: boolean;
}> = ({ v, xPx, zeroPx, plotW, reduce, highlighted }) => {
  const end = xPx(v.aprPct);
  const pos = v.aprPct >= 0;
  const left = Math.min(zeroPx, end);
  const width = Math.abs(end - zeroPx);
  const text = fmtPct(v.aprPct, 2);
  const labelW = text.length * CHAR_W + 8;
  // Etykieta na końcu słupka: na zewnątrz, gdy się mieści; inaczej wewnątrz (ciemny tekst na wypełnieniu)
  const roomOutside = pos ? plotW - end : end;
  const inside = roomOutside < labelW && width >= labelW + 4;
  const labelStyle: React.CSSProperties = pos
    ? inside
      ? { right: plotW - end + 6 }
      : { left: end + 6 }
    : inside
    ? { left: end + 6 }
    : { right: plotW - end + 6 };

  return (
    <>
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ left, width }}
        transition={reduce ? { duration: 0 } : SPRING}
        className={`absolute top-1/2 -translate-y-1/2 ${pos ? 'bg-buy rounded-r' : 'bg-sell rounded-l'} ${highlighted ? 'brightness-110' : ''}`}
        style={{ height: BAR_H }}
      />
      {(inside || roomOutside >= labelW) && (
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 font-mono tabular-nums text-xs whitespace-nowrap ${inside ? 'text-page font-semibold' : 'text-ink-1'}`}
          style={labelStyle}
        >
          {text}
        </span>
      )}
    </>
  );
};

const VenueTooltip: React.FC<{ v: VenueFunding; now: number; left: number }> = ({ v, now, left }) => (
  <div
    role="tooltip"
    className="pointer-events-none absolute z-20 bottom-full mb-1 w-[240px] -translate-x-1/2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-lg"
    style={{ left }}
  >
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-ink-1">{fmtPct(v.aprPct, 2)} APR</span>
      <span className="text-ink-2">{VENUE_LABEL[v.venue]}</span>
    </div>
    <div className="mt-1 font-mono tabular-nums text-ink-2">
      {fmtSigned(v.rate * 100, 4, '%')} / {v.intervalH} h
    </div>
    <div className="text-ink-3">
      Następna płatność: {v.nextFundingTime !== null ? `${timeFmt.format(v.nextFundingTime)} · ${fmtCountdown(v.nextFundingTime, now)}` : DASH}
    </div>
  </div>
);

const Spread: React.FC<{ label: string; value: number | null }> = ({ label, value }) => (
  <div className="min-w-0 flex flex-col gap-1">
    <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium truncate">Spread {label}</span>
    <div className="text-xl font-semibold text-ink-1 leading-tight">{value === null ? 'n/a' : `${fmtSigned(value, 2)} pp`}</div>
    <div className="text-[11px] text-ink-3 leading-snug">
      {value === null ? 'brak stawki jednej ze stron' : value > 0 ? 'longi na HL płacą więcej niż na CEX' : value < 0 ? 'longi na HL płacą mniej niż na CEX' : 'bez różnicy'}
    </div>
  </div>
);

export default FundingVenues;
