import React, { useId } from 'react';

/**
 * Schrödi: kot Schrödingera w superpozycji. Ciemny kot z dwoma konturami — zielonym (Long) i pomarańczowym (Short) —
 * o jasności równej szansie wzrostu i spadku. Im mniejsza pewność, tym bardziej kontury się rozjeżdżają i rozmywają;
 * przy wyraźnej przewadze (od ok. 60%) kot „zapada się” w jeden kolor.
 */

export type Mood = 'calm' | 'alert' | 'sleep' | 'nervous' | 'hiding';

/** Głowa z uszami (viewBox 64 × 64) */
const HEAD = 'M13 27 L10 7 L25 17 Q32 14.5 39 17 L54 7 L51 27 Q56 35 52 45 Q46 57 32 57 Q18 57 12 45 Q8 35 13 27 Z';

export const SchrodiCat: React.FC<{ pUp: number | null; mood: Mood; size?: number; className?: string }> = ({ pUp, mood, size = 48, className }) => {
  const id = useId().replace(/:/g, '');
  const p = pUp ?? 0.5;
  // Pewność 0 przy 50%, 1 od 60% (albo 40%)
  const conf = pUp === null || mood === 'hiding' ? 0 : Math.min(1, Math.abs(p - 0.5) / 0.1);
  const blur = mood === 'hiding' ? 1.6 : 1.2 * (1 - conf);
  const shift = mood === 'hiding' ? 0 : 3 * (1 - conf);
  const grey = pUp === null || mood === 'hiding';
  const lead = p >= 0.5 ? 'var(--color-buy-ink)' : 'var(--color-sell-ink)';
  // Kontur strony przegrywającej gaśnie wraz z pewnością
  const opBuy = (0.2 + 0.8 * p) * (p >= 0.5 ? 1 : 1 - conf);
  const opSell = (0.2 + 0.8 * (1 - p)) * (p < 0.5 ? 1 : 1 - conf);
  const eyesOpen = mood !== 'sleep';
  const eyeRy = mood === 'alert' ? 5 : 4.2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      className={`${className ?? ''} ${mood === 'sleep' ? 'hq-cat-sleep' : 'hq-cat-breathe'}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id={`b${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <path id={`h${id}`} d={HEAD} />
      </defs>
      {/* Ciało: ciemne, z kolorem strony, która prowadzi — tym mocniej, im większa pewność */}
      <use href={`#h${id}`} fill="var(--color-surface-3)" />
      {!grey && <use href={`#h${id}`} fill={lead} opacity={0.12 + 0.68 * conf} />}
      {/* Dwa kontury w superpozycji, kryciem równe szansom */}
      <g fill="none" strokeWidth={2.4} strokeLinejoin="round" filter={blur > 0.05 ? `url(#b${id})` : undefined}>
        {grey ? (
          <use href={`#h${id}`} stroke="var(--color-ink-3)" />
        ) : (
          <>
            <use href={`#h${id}`} stroke="var(--color-buy-ink)" opacity={opBuy} transform={`translate(${-shift} 0)`} />
            <use href={`#h${id}`} stroke="var(--color-sell-ink)" opacity={opSell} transform={`translate(${shift} 0)`} />
          </>
        )}
      </g>
      {/* Twarz rysowana raz, ostro — kot jest jeden, tylko jego stan jest rozmyty */}
      <g fill="none" stroke="var(--color-ink-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {eyesOpen ? (
          <>
            <ellipse cx={24} cy={35} rx={mood === 'alert' ? 3.8 : 3.4} ry={eyeRy} fill="var(--color-ink-1)" stroke="none" />
            <ellipse cx={40} cy={35} rx={mood === 'alert' ? 3.8 : 3.4} ry={eyeRy} fill="var(--color-ink-1)" stroke="none" />
            <ellipse cx={24} cy={35} rx={mood === 'alert' ? 1.6 : 1} ry={eyeRy - 0.6} fill="var(--color-page)" stroke="none" />
            <ellipse cx={40} cy={35} rx={mood === 'alert' ? 1.6 : 1} ry={eyeRy - 0.6} fill="var(--color-page)" stroke="none" />
          </>
        ) : (
          <>
            <path d="M20 35 Q24 38.5 28 35" />
            <path d="M36 35 Q40 38.5 44 35" />
          </>
        )}
        <path d="M30 43 L34 43 L32 45.2 Z" fill="var(--color-ink-1)" />
        <path d="M32 45.2 Q30 48.5 27.5 47.2 M32 45.2 Q34 48.5 36.5 47.2" strokeWidth={1.6} />
        <path d="M5 41 L18 43 M5 46 L18 45.5 M59 41 L46 43 M59 46 L46 45.5" strokeWidth={1.1} stroke="var(--color-ink-2)" />
      </g>
      {mood === 'sleep' && (
        <text x={50} y={12} fontSize={10} fontWeight={700} fill="var(--color-ink-2)" className="hq-cat-zzz">
          z
        </text>
      )}
      {mood === 'nervous' && <path d="M55 18 Q58 23 55 26 Q52 23 55 18 Z" fill="var(--color-accent)" />}
      {mood === 'alert' && (
        <path d="M57 10 L58.2 13.8 L62 15 L58.2 16.2 L57 20 L55.8 16.2 L52 15 L55.8 13.8 Z" fill="var(--color-level)" />
      )}
    </svg>
  );
};
