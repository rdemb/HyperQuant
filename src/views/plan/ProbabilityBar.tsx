import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SPRING } from '../../ui';
import { tr } from '../../i18n';

interface ProbabilityBarProps {
  pTarget: number;
  pStop: number;
  pNeither: number;
  horizonLabel: string;
  compact?: boolean;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Pasek trzech wyników: cel najpierw / stop najpierw / żadne w horyzoncie.
 * Szerokości sprężynują (SPRING), kolor stały; znaczenie niesie też znak (+ / − / ○) i etykieta.
 */
export const ProbabilityBar: React.FC<ProbabilityBarProps> = ({ pTarget, pStop, pNeither, horizonLabel, compact }) => {
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : SPRING;
  const segs = [
    { key: 't', p: pTarget, bar: 'bg-buy', sign: '+', label: tr('Cel najpierw', 'Target first') },
    { key: 's', p: pStop, bar: 'bg-sell', sign: '−', label: tr('Stop najpierw', 'Stop first') },
    { key: 'n', p: pNeither, bar: 'bg-ink-3/60', sign: '○', label: tr(`Żadne w ${horizonLabel}`, `Neither in ${horizonLabel}`) },
  ];
  const aria = tr(
    `Cel najpierw ${pct(pTarget)}, stop najpierw ${pct(pStop)}, żadne w ${horizonLabel} ${pct(pNeither)}`,
    `Target first ${pct(pTarget)}, stop first ${pct(pStop)}, neither in ${horizonLabel} ${pct(pNeither)}`
  );

  return (
    <div className="min-w-0">
      <div role="img" aria-label={aria} className={`flex gap-[2px] ${compact ? 'h-2' : 'h-3'} rounded-full overflow-hidden`}>
        {segs.map((s) => (
          <motion.div
            key={s.key}
            className={`${s.bar} min-w-0`}
            style={{ flexBasis: 0 }}
            initial={false}
            animate={{ flexGrow: Math.max(0, s.p) }}
            transition={transition}
            title={`${s.label}: ${pct(s.p)}`}
          />
        ))}
      </div>
      {!compact && (
        <div className="grid grid-cols-3 gap-2 mt-2">
          {segs.map((s) => (
            <div key={s.key} className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-3 truncate">
                <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${s.bar}`} aria-hidden="true" />
                <span aria-hidden="true" className="font-mono">{s.sign}</span>
                <span className="truncate">{s.label}</span>
              </div>
              <div className="text-sm font-mono tabular-nums text-ink-1 mt-0.5">{pct(s.p)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
