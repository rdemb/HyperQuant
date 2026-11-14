import React from 'react';
import { SESSION_LABEL } from '../charts/pro/core/sessions';
import { lang, tr } from '../i18n';
import { fmtSpan, localDayStart, localDaySegments, sessionClock, useNow } from './dzien';

/**
 * Pasek dnia (element rozpoznawczy powłoki): doba 00–24 czasu lokalnego pod nagłówkiem w każdym widoku. Sesje BTC
 * (Azja, Londyn, Nowy Jork) jako pasma: przeszłe wyciszone, bieżąca wypełniona do „teraz” (lume), nadchodzące obrysem.
 * Obok: bieżąca sesja z czasem trwania i odliczanie do następnej. Zegar, nie dane rynku: bez znaku pochodzenia.
 */
const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';
const SKROT: Record<string, string> = { asia: tr('Azja', 'Asia'), london: tr('Londyn', 'London'), ny: 'NY' };

const godzina = (ms: number) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

export const PasekDnia: React.FC = () => {
  const now = useNow(30_000);
  const clock = sessionClock(now);
  const teraz = (now - localDayStart(now)) / 86_400_000;
  const odcinki = localDaySegments(now);
  const opis = `${tr('Teraz', 'Now')}: ${SESSION_LABEL[clock.current.id]}, ${fmtSpan(clock.elapsed)}. ${SESSION_LABEL[clock.next.id]} ${tr('za', 'in')} ${fmtSpan(clock.untilNext)}. ${tr('Godzina', 'Time')} ${godzina(now)}`;

  return (
    <div data-pasek-dnia role="group" aria-label={opis} className="flex items-center gap-3 px-4 lg:px-6 h-8 border-t border-line/70 text-[11px] leading-none">
      <p aria-hidden="true" className="shrink-0 flex items-center gap-1.5 text-ink-2">
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inset-0 rounded-full bg-lume motion-safe:animate-ping opacity-60" />
          <span className="relative w-1.5 h-1.5 rounded-full bg-lume" />
        </span>
        <span className="font-semibold text-ink-1">{SESSION_LABEL[clock.current.id]}</span>
        <span className="font-mono tabular-nums text-ink-3">{fmtSpan(clock.elapsed)}</span>
      </p>

      {/* Oś doby: pasma sesji (nazwy od 1024 px) i znacznik „teraz” */}
      <div aria-hidden="true" className="relative flex-1 min-w-0 h-full">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 lg:h-3.5 rounded-full bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line)] overflow-hidden">
          {odcinki.map((o) => {
            const przeszly = o.to <= teraz;
            const biezacy = o.from <= teraz && teraz < o.to;
            return (
              <div
                key={`${o.id}-${o.from}`}
                data-sesja={o.id}
                className={`absolute inset-y-0 border-x border-page/60 ${przeszly ? 'bg-ink-3/20' : biezacy ? 'bg-surface-3' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]'}`}
                style={{ left: pct(o.from), width: pct(o.to - o.from) }}
              >
                {biezacy && <div className="absolute inset-y-0 left-0 bg-lume/40 border-r-2 border-lume" style={{ width: pct((teraz - o.from) / (o.to - o.from)) }} />}
                {o.to - o.from > 0.12 && (
                  <span className={`hidden lg:flex absolute inset-0 items-center px-2 font-mono text-[9px] font-semibold uppercase tracking-wider ${biezacy ? 'text-ink-1' : 'text-ink-3'}`}>{SKROT[o.id]}</span>
                )}
              </div>
            );
          })}
        </div>
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 lg:h-6 rounded-full bg-lume shadow-[0_0_8px_var(--color-lume)] motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-out" style={{ left: pct(teraz) }} />
      </div>

      <p aria-hidden="true" className="hidden sm:flex shrink-0 items-center gap-1.5 text-ink-3">
        <span>
          {SESSION_LABEL[clock.next.id]} {tr('za', 'in')}
        </span>
        <span className="font-mono tabular-nums text-ink-2">{fmtSpan(clock.untilNext)}</span>
        <span className="hidden md:inline text-line-strong">·</span>
        <span className="hidden md:inline font-mono tabular-nums text-ink-2">{godzina(now)}</span>
      </p>
    </div>
  );
};
