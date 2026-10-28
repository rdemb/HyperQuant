import React, { useId } from 'react';

/**
 * Schrödi: kot Schrödingera w superpozycji. Ciemny kot z dwoma konturami — zielonym (Long) i pomarańczowym (Short) —
 * o jasności równej szansie wzrostu i spadku. Im mniejsza pewność, tym bardziej kontury się rozjeżdżają, rozmywają
 * i drgają; przy wyraźnej przewadze (od ok. 60%) kot „zapada się” w jeden kolor.
 * Animacja w CSS (`hq-cat-*` w index.css): oddech, mruganie, uszy, ogon, rozglądanie się i podskok przy nowej prognozie;
 * przy „ogranicz ruch” w systemie kot stoi nieruchomo.
 */

export type Mood = 'calm' | 'alert' | 'sleep' | 'nervous' | 'hiding';

/** Pyszczek bez uszu (viewBox 64 × 64); uszy osobno, żeby mogły się ruszać */
const FACE = 'M13 27 Q32 11 51 27 Q57 36 52 46 Q46 57 32 57 Q18 57 12 46 Q7 36 13 27 Z';
const EAR_L = 'M12.5 29 L9.5 6.5 L28 17.5 Z';
const EAR_R = 'M51.5 29 L54.5 6.5 L36 17.5 Z';
/** Ogon zza pyszczka, zawinięty w górę po prawej */
const TAIL = 'M44 53 C56 57 63 49 60.5 39 C59 33 60 28.5 63.5 26';

export const SchrodiCat: React.FC<{ pUp: number | null; mood: Mood; size?: number; className?: string; beat?: number }> = ({
  pUp,
  mood,
  size = 48,
  className,
  beat,
}) => {
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
  // Drganie konturów w superpozycji: amplituda maleje do zera wraz z pewnością
  const jitter = { '--q': `${(0.9 * shift).toFixed(2)}px` } as React.CSSProperties;
  const shape = (d: string) => (
    <>
      <path d={d} fill="var(--color-surface-3)" />
      {!grey && <path d={d} fill={lead} opacity={0.12 + 0.68 * conf} />}
      <g fill="none" strokeWidth={2.4} strokeLinejoin="round" filter={blur > 0.05 ? `url(#b${id})` : undefined}>
        {grey ? (
          <path d={d} stroke="var(--color-ink-3)" />
        ) : (
          <>
            <g className="hq-cat-q" style={jitter}>
              <path d={d} stroke="var(--color-buy-ink)" opacity={opBuy} transform={`translate(${-shift} 0)`} />
            </g>
            <g className="hq-cat-q hq-cat-q-rev" style={jitter}>
              <path d={d} stroke="var(--color-sell-ink)" opacity={opSell} transform={`translate(${shift} 0)`} />
            </g>
          </>
        )}
      </g>
    </>
  );
  const tailStroke = (stroke: string, width: number, opacity = 1, dx = 0) => (
    <path d={TAIL} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" opacity={opacity} transform={dx ? `translate(${dx} 0)` : undefined} />
  );
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
      </defs>
      {/* Nowa prognoza = nowy klucz, więc podskok odtwarza się raz */}
      <g key={beat} className={beat === undefined ? undefined : 'hq-cat-hop'}>
        {/* Ogon za pyszczkiem: obwódka w kolorach stron, środek w kolorze ciała */}
        <g className={mood === 'sleep' ? 'hq-cat-tail hq-cat-slow' : 'hq-cat-tail'}>
          <g filter={blur > 0.05 ? `url(#b${id})` : undefined}>
            {grey ? (
              tailStroke('var(--color-ink-3)', 7.2)
            ) : (
              <>
                {tailStroke('var(--color-buy-ink)', 7.2, opBuy, -shift)}
                {tailStroke('var(--color-sell-ink)', 7.2, opSell, shift)}
              </>
            )}
          </g>
          {tailStroke('var(--color-surface-3)', 4.4)}
          {!grey && tailStroke(lead, 4.4, 0.12 + 0.68 * conf)}
        </g>
        <g className={mood === 'sleep' ? undefined : 'hq-cat-ear-l'}>{shape(EAR_L)}</g>
        <g className={mood === 'sleep' ? undefined : 'hq-cat-ear-r'}>{shape(EAR_R)}</g>
        {shape(FACE)}
        {/* Twarz rysowana raz, ostro — kot jest jeden, tylko jego stan jest rozmyty */}
        <g fill="none" stroke="var(--color-ink-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {eyesOpen ? (
            <g className="hq-cat-blink">
              <ellipse cx={24} cy={35} rx={mood === 'alert' ? 3.8 : 3.4} ry={eyeRy} fill="var(--color-ink-1)" stroke="none" />
              <ellipse cx={40} cy={35} rx={mood === 'alert' ? 3.8 : 3.4} ry={eyeRy} fill="var(--color-ink-1)" stroke="none" />
              <g className="hq-cat-look">
                <ellipse cx={24} cy={35} rx={mood === 'alert' ? 1.6 : 1} ry={eyeRy - 0.6} fill="var(--color-page)" stroke="none" />
                <ellipse cx={40} cy={35} rx={mood === 'alert' ? 1.6 : 1} ry={eyeRy - 0.6} fill="var(--color-page)" stroke="none" />
              </g>
            </g>
          ) : (
            <>
              <path d="M20 35 Q24 38.5 28 35" />
              <path d="M36 35 Q40 38.5 44 35" />
            </>
          )}
          <path d="M30 43 L34 43 L32 45.2 Z" fill="var(--color-ink-1)" />
          <path d="M32 45.2 Q30 48.5 27.5 47.2 M32 45.2 Q34 48.5 36.5 47.2" strokeWidth={1.6} />
          <g className="hq-cat-whisk">
            <path d="M5 41 L18 43 M5 46 L18 45.5 M59 41 L46 43 M59 46 L46 45.5" strokeWidth={1.1} stroke="var(--color-ink-2)" />
          </g>
        </g>
      </g>
      {mood === 'sleep' && (
        <text x={50} y={12} fontSize={10} fontWeight={700} fill="var(--color-ink-2)" className="hq-cat-zzz">
          z
        </text>
      )}
      {mood === 'nervous' && <path d="M55 18 Q58 23 55 26 Q52 23 55 18 Z" fill="var(--color-accent)" className="hq-cat-drop" />}
      {mood === 'alert' && (
        <path d="M57 10 L58.2 13.8 L62 15 L58.2 16.2 L57 20 L55.8 16.2 L52 15 L55.8 13.8 Z" fill="var(--color-level)" className="hq-cat-spark" />
      )}
    </svg>
  );
};
