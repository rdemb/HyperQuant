import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SESSION_LABEL } from '../../charts/pro/core/sessions';
import { lang, tr } from '../../i18n';
import { daySessions, fmtSpan, localHour, sessionClock, useNow } from '../../shell/dzien';
import { useDesk } from '../../state/DeskContext';
import { baseOpens } from '../../utils/underlying';
import './zegarDoby.css';

/**
 * Chronograf doby w „Dziś”: tarcza 24 h w czasie lokalnym z sesjami BTC jak na wykresie (Azja od 00:00 UTC, Londyn od
 * 08:00 czasu Londynu, Nowy Jork od 09:30 czasu Nowego Jorku). Co się rusza i dlaczego:
 *  - wskazówka doby obraca się płynnie (animacja CSS zsynchronizowana z zegarem, bez renderów Reacta) i ciągnie za sobą
 *    świetlisty ogon ostatnich 90 minut;
 *  - kropka sekund okrąża środek raz na minutę, a odczyt w środku podaje godzinę z sekundami;
 *  - bieżąca sesja jest wypełniona do „teraz” z płynącym przez nią światłem, pierścień w środku pokazuje jej postęp;
 *  - każda nowa cena BTC z Hyperliquid wysyła z końca wskazówki falę (bez kierunku ceny: ta sama dla wzrostu i spadku).
 * Ograniczony ruch: tarcza stoi, odświeża się co 30 s, bez fal i ogona w ruchu. To zegar, nie dane rynku.
 */

const C = 410;
const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';

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

const dwa = (n: number) => String(n).padStart(2, '0');
const odliczanie = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${dwa(Math.floor(s / 3600))}:${dwa(Math.floor((s % 3600) / 60))}:${dwa(s % 60)}`;
};

function ruchOgraniczony(): boolean {
  return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Sekundy doby według wskazań zegara (godzina × 3600 + minuty × 60 + sekundy), nie milisekundy od północy: w dni zmiany
 * czasu (marzec, październik) doba ma 23 albo 25 godzin i upływ od północy przesunąłby wskazówkę o godzinę.
 */
export const sekundyDoby = (t: number) => localHour(t) * 3600 + (new Date(t).getMilliseconds() / 1000);
/** Kąt wskazówki doby w stopniach (0 = północ u góry) z godziny zegarowej. */
export const katDoby = (t: number) => (localHour(t) / 24) * 360;

/** Ograniczony ruch na żywo: zmiana ustawienia systemu albo HyperQuant w trakcie oglądania działa od razu. */
function useRuchOgraniczony(): boolean {
  const [v, setV] = useState(ruchOgraniczony);
  useEffect(() => {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const sprawdz = () => setV(ruchOgraniczony());
    mq?.addEventListener('change', sprawdz);
    const obs = new MutationObserver(sprawdz);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => {
      mq?.removeEventListener('change', sprawdz);
      obs.disconnect();
    };
  }, []);
  return v;
}

/** Odczyt w środku tarczy: jedyna część odświeżana co sekundę (osobny komponent, reszta tarczy co 30 s). */
const Odczyt: React.FC = () => {
  const now = useNow(1000);
  const d = new Date(now);
  const clock = sessionClock(now);
  const postep = Math.min(1, Math.max(0, clock.elapsed / (clock.current.end - clock.current.start)));
  const R = 196;
  const obwod = 2 * Math.PI * R;
  return (
    <g data-zegar-odczyt>
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-line)" strokeWidth={8} />
      <circle
        className="hq-zegar-postep"
        cx={C}
        cy={C}
        r={R}
        fill="none"
        stroke="var(--z-sesja)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${(postep * obwod).toFixed(1)} ${obwod.toFixed(1)}`}
        transform={`rotate(-90 ${C} ${C})`}
      />
      <text x={C} y={C - 70} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={24} fontWeight={700} letterSpacing={3} fill="var(--color-ink-2)">
        {SESSION_LABEL[clock.current.id].toUpperCase()} · {Math.round(postep * 100)}%
      </text>
      <text x={C} y={C + 34} textAnchor="middle" fontFamily="var(--font-display)" fontSize={112} fontWeight={800} letterSpacing={-4} fill="var(--color-ink-1)" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {dwa(d.getHours())}:{dwa(d.getMinutes())}
        <tspan fontSize={44} fontWeight={700} letterSpacing={0} dx={6} fill="var(--z-sesja)" className="hq-zegar-sekundy">
          {dwa(d.getSeconds())}
        </tspan>
      </text>
      <text x={C} y={C + 92} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={24} fill="var(--color-ink-2)">
        {SESSION_LABEL[clock.next.id]} {tr('za', 'in')} <tspan fill="var(--color-ink-1)" fontWeight={700}>{odliczanie(clock.untilNext)}</tspan>
      </text>
    </g>
  );
};

/** Fala z końca wskazówki przy każdej nowej cenie BTC (najwyżej jedna na 700 ms). */
function useFalaCeny(cel: React.RefObject<SVGGElement | null>, wylaczona: boolean) {
  const { feed } = useDesk();
  const cena = feed.currentPrice;
  const poprzednia = useRef<number | null>(null);
  const ostatnia = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(cena)) return;
    const byla = poprzednia.current;
    poprzednia.current = cena;
    if (wylaczona || byla === null || byla === cena || document.hidden) return;
    const t = performance.now();
    if (t - ostatnia.current < 700) return;
    ostatnia.current = t;
    const g = cel.current;
    if (!g || typeof g.animate !== 'function') return;
    const fala = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fala.setAttribute('cx', String(C));
    fala.setAttribute('cy', String(C - 398));
    fala.setAttribute('r', '10');
    fala.setAttribute('class', 'hq-zegar-fala');
    g.appendChild(fala);
    const a = fala.animate([{ transform: 'scale(1)', opacity: 0.85 }, { transform: 'scale(5.5)', opacity: 0 }], { duration: 1300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    a.onfinish = () => fala.remove();
  }, [cena, wylaczona, cel]);
}

export const ZegarDoby: React.FC<{ className?: string }> = ({ className = '' }) => {
  const now = useNow(30_000);
  const wylaczony = useRuchOgraniczony();
  // Przesunięcie animacji liczone przy montowaniu i po powrocie do karty (zegar systemowy mógł się zmienić)
  const [start, setStart] = useState(() => Date.now());
  useEffect(() => {
    const onVis = () => !document.hidden && setStart(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const koniec = useRef<SVGGElement>(null);
  useFalaCeny(koniec, wylaczony);

  const nowH = localHour(now);
  const clock = sessionClock(now);
  const sesje = daySessions(now);
  const { kreski, glowne } = useMemo(() => {
    const k: string[] = [];
    const g: string[] = [];
    for (let q = 0; q < 96; q++) {
      const major = q % 24 === 0;
      const [x0, y0] = P(386, q / 4);
      const [x1, y1] = P(major ? 350 : q % 4 === 0 ? 364 : 378, q / 4);
      (major ? g : k).push(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`);
    }
    return { kreski: k.join(''), glowne: g.join('') };
  }, []);
  const opoznienieDoby = -sekundyDoby(start);
  const opoznienieMinuty = -((start / 1000) % 60);
  const obrot = katDoby(now);
  const godz = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const opis = tr(
    `Zegar doby, czas lokalny ${godz.format(now)}. ${SESSION_LABEL[clock.current.id]} trwa ${fmtSpan(clock.elapsed)}, ${SESSION_LABEL[clock.next.id]} za ${fmtSpan(clock.untilNext)}. Znaczniki: otwarcie NYSE i sesji CME.`,
    `Day clock, local time ${godz.format(now)}. ${SESSION_LABEL[clock.current.id]} running for ${fmtSpan(clock.elapsed)}, ${SESSION_LABEL[clock.next.id]} in ${fmtSpan(clock.untilNext)}. Marks: NYSE and CME session opens.`
  );
  const otwarcia = baseOpens(now);

  return (
    <div data-zegar-doby className={`hq-zegar relative aspect-square ${className}`} data-ruch={wylaczony ? 'stop' : 'tak'}>
      {/* Ogon wskazówki: stożkowy gradient w pierścieniu podziałki, obracany razem ze wskazówką */}
      <div
        aria-hidden="true"
        className="hq-zegar-ogon absolute inset-0 rounded-full"
        style={{ transform: `rotate(${obrot}deg)`, animationDelay: `${opoznienieDoby}s` }}
      />
      <svg viewBox="0 0 820 820" role="img" aria-label={opis} className="relative block w-full h-full text-ink-1">
        <defs>
          <radialGradient id="hq-zegar-tlo" cx="50%" cy="38%" r="70%">
            <stop offset="0%" stopColor="color-mix(in oklab, var(--color-surface-2) 92%, var(--color-lume))" />
            <stop offset="100%" stopColor="var(--color-page)" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={398} fill="url(#hq-zegar-tlo)" fillOpacity={0.55} stroke="var(--color-line-strong)" strokeWidth={1.5} />
        {/* Upływ doby: łuk od północy do „teraz” na obwodzie */}
        <path d={arc(398, 0, nowH)} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
        <path d={kreski} stroke="var(--color-line-strong)" strokeWidth={1.2} />
        <path d={glowne} stroke="currentColor" strokeWidth={2.5} />
        {Array.from({ length: 24 }, (_, h) => {
          const [x, y] = P(330, h);
          const duza = h % 6 === 0;
          const minela = h <= nowH;
          return (
            <text
              key={h}
              x={x}
              y={y + (duza ? 8 : 6)}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={duza ? 24 : 16}
              fontWeight={duza ? 700 : 500}
              fill={duza ? 'var(--color-ink-1)' : minela ? 'var(--color-ink-2)' : 'var(--color-ink-3)'}
            >
              {dwa(h)}
            </text>
          );
        })}
        {/* Sesje BTC: przeszłe wyciszone, bieżąca wypełniona do „teraz” z płynącym światłem, nadchodzące obrysem */}
        <circle cx={C} cy={C} r={290} fill="none" stroke="var(--color-line)" strokeWidth={22} strokeOpacity={0.5} />
        {sesje.map((s) => {
          const h0 = localHour(s.start);
          const h1 = localHour(s.end);
          if (s.end <= now) return <path key={s.id} d={arc(290, h0, h1)} fill="none" stroke="var(--color-ink-3)" strokeOpacity={0.45} strokeWidth={22} />;
          if (s.start <= now)
            return (
              <g key={s.id} data-zegar-biezaca={s.id}>
                <path d={arc(290, h0, h1)} fill="none" stroke="var(--z-sesja)" strokeOpacity={0.18} strokeWidth={22} />
                <path d={arc(290, h0, nowH)} fill="none" stroke="var(--z-sesja)" strokeWidth={22} />
                <path className="hq-zegar-plyn" d={arc(290, h0, nowH)} fill="none" stroke="var(--color-page)" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="2 22" />
              </g>
            );
          return (
            <g key={s.id} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.7}>
              <path d={arc(279, h0, h1)} />
              <path d={arc(301, h0, h1)} />
            </g>
          );
        })}
        {sesje.map((s) => {
          const h0 = localHour(s.start);
          let h1 = localHour(s.end);
          if (h1 <= h0) h1 += 24;
          const [lx, ly] = P(242, (h0 + h1) / 2);
          const [ox0, oy0] = P(266, h0);
          const [ox1, oy1] = P(314, h0);
          const biezaca = s.id === clock.current.id;
          return (
            <g key={`l-${s.id}`}>
              <text x={lx} y={ly + 7} textAnchor="middle" fontSize={19} fontWeight={800} letterSpacing={1.6} fill={biezaca ? 'var(--color-ink-1)' : 'var(--color-ink-3)'}>
                {SESSION_LABEL[s.id].toUpperCase()}
              </text>
              <path d={`M${ox0} ${oy0}L${ox1} ${oy1}`} stroke="currentColor" strokeWidth={2} />
            </g>
          );
        })}
        {(
          [
            ['NYSE', localHour(otwarcia.nyse)],
            ['CME', localHour(otwarcia.cme)],
          ] as const
        ).map(([k, h]) => {
          const [x0, y0] = P(304, h);
          const [x1, y1] = P(326, h);
          return (
            <g key={k} data-tarcza-znacznik={k}>
              <path d={`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`} stroke="var(--color-lume)" strokeWidth={4} strokeLinecap="round" />
            </g>
          );
        })}
        <Odczyt />
        {/* Kropka sekund: jeden obieg na minutę po pierścieniu postępu sesji */}
        <g
          aria-hidden="true"
          className="hq-zegar-minuta"
          style={wylaczony ? { display: 'none' } : { animationDelay: `${opoznienieMinuty}s`, transformOrigin: `${C}px ${C}px` }}
        >
          <circle cx={C} cy={C - 196} r={7} fill="var(--color-ink-1)" stroke="var(--color-page)" strokeWidth={3} />
        </g>
        {/* Wskazówka doby z falą ceny na końcu */}
        <g
          aria-hidden="true"
          className="hq-zegar-wskazowka"
          style={{ transform: `rotate(${obrot}deg)`, animationDelay: `${opoznienieDoby}s`, transformOrigin: `${C}px ${C}px` }}
        >
          <path d={`M${C} ${C - 214}V${C - 398}`} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
          <g ref={koniec} />
          <circle cx={C} cy={C - 398} r={13} fill="var(--color-lume)" stroke="currentColor" strokeWidth={3} />
        </g>
      </svg>
    </div>
  );
};
