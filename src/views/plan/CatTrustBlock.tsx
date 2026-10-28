import React from 'react';
import { DASH, fmtE, fmtFixed } from '../../ui';
import { locale, tr } from '../../i18n';
import { type CatTrust, type HourTrust, TRUST_DESIGN, TRUST_HEADS, type TrustHead, type TrustHeadKey, proofState } from '../../utils/schrodiTrust';

/**
 * Zaufanie do kota w dzienniku: dowód przewagi na żywo (e-wartość wobec prostej reguły, ważna przy każdym podglądaniu),
 * rozkład wyniku Briera (kalibracja, wiedza, trudność), koszyki kalibracji z pasmami Wilsona 90%, alarm dryfu i godziny
 * z rzadkim rynkiem; godzina na żywo (zapisy o :15 i :30) wobec tej samej metody z samej drogi ceny. Wszystko
 * przeliczalne z rekordów dziennika (scripts/verify-ledger.mjs).
 */

const PROOF_LG = Math.log10(TRUST_DESIGN.proof.threshold);
const whenFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const num = (v: number | null, d: number) => (v === null ? DASH : fmtFixed(v, d));
const pct = (v: number | null) => (v === null ? DASH : `${fmtFixed(Math.round(v * 100) || 0, 0)}%`);
/** Umiejętność ze znakiem: +98% lepiej niż reguła, −3% gorzej */
const signed = (v: number | null) => (v === null ? DASH : `${v > 0 ? '+' : ''}${pct(v)}`);

const LABEL: Record<TrustHeadKey, () => string> = {
  big: () => tr('Duży ruch', 'Big move'),
  dir: () => tr('Kierunek', 'Direction'),
  touch: () => tr('Dotknięcia poziomów', 'Level touches'),
};
const RULE: Record<TrustHeadKey, () => string> = {
  big: () => tr(`reguła: zawsze ${pct(TRUST_DESIGN.baseline.big)}`, `rule: always ${pct(TRUST_DESIGN.baseline.big)}`),
  dir: () => tr('reguła: zawsze 50%', 'rule: always 50%'),
  touch: () => tr('reguła: ruch Browna', 'rule: Brownian motion'),
};

/** Ścieżka kapitału (log10) z linią startu (1) i progu dowodu (20) */
const ProofPath: React.FC<{ h: TrustHead; label: string }> = ({ h, label }) => {
  const W = 132;
  const H = 40;
  const v = h.path;
  const lo = Math.min(-0.5, ...v);
  const hi = Math.max(PROOF_LG + 0.2, ...v);
  const y = (lg: number) => 2 + (1 - (lg - lo) / (hi - lo)) * (H - 4);
  const x = (i: number) => (v.length < 2 ? W - 2 : 2 + (i / (v.length - 1)) * (W - 4));
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
  const proven = proofState(h) === 'holding';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr(`${label}: kapitał zakładu w czasie, próg dowodu 20`, `${label}: betting capital over time, proof threshold 20`)}>
      <line x1={0} x2={W} y1={y(PROOF_LG)} y2={y(PROOF_LG)} stroke="var(--color-buy-ink)" strokeDasharray="3 3" opacity={0.7} />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" />
      {v.length > 0 && (
        <>
          <path d={d} fill="none" stroke={proven ? 'var(--color-buy-ink)' : 'var(--color-accent)'} strokeWidth={1.75} strokeLinejoin="round" />
          <circle cx={x(v.length - 1)} cy={y(v[v.length - 1])} r={2.5} fill={proven ? 'var(--color-buy-ink)' : 'var(--color-accent)'} />
        </>
      )}
    </svg>
  );
};

/** Koszyki kalibracji: kropka = częstość, pionowa kreska = pasmo Wilsona 90%, przekątna = idealna kalibracja */
const Calibration: React.FC<{ h: TrustHead; label: string }> = ({ h, label }) => {
  const S = 72;
  const bins = h.rel.filter((b) => b.n > 0 && b.meanP !== null && b.freq !== null);
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={tr(`${label}: kalibracja z pasmami 90%`, `${label}: calibration with 90% bands`)}>
      <rect x={0.5} y={0.5} width={S - 1} height={S - 1} fill="none" stroke="var(--color-line)" />
      <line x1={0} y1={S} x2={S} y2={0} stroke="var(--color-ink-3)" strokeDasharray="2 2" />
      {bins.map((b) => (
        <g key={b.lo}>
          {b.band && <line x1={b.meanP! * S} x2={b.meanP! * S} y1={S - b.band[0] * S} y2={S - b.band[1] * S} stroke="var(--color-accent)" strokeWidth={2} opacity={0.35} />}
          <circle cx={b.meanP! * S} cy={S - b.freq! * S} r={2.5} fill="var(--color-accent)" />
        </g>
      ))}
    </svg>
  );
};

/** Głowa oceny; `grey` = alarm dryfu przełącza kota w szary tryb (godzina na żywo: alarm tylko jako informacja) */
const Head: React.FC<{ h: TrustHead; label: string; rule: string; grey?: boolean }> = ({ h, label, rule, grey = true }) => {
  const st = proofState(h);
  const proven = st === 'holding';
  const bar = Math.max(0, Math.min(1, h.lg / PROOF_LG));
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-2">{label}</span>
        <span className="text-[10px] text-ink-3">
          {h.n} {tr('godz.', 'h')} · {rule}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{tr('Kapitał zakładu', 'Betting capital')}</div>
          <div className={`font-mono tabular-nums text-lg font-semibold ${proven ? 'text-buy-ink' : 'text-ink-1'}`}>{fmtE(h.lg)}</div>
          <div className="mt-1 h-1 w-24 rounded-full bg-surface-3 overflow-hidden" aria-hidden="true">
            <div className={`h-full ${proven ? 'bg-buy-ink' : 'bg-accent'}`} style={{ width: `${bar * 100}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-ink-3 leading-snug">
            {proven
              ? tr(`✓ dowód przewagi od ${whenFmt.format(h.proofAt!)}`, `✓ edge proven since ${whenFmt.format(h.proofAt!)}`)
              : st === 'faded'
                ? tr(
                    `dowód z ${whenFmt.format(h.proofAt!)}, potem kapitał spadł poniżej ${TRUST_DESIGN.proof.threshold}`,
                    `proven on ${whenFmt.format(h.proofAt!)}, since then capital fell below ${TRUST_DESIGN.proof.threshold}`
                  )
                : tr(`dowód od ${TRUST_DESIGN.proof.threshold}`, `proof at ${TRUST_DESIGN.proof.threshold}`)}
          </div>
        </div>
        <ProofPath h={h} label={label} />
      </div>
      <div className="flex items-start gap-3">
        <Calibration h={h} label={label} />
        <dl className="grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums">
          <dt className="font-sans text-ink-3">Brier</dt>
          <dd className="text-ink-1">
            {num(h.brier, 3)} <span className="text-ink-3">/ {num(h.brierBase, 3)}</span>
          </dd>
          <dt className="font-sans text-ink-3">{tr('Wiedza', 'Discrimination')}</dt>
          <dd className="text-ink-1">{num(h.corp?.dsc ?? null, 3)}</dd>
          <dt className="font-sans text-ink-3">{tr('Błąd kalibracji', 'Miscalibration')}</dt>
          <dd className="text-ink-1">{num(h.corp?.mcb ?? null, 3)}</dd>
          <dt className="font-sans text-ink-3">{tr('Trudność', 'Uncertainty')}</dt>
          <dd className="text-ink-1">{num(h.corp?.unc ?? null, 3)}</dd>
          <dt className="font-sans text-ink-3">{tr('Test kalibracji', 'Calibration test')}</dt>
          <dd className="text-ink-1">{h.spiegel ? `p ${num(h.spiegel.p, 2)}` : DASH}</dd>
        </dl>
      </div>
      <div className={`text-[11px] ${h.drift.alarm ? 'text-warn' : 'text-ink-3'}`}>
        {h.drift.alarm
          ? tr(
              `⚠️ Alarm dryfu od ${whenFmt.format(h.drift.since!)}: ostatnio gorzej niż reguła${grey ? ', kot w szarym trybie' : ''}`,
              `⚠️ Drift alarm since ${whenFmt.format(h.drift.since!)}: recently worse than the rule${grey ? ', the cat goes grey' : ''}`
            )
          : tr(
              `Dryf: brak (${fmtE(h.drift.lg)} z ${TRUST_DESIGN.drift.alarm}${h.drift.episodes ? `, alarmów dotąd ${h.drift.episodes}` : ''})`,
              `Drift: none (${fmtE(h.drift.lg)} of ${TRUST_DESIGN.drift.alarm}${h.drift.episodes ? `, alarms so far ${h.drift.episodes}` : ''})`
            )}
      </div>
    </div>
  );
};

/** Godzina na żywo: dowód wobec samej drogi ceny, kierunek opisowo */
const HourBlock: React.FC<{ hour: HourTrust }> = ({ hour }) => {
  const p = hour.plan!;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium">⏱️ {tr('Godzina na żywo', 'Live hour')}</div>
        <span className="text-[10px] text-ink-3 font-mono">
          {tr('plan', 'plan')} {p.id} · {tr('w dzienniku od', 'in the ledger since')} {whenFmt.format(p.at)} · {p.hash.slice(0, 10)}…
        </span>
      </div>
      <p className="text-[10px] text-ink-3 leading-snug">
        {tr(
          'O :15 i :30 kot zapisuje szansę dużego ruchu w bieżącej godzinie z drogi ceny od jej początku i swojej prognozy z tej chwili. Reguła to ta sama metoda z samej drogi ceny. Zakład raz na godzinę, ze średniej z obu zapisów. Na historii 2024 do 2026 dowód przychodził po ok. 34 dniach (mediana).',
          'At :15 and :30 the cat records the odds of a big move in the current hour from the price path since it began and its own forecast from that moment. The rule is the same method from the price path alone. One bet per hour, on the average of both records. On 2024 to 2026 history the proof came after about 34 days (median).'
        )}{' '}
        {hour.dir.n > 0 &&
          tr(
            `Kierunek tylko z drogi ceny: Brier ${num(hour.dir.brier, 3)}, trafność ${pct(hour.dir.hit)} (${hour.dir.n} zapisów).`,
            `Direction from the price path only: Brier ${num(hour.dir.brier, 3)}, accuracy ${pct(hour.dir.hit)} (${hour.dir.n} records).`
          )}
      </p>
      {hour.big.n === 0 ? (
        <div className="text-xs text-ink-3">{tr('Pierwsza ocena po pierwszej pełnej godzinie od zapisania planu.', 'First result after the first full hour since the plan was recorded.')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Head h={hour.big} label={tr('Duży ruch w tej godzinie', 'Big move this hour')} rule={tr('reguła: sama droga ceny', 'rule: price path alone')} grey={false} />
        </div>
      )}
    </div>
  );
};

export const CatTrustBlock: React.FC<{ trust: CatTrust; hour?: HourTrust }> = ({ trust, hour }) => {
  const p = trust.plan;
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium">{tr('Zaufanie: dowód na żywo', 'Trust: live proof')}</div>
        {p && (
          <span className="text-[10px] text-ink-3 font-mono">
            {tr('plan', 'plan')} {p.id} · {tr('w dzienniku od', 'in the ledger since')} {whenFmt.format(p.at)} · {p.hash.slice(0, 10)}…
          </span>
        )}
      </div>
      <p className="text-[10px] text-ink-3 leading-snug">
        {tr(
          `Co pełną godzinę kot stawia wirtualny zakład, że trafi lepiej (wynik Briera) niż prosta reguła. Kapitał startuje od 1. Jeśli kot nie ma przewagi, szansa, że kapitał kiedykolwiek przekroczy ${TRUST_DESIGN.proof.threshold}, wynosi najwyżej 5%, także przy podglądaniu co godzinę. Dlatego ${TRUST_DESIGN.proof.threshold} = dowód. Na historii 2023 do 2026 dowód przychodził po ok. 4 dniach dla dużego ruchu i ok. 17 dla dotknięć; kierunek zwykle po miesiącach albo wcale. Brier: kot / reguła. Wiedza minus błąd kalibracji = ile kot wnosi ponad samą trudność rynku.`,
          `Every full hour the cat places a virtual bet that it beats a simple rule (Brier score). Capital starts at 1. If the cat has no edge, the chance that capital ever exceeds ${TRUST_DESIGN.proof.threshold} is at most 5%, even when checked every hour. So ${TRUST_DESIGN.proof.threshold} = proof. On 2023 to 2026 history the proof came after about 4 days for big moves and about 17 for touches; direction usually after months or never. Brier: cat / rule. Discrimination minus miscalibration = what the cat adds beyond the market's own uncertainty.`
        )}
      </p>
      {!p ? (
        <div className="text-xs text-ink-3">{tr('Plan oceny zapisze się w dzienniku przy najbliższym slocie.', 'The evaluation plan is written to the ledger at the next slot.')}</div>
      ) : trust.big.n === 0 ? (
        <div className="text-xs text-ink-3">{tr('Pierwsza ocena po pierwszej pełnej godzinie od zapisania planu.', 'First result after the first full hour since the plan was recorded.')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TRUST_HEADS.map((k) => (
              <Head key={k} h={trust[k]} label={LABEL[k]()} rule={RULE[k]()} />
            ))}
          </div>
          <div className="text-[11px] text-ink-3">
            {tr(
              `🧭 Rzadki rynek (cechy poza zakresem 99% z nauki): ${trust.ood.n} godz.${trust.ood.n ? `; Brier względem reguły: ruch ${signed(trust.ood.bssBig)}, kierunek ${signed(trust.ood.bssDir)}` : ''}.`,
              `🧭 Rare market (features outside the 99% training range): ${trust.ood.n} h${trust.ood.n ? `; Brier against the rule: move ${signed(trust.ood.bssBig)}, direction ${signed(trust.ood.bssDir)}` : ''}.`
            )}
          </div>
        </>
      )}
      {hour?.plan && <HourBlock hour={hour} />}
    </div>
  );
};
