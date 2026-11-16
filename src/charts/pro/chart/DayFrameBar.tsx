import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Badge, DASH, sourceTag } from '../../../ui';
import { scrollFadeRef } from '../../../ui/scrollFade';
import { fmtHm } from '../core/time';
import type { ProStore } from '../store/proStore';
import { type FrameChip, type FrameInput, FRAME_RULES, frameChips, stateDistribution } from './dayFrameText';
import { frameInputOf } from './layoutInputs';
import { shiftIntoView } from './LayoutHeader';
import { isAbsent, pctOf } from '../../../utils/sessionText';
import { tr } from '../../../i18n';

/**
 * Pasek „Rama dnia” pod paskiem wykresu (Fabio runda 2, krok 1): wartość dziś wobec wczorajszej VA, stan aukcji
 * (przyjęcie poza wartością) z częstością o tej porze, status IVB i szerokość IVB wobec 20 sesji. Jedna linia z liczbami
 * i plakietkami; na wąskim ekranie przewijana w bok. Dotknięcie rozwija źródła, zamrożone reguły i rozkład stanów o tej
 * porze. Przeliczany co 5 s (na starcie co sekundę, gdy świece dopiero dochodzą). Opis, nie prognoza.
 */

const EVERY_MS = 5_000;
const WAIT_MS = 1_000;

const Tag: React.FC<{ n: FrameChip }> = ({ n }) => {
  const t = sourceTag(n);
  return t ? (
    <Badge tone={t.tone} size="sm">
      {t.text}
    </Badge>
  ) : null;
};

export const DayFrameBar: React.FC<{ store: ProStore; narrow: boolean; minutes: number }> = ({ store, narrow, minutes }) => {
  const [input, setInput] = useState<FrameInput>(() => ({ coin: store.coin, now: Date.now(), frame: undefined }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logged = useRef(false);

  useEffect(() => {
    let timer = 0;
    const run = () => {
      window.clearTimeout(timer);
      let next = EVERY_MS;
      try {
        const x = frameInputOf(store, minutes);
        setInput(x);
        if (x.frame === undefined) next = WAIT_MS;
      } catch (e) {
        // Zły ładunek świec: pasek zostaje z ostatnimi dobrymi liczbami, wpis w konsoli raz
        if (!logged.current) {
          logged.current = true;
          console.error('[HyperQuant] Rama dnia: błąd liczenia — zostają ostatnie dobre liczby albo „—”', e);
        }
      } finally {
        timer = window.setTimeout(run, next);
      }
    };
    run();
    return () => window.clearTimeout(timer);
  }, [store, minutes]);

  // Rozwinięcie zamyka dotknięcie obok i Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const detailsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = detailsRef.current;
    if (!open || !el) return;
    const place = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const dx = shiftIntoView(r.left, r.right, document.documentElement.clientWidth);
      el.style.transform = dx ? `translateX(${dx}px)` : '';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const chips = frameChips(input, minutes);
  const frame = input.frame !== undefined && !isAbsent(input.frame) ? input.frame : null;
  const dist = frame && !input.historyWhy ? stateDistribution(frame.history) : [];
  const minutesSince = frame ? Math.max(0, Math.floor((input.now - frame.anchor.from) / 60_000)) : 0;
  const title = tr('Rama dnia', 'Day frame');

  return (
    <div ref={ref} data-rama-dnia="" className="relative shrink-0 border-b border-line">
      {/* Jedna linia: przewijana w bok (krawędź z dalszą treścią wygasa), cała linia rozwija źródła */}
      <div ref={scrollFadeRef} className="hq-fade-x min-w-0 overflow-x-auto [scrollbar-width:none]">
        <button
          type="button"
          aria-expanded={open}
          aria-label={tr(`${title}: ${chips.map((c) => `${c.label} ${c.value}`).join(', ')}. Rozwiń źródła i reguły`, `${title}: ${chips.map((c) => `${c.label} ${c.value}`).join(', ')}. Expand sources and rules`)}
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center whitespace-nowrap text-left min-w-full w-max hover:bg-surface-2/60 transition-colors duration-150 ${narrow ? 'h-9 gap-x-2.5 px-1.5' : 'h-8 gap-x-3.5 px-2 sm:px-3'}`}
        >
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-2">
            <Info className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
            {title}
          </span>
          {chips.map((c) => (
            <span key={c.id} data-rama-liczba="" title={c.hint} className="shrink-0 inline-flex items-center gap-1.5 leading-none">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{narrow ? c.short : c.label}</span>
              <span className={`${/\d/.test(c.value) ? 'font-mono tabular-nums text-[11.5px]' : 'text-[11px]'} ${c.value === DASH ? 'text-ink-3' : 'text-ink-1'}`}>{c.value}</span>
              <Tag n={c} />
            </span>
          ))}
        </button>
      </div>
      {open && (
        <div
          ref={detailsRef}
          data-rama-opis=""
          className="absolute left-2 right-2 sm:right-auto sm:w-[36rem] top-full mt-1 z-40 max-h-[calc(100dvh-22rem)] sm:max-h-[60vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-3 shadow-2xl text-xs"
        >
          <p className="text-ink-1 leading-snug">
            {tr(
              'Gdzie dziś leży cena wobec wczorajszej wartości i zakresu otwarcia NY: opis tego, co już się stało.',
              "Where price sits today against yesterday's value and the NY opening range: a description of what has already happened."
            )}
          </p>
          <dl className="mt-2.5 flex flex-col gap-2">
            {chips.map((c) => (
              <div key={c.id}>
                <dt className="flex items-center gap-1.5 font-medium text-ink-1">
                  {c.label}: <span className="font-mono tabular-nums font-normal">{c.value}</span>
                  <Tag n={c} />
                </dt>
                <dd className="mt-0.5 leading-snug text-ink-3">{c.hint}</dd>
              </div>
            ))}
          </dl>
          {dist.length > 0 && frame && (
            <div className="mt-2.5">
              <p className="font-medium text-ink-1">
                {tr(
                  `Stany ${minutesSince} min po ${frame.anchor.session ? 'otwarciu sesji' : '00:00 UTC'} (${fmtHm(input.now)}) w ${frame.history.n} poprzednich dobach`,
                  `States ${minutesSince} min after ${frame.anchor.session ? 'the session open' : '00:00 UTC'} (${fmtHm(input.now)}) over the previous ${frame.history.n} days`
                )}
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ink-2">
                {dist.map((d) => (
                  <li key={d.key}>
                    {d.label} <span className="font-mono tabular-nums">{pctOf(d.share)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2.5 text-[10.5px] leading-snug text-ink-3">{FRAME_RULES}</p>
          <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
            {tr(
              `Liczby z danych tego wykresu (${input.coin}), odświeżane co 5 s. LIVE — fakty ze świec i taśmy Hyperliquid, MODEL — wynik reguły z jej nazwą albo wartość przybliżona ze świec. To opis, nie rekomendacja.`,
              `Numbers from this chart's data (${input.coin}), refreshed every 5 s. LIVE is a fact from Hyperliquid candles and tape, MODEL a rule output with its name or a value approximated from candles. A description, not a recommendation.`
            )}
          </p>
        </div>
      )}
    </div>
  );
};
