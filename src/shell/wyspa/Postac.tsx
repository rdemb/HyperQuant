import React, { useId } from 'react';
import type { PersonaId, PersonaState } from './persony';

/**
 * Postać załogi: czasomierz z oczami (rodzina znaku HyperQuant „Chronograf”). Tarcza, pierścień czasu (łuk lume obiega
 * tarczę, gdy postać czuwa), oczy mrugające w swoim rytmie i emblemat roboty nad tarczą. Śpi: oczy zamknięte, szary
 * pierścień, „z”. Alarm: pełny pierścień pulsuje, postać podskakuje. Animacje w CSS (`index.css`, klasy `postac-*`),
 * wyłączone przy „ogranicz ruch”. Rysunek dekoracyjny: znaczenie niesie podpis obok (aria-hidden).
 */

const DELAY: Record<PersonaId, string> = { latarnik: '0s', dzwonnik: '-1.3s', sejsmograf: '-2.1s', kotwicz: '-0.7s', iskra: '-2.8s', skarbnik: '-1.8s', sufler: '-3.4s' };

/** Emblemat nad tarczą (współrzędne viewBox 64×64; tarcza: środek 32,36, promień 20). */
const Emblem: React.FC<{ id: PersonaId }> = ({ id }) => {
  switch (id) {
    case 'latarnik':
      return (
        <g>
          <path className="postac-beam" d="M32 9 L52 2 L52 14 Z" fill="var(--color-lume)" opacity="0.35" />
          <rect x="28" y="7" width="8" height="6" rx="1.5" fill="var(--color-lume)" />
          <path d="M26 16 L38 16 L36 13 L28 13 Z" fill="var(--color-ink-2)" />
        </g>
      );
    case 'dzwonnik':
      return (
        <g className="postac-bell" style={{ transformOrigin: '32px 4px' }}>
          <path d="M25 15 Q25 6 32 5 Q39 6 39 15 Z" fill="var(--color-lume)" />
          <rect x="23.5" y="14" width="17" height="2.5" rx="1.25" fill="var(--color-lume)" />
          <circle cx="32" cy="18" r="1.8" fill="var(--color-ink-2)" />
        </g>
      );
    case 'sejsmograf':
      return (
        <g>
          <line x1="32" y1="16" x2="32" y2="8" stroke="var(--color-ink-2)" strokeWidth="1.5" />
          <path className="postac-zig" d="M20 8 L25 8 L27 3 L30 13 L33 1 L36 12 L38 6 L44 8" fill="none" stroke="var(--color-lume)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      );
    case 'kotwicz':
      return (
        <g className="postac-bob">
          <circle cx="32" cy="5" r="2.6" fill="none" stroke="var(--color-lume)" strokeWidth="1.8" />
          <line x1="32" y1="7.6" x2="32" y2="15" stroke="var(--color-lume)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M26 11 Q32 17 38 11" fill="none" stroke="var(--color-lume)" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    case 'iskra':
      return (
        <path className="postac-flicker" style={{ transformOrigin: '32px 12px' }} d="M33 2 L27 11 L31.5 11 L29 18 L37 8 L32.5 8 Z" fill="var(--color-lume)" stroke="var(--color-lume)" strokeWidth="0.8" strokeLinejoin="round" />
      );
    case 'skarbnik':
      return (
        <g className="postac-coin" style={{ transformOrigin: '32px 9px' }}>
          <circle cx="32" cy="9" r="6" fill="var(--color-lume)" />
          <text x="32" y="11.6" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="var(--color-page)" fontFamily="var(--font-mono)">
            %
          </text>
        </g>
      );
    case 'sufler':
      return (
        <g>
          <rect x="22" y="2" width="20" height="12" rx="4" fill="var(--color-lume)" />
          <path d="M28 14 L30 17 L32 14 Z" fill="var(--color-lume)" />
          <circle className="postac-dot" cx="27" cy="8" r="1.4" fill="var(--color-page)" />
          <circle className="postac-dot" style={{ animationDelay: '0.2s' }} cx="32" cy="8" r="1.4" fill="var(--color-page)" />
          <circle className="postac-dot" style={{ animationDelay: '0.4s' }} cx="37" cy="8" r="1.4" fill="var(--color-page)" />
        </g>
      );
  }
};

export const Postac: React.FC<{ id: PersonaId; state: PersonaState; size?: number; className?: string }> = ({ id, state, size = 40, className = '' }) => {
  const awake = state !== 'spi';
  const ring = 2 * Math.PI * 21;
  const g = useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      data-postac={id}
      data-stan={state}
      className={`postac shrink-0 overflow-visible ${state === 'alarm' ? 'postac-hop' : ''} ${className}`}
      style={{ ['--postac-delay' as string]: DELAY[id] }}
    >
      <defs>
        <radialGradient id={`${g}-k`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#4a515b" />
          <stop offset="0.55" stopColor="#2a2f36" />
          <stop offset="1" stopColor="#1a1d21" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="61" rx="15" ry="2.5" fill="black" opacity="0.4" />
      {/* Emblem większy niż w siatce rysunku: czytelny także przy 40 px */}
      <g className={awake ? '' : 'postac-sleep-emblem'} transform="translate(32 12) scale(1.3) translate(-32 -9)">
        <Emblem id={id} />
      </g>
      {/* Koperta (jasny metal) i tarcza (ekran) */}
      <circle cx="32" cy="36" r="21" fill={`url(#${g}-k)`} stroke="#5a626d" strokeWidth="1" />
      <circle cx="32" cy="36" r="15.5" fill="#0f1114" stroke="black" strokeOpacity="0.5" strokeWidth="1" />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="32" y1="21.6" x2="32" y2="23.4" stroke="var(--color-ink-3)" strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${a} 32 36)`} />
      ))}
      {/* Pierścień czasu: łuk obiega tarczę (czuwa), pełny i pulsuje (alarm), szary (śpi) */}
      <circle
        cx="32"
        cy="36"
        r="21"
        fill="none"
        stroke={awake ? 'var(--color-lume)' : 'var(--color-ink-3)'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={state === 'alarm' ? `${ring} 0` : `${ring * 0.18} ${ring}`}
        className={state === 'czuwa' ? 'postac-sweep' : state === 'alarm' ? 'postac-pulse' : ''}
        style={{ transformOrigin: '32px 36px' }}
        opacity={awake ? 1 : 0.5}
      />
      {/* Oczy */}
      {awake ? (
        <g className="postac-blink" style={{ transformOrigin: '32px 34px' }}>
          <rect x="25" y={state === 'alarm' ? 28.5 : 29.5} width="5" height={state === 'alarm' ? 10 : 8.5} rx="2.5" fill="var(--color-ink-1)" />
          <rect x="34" y={state === 'alarm' ? 28.5 : 29.5} width="5" height={state === 'alarm' ? 10 : 8.5} rx="2.5" fill="var(--color-ink-1)" />
        </g>
      ) : (
        <g stroke="var(--color-ink-2)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M25 34.5 Q27.5 36.5 30 34.5" fill="none" />
          <path d="M34 34.5 Q36.5 36.5 39 34.5" fill="none" />
        </g>
      )}
      {/* Usta: kreska; przy alarmie otwarte */}
      {state === 'alarm' ? (
        <ellipse cx="32" cy="43.5" rx="2.6" ry="2.2" fill="var(--color-lume)" />
      ) : (
        <path d={awake ? 'M29.5 42.5 Q32 44.5 34.5 42.5' : 'M30 43 L34 43'} fill="none" stroke="var(--color-ink-2)" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {!awake && (
        <text className="postac-z" x="50" y="22" fontSize="9" fontWeight="700" fill="var(--color-ink-3)" fontFamily="var(--font-display)">
          z
        </text>
      )}
    </svg>
  );
};
