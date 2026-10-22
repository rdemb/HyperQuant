import React, { useRef, useState } from 'react';
import { useLiquidityProfile } from '../../state/useLiquidityProfile';
import { Badge, EmptyState, Panel, Stat, DASH, fmtCompact } from '../../ui';
import type { LiquidityProfile } from '../../utils/liquidity';
import { useElementWidth } from '../market/MarketMap';

const dayFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hmFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const minFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const daysWord = (n: number) => (n === 1 ? 'dnia' : 'dni');
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
      eyebrow={`Rejestrator arkusza HyperQuant${profile?.since ? ` · historia od ${dayFmt.format(profile.since)}` : ''} · godziny UTC`}
      title="Płynność arkusza w ciągu doby"
      actions={
        status === 'ready' ? (
          <Badge tone="live" title="Migawki arkusza Hyperliquid (co ~5 s) zapisywane przez skaner; publikowane tylko agregaty">
            LIVE
          </Badge>
        ) : status === 'stale' ? (
          <Badge tone="stale" title="Profil nie był aktualizowany od ponad 30 min">
            STALE
          </Badge>
        ) : null
      }
    >
      {!profile ? (
        <EmptyState
          title={status === 'loading' ? 'Pobieram profil płynności…' : 'Profil płynności chwilowo niedostępny'}
          detail="Skaner zapisuje głębokość arkusza co ~5 s i publikuje medianę wg godziny doby — widać, kiedy płynność przy cenie jest najcieńsza."
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
        Mediana dolarów w zleceniach po obu stronach w odległości ±10 bp od środka, dla każdej godziny doby UTC, z {p.days} {daysWord(p.days)} historii
        ({p.minutes.toLocaleString('pl-PL')} minut). Cienka płynność = większy poślizg i łatwiejsze przesunięcie ceny.
      </p>
      <HourBars p={p} nowHour={nowHour} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label={p.now ? `Teraz ±10 bp · ${hmFmt.format(p.now.t)} UTC` : 'Teraz ±10 bp'}
          value={<span className="font-mono tabular-nums text-base">{usd(p.now?.d10)}</span>}
          hint={
            !p.now
              ? 'rejestrator nie zapisał świeżej minuty'
              : p.now.ratio10 !== null
              ? `${Math.round(p.now.ratio10 * 100)}% normy tej godziny (inne dni)`
              : 'norma od 3 dni historii tej godziny'
          }
        />
        <Stat
          label="Najcieńsza godzina"
          value={<span className="font-mono tabular-nums text-base">{thinnest ? `${hh(thinnest.h)} UTC` : DASH}</span>}
          hint={
            thinnest
              ? `${usd(thinnest.d10)} · najgłębsza ${deepest ? hh(deepest.h) : DASH} · z ${thinnest.days} ${daysWord(thinnest.days)}`
              : `od ${MIN_HOUR_N} min danych na godzinę`
          }
        />
        <Stat label="Teraz ±20 bp" value={<span className="font-mono tabular-nums text-base">{usd(p.now?.d20)}</span>} hint="obie strony" />
        <Stat
          label="Odporność"
          value={<span className="font-mono tabular-nums text-base">{r.medianMin === null ? DASH : `${minFmt.format(r.medianMin)} min`}</span>}
          hint={
            r.events
              ? `mediana powrotu głębokości po ruchu ≥ 15 bp z wycofaniem płynności (${r.events}${r.unrecovered ? `, bez powrotu w 1 h: ${r.unrecovered}` : ''}; bez wycofania: ${r.noDrop})`
              : r.noDrop
              ? `${r.noDrop} ruchów ≥ 15 bp bez wycofania płynności`
              : 'brak ruchów ≥ 15 bp w historii'
          }
        />
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Metoda: migawki arkusza Hyperliquid co ~5 s, zagregowane w koszyki dobierane do ceny tak, by 20 poziomów pokrywało ±20 bp (~10–20 USD),
        koszyk na granicy pasma liczony proporcjonalnie; minutowe mediany. Godzina z mniej niż {MIN_HOUR_N} min danych jest wyszarzona; norma
        „teraz” — z co najmniej 3 innych dni tej godziny. Odporność: po minucie, w której środek ruszył się o ≥ 15 bp, liczba minut (ciągłych)
        do powrotu głębokości ±10 bp do 80% mediany z poprzedniej godziny; przerwy w danych pomijane{r.censored ? ` (${r.censored})` : ''}.
        Arkusz pokazuje zlecenia widoczne — ukryte i szybko anulowane nie są tu widoczne. Opis, nie prognoza.
      </p>
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
        <svg width={width} height={H} role="img" aria-label="Mediana głębokości arkusza ±10 bp w każdej godzinie doby UTC">
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
          min z {hb.days} {daysWord(hb.days)}
        </div>
      )}
    </div>
  );
};
