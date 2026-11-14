import React from 'react';
import { SESSION_LABEL } from '../../charts/pro/core/sessions';
import { daySessions, fmtSpan, localHour, sessionClock } from '../../shell/dzien';

export { daySessions, fmtSpan, localHour, sessionClock };
import { tr } from '../../i18n';

/**
 * Tarcza 24 h na Starcie: doba w czasie lokalnym, sesje BTC jak na wykresie (core/sessions: Azja od 00:00 UTC,
 * Londyn od 08:00 czasu Londynu, Nowy Jork od 09:30 czasu Nowego Jorku). Sesje przeszłe wyciszone, bieżąca
 * wypełniona do „teraz”, nadchodząca obrysem; wskazówka z kropką „lume”. Opis czasu, nie rynku.
 */
const C = 410;

const P = (r: number, h: number): [number, number] => {
  const a = (h / 24) * Math.PI * 2;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};

function arc(r: number, h0: number, h1: number): string {
  let span = h1 - h0;
  if (span <= 0) span += 24;
  const [x0, y0] = P(r, h0);
  const [x1, y1] = P(r, h0 + Math.min(span, 23.999));
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${span > 12 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export const SessionDial: React.FC<{ now: number; size?: number; detailed?: boolean }> = ({ now, size = 820, detailed = true }) => {
  const nowH = localHour(now);
  const clock = sessionClock(now);
  const ticks: string[] = [];
  const majors: string[] = [];
  for (let q = 0; q < 96; q++) {
    if (!detailed && q % 4) continue;
    const major = q % 24 === 0;
    const [x0, y0] = P(386, q / 4);
    const [x1, y1] = P(major ? 350 : q % 4 === 0 ? 364 : 378, q / 4);
    (major ? majors : ticks).push(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`);
  }
  const sw = detailed ? 18 : 34;
  const label = tr(
    `Tarcza 24 godzin, czas lokalny. ${SESSION_LABEL[clock.current.id]} trwa ${fmtSpan(clock.elapsed)}, ${SESSION_LABEL[clock.next.id]} za ${fmtSpan(clock.untilNext)}.`,
    `24-hour dial, local time. ${SESSION_LABEL[clock.current.id]} running for ${fmtSpan(clock.elapsed)}, ${SESSION_LABEL[clock.next.id]} in ${fmtSpan(clock.untilNext)}.`
  );
  return (
    <svg viewBox="0 0 820 820" width={size} height={size} role="img" aria-label={label} className="block max-w-full text-ink-1">
      <circle cx={C} cy={C} r={398} fill="var(--color-page)" stroke="var(--color-line)" strokeWidth={detailed ? 1 : 3} />
      <path d={arc(398, 0, nowH)} fill="none" stroke="currentColor" strokeWidth={detailed ? 3 : 8} />
      <path d={ticks.join('')} stroke="var(--color-line-strong)" strokeWidth={detailed ? 1.2 : 4} />
      <path d={majors.join('')} stroke="currentColor" strokeWidth={detailed ? 2.5 : 7} />
      {detailed &&
        Array.from({ length: 24 }, (_, h) => {
          const [x, y] = P(334, h);
          const big = h % 6 === 0;
          return (
            <text key={h} x={x} y={y + (big ? 5 : 4)} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={big ? 16 : 12} fontWeight={big ? 600 : 400} fill={big ? 'var(--color-ink-1)' : 'var(--color-ink-3)'}>
              {String(h).padStart(2, '0')}
            </text>
          );
        })}
      <circle cx={C} cy={C} r={290} fill="none" stroke="var(--color-line)" />
      {daySessions(now).map((s) => {
        const h0 = localHour(s.start);
        const h1 = localHour(s.end);
        if (s.end <= now) return <path key={s.id} d={arc(290, h0, h1)} fill="none" stroke="var(--color-line-strong)" strokeWidth={sw} />;
        if (s.start <= now)
          return (
            <g key={s.id}>
              <path d={arc(290, h0, h1)} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={sw} />
              <path d={arc(290, h0, nowH)} fill="none" stroke="currentColor" strokeWidth={sw} />
            </g>
          );
        return (
          <g key={s.id} fill="none" stroke="currentColor" strokeWidth={detailed ? 1.5 : 4}>
            <path d={arc(290 - sw / 2, h0, h1)} />
            <path d={arc(290 + sw / 2, h0, h1)} />
          </g>
        );
      })}
      {detailed &&
        daySessions(now).map((s) => {
          const h0 = localHour(s.start);
          let h1 = localHour(s.end);
          if (h1 <= h0) h1 += 24;
          const [lx, ly] = P(246, (h0 + h1) / 2);
          const [ox0, oy0] = P(268, h0);
          const [ox1, oy1] = P(312, h0);
          return (
            <g key={`l-${s.id}`}>
              <text x={lx} y={ly + 4} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={1.4} fill="var(--color-ink-2)">
                {SESSION_LABEL[s.id].toUpperCase()}
              </text>
              <path d={`M${ox0} ${oy0}L${ox1} ${oy1}`} stroke="currentColor" strokeWidth={2} />
            </g>
          );
        })}
      <g style={{ transform: `rotate(${(nowH / 24) * 360}deg)`, transformOrigin: '410px 410px', transition: 'transform 400ms cubic-bezier(.2,.7,.3,1)' }}>
        <path d={`M${C} ${C - 150}V${C - 404}`} stroke="currentColor" strokeWidth={detailed ? 2 : 6} />
        <circle cx={C} cy={C - 404} r={detailed ? 8 : 20} fill="var(--color-lume)" stroke="currentColor" strokeWidth={detailed ? 2 : 6} />
      </g>
    </svg>
  );
};
