import React from 'react';
import { DASH, Stat, fmtFixed, fmtPrice } from '../../ui';
import type { CatHeadScores, DeskLedgerSummary } from '../../utils/deskLedger';
import { locale, tr } from '../../i18n';
import { CatTrustBlock } from './CatTrustBlock';

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
/** Procent bez „−0%” (zero ze znakiem minus z zaokrąglenia) */
const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : `${fmtFixed(Math.round(v * 100) || 0, 0)}%`);
const num = (v: number | null, d: number) => (v === null ? DASH : fmtFixed(v, d));
/** Wyniki od 20 rozłącznych godzin — mniejsza próba to szum */
const MIN_EFF = 20;

/** Schrödi (kot pod wykresem) w dzienniku: najnowsza prognoza, zaufanie, wyniki obu głów, szanse dotknięcia i udział w slotach. */
export const CatLedgerCard: React.FC<{ cat: NonNullable<DeskLedgerSummary['cat']> }> = ({ cat }) => {
  const s = cat.scores;
  const enough = s.nEff >= MIN_EFF;
  const t = s.touch;
  const tEnough = !!t && t.hours >= MIN_EFF;
  const head = (h: CatHeadScores, label: string, extra?: React.ReactNode) => (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-ink-2">{label}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Stat
          label="Brier"
          value={<span className="font-mono tabular-nums text-base">{enough ? num(h.brier, 3) : DASH}</span>}
          hint={enough ? `${tr('klimatologia', 'climatology')} ${num(h.brierBase, 3)}` : tr(`od ${MIN_EFF} godzin (jest ${s.nEff})`, `from ${MIN_EFF} hours (now ${s.nEff})`)}
        />
        <Stat label={tr('Umiejętność (BSS)', 'Skill (BSS)')} value={<span className="font-mono tabular-nums text-base">{enough ? pct(h.bss) : DASH}</span>} />
        <Stat label="AUC" value={<span className="font-mono tabular-nums text-base">{enough ? num(h.auc, 2) : DASH}</span>} hint={tr('0,5 = rzut monetą', '0.5 = coin flip')} />
        <Stat label={tr('Trafność', 'Accuracy')} value={<span className="font-mono tabular-nums text-base">{enough ? pct(h.hit) : DASH}</span>} />
      </div>
      {extra}
    </div>
  );
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Schrödi: duży ruch, kierunek i dotknięcia w 1 h', 'Schrödi: big move, direction and touches within 1 h')}</div>
        {cat.latest && (
          <span className="text-[11px] text-ink-3">
            {tr('wydano', 'issued')} {timeFmt.format(cat.latest.t)} · {tr('cena', 'price')} {fmtPrice(cat.latest.px0, 0)} · {tr('ruch', 'move')} {pct(cat.latest.pBig)} ·{' '}
            {tr('wzrost', 'rise')} {pct(cat.latest.pUp)}
          </span>
        )}
      </div>
      <p className="text-[10px] text-ink-3 leading-snug">
        {tr(
          `Ten sam model i kod co kot w Wykresach, zapisany co 15 min razem z prognozami desku. Cechy w rekordzie, więc każdy przeliczy p publicznym modelem. Duży ruch = zakres godziny ponad medianę z 30 dni. Prognozy na 1 h co 15 min nakładają się, więc oceniamy od ${MIN_EFF} rozłącznych godzin. Test kroczący 2023 do 2026: AUC 0,83 (ruch) i 0,54 (kierunek).`,
          `The same model and code as the cat in Charts, recorded every 15 min with the desk forecasts. Features are in the record, so anyone can recompute p with the public model. Big move = hourly range above the 30-day median. 1 h forecasts every 15 min overlap, so scores start from ${MIN_EFF} non-overlapping hours. Walk-forward test 2023 to 2026: AUC 0.83 (move) and 0.54 (direction).`
        )}
        {cat.since !== null && (
          <>
            {' '}
            {tr('Od', 'Since')} {dateFmt.format(cat.since)}: {cat.issued} {tr('z', 'of')} {cat.slots} {tr('slotów desku', 'desk slots')}.
          </>
        )}
      </p>
      {cat.trust && <CatTrustBlock trust={cat.trust} hour={cat.hour} />}
      {cat.trust && <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Ostatnie 30 dni', 'Last 30 days')}</div>}
      {head(s.big, tr('Duży ruch', 'Big move'))}
      {head(
        s.dir,
        tr('Kierunek (wzrost)', 'Direction (rise)'),
        <div className="text-[11px] text-ink-2">
          Long ({tr('od 53%', 'from 53%')}): <span className="font-mono text-ink-1">{pct(s.dir.long.hit)}</span> {tr('z', 'of')} {s.dir.long.n} · Short ({tr('do 47%', 'to 47%')}):{' '}
          <span className="font-mono text-ink-1">{pct(s.dir.short.hit)}</span> {tr('z', 'of')} {s.dir.short.n} · {tr('nie wiem', "don't know")} {s.dir.unsure}
        </div>
      )}
      {t && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-ink-2">
            {tr('Dotknięcia poziomów i stożek zasięgu', 'Level touches and the reach cone')}{' '}
            <span className="text-ink-3">
              ({t.n} {tr('szans', 'odds')}, {t.hours} {tr('godzin', 'hours')})
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <Stat
              label="Brier"
              value={<span className="font-mono tabular-nums text-base">{tEnough ? num(t.brier, 3) : DASH}</span>}
              hint={tEnough ? `${tr('ruch Browna', 'Brownian motion')} ${num(t.brierBm, 3)}` : tr(`od ${MIN_EFF} godzin (jest ${t.hours})`, `from ${MIN_EFF} hours (now ${t.hours})`)}
            />
            <Stat
              label={tr('Lepiej niż ruch Browna', 'Better than Brownian')}
              value={<span className="font-mono tabular-nums text-base">{tEnough ? pct(t.bssBm) : DASH}</span>}
              hint={tr('test 2026: 9%', '2026 test: 9%')}
            />
            {t.cone.slice(0, 2).map((c) => (
              <Stat
                key={c.q}
                label={tr(`Granica ${pct(c.q)} dotknięta`, `${pct(c.q)} edge touched`)}
                value={
                  <span className="font-mono tabular-nums text-base">
                    {tEnough ? `${pct(c.up)} / ${pct(c.dn)}` : DASH}
                  </span>
                }
                hint={tr(`w górę / w dół, cel ${pct(c.q)}`, `up / down, target ${pct(c.q)}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
