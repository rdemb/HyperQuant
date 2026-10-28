import React, { useEffect, useState } from 'react';
import { fetchCandles } from '../../charts/pro/hl/rest';
import { tr } from '../../i18n';
import { SchrodiCat } from './SchrodiCat';
import { SchrodiPanel, moodOf } from './SchrodiPanel';
import { useSchrodi } from './useSchrodi';

/**
 * Kot w pasku stanu pod wykresem (nie zasłania świec ani wskaźników): mały Schrödi z dwiema liczbami (duży ruch,
 * kierunek); kliknięcie otwiera dymek nad paskiem. Prognoza dotyczy zawsze BTC na najbliższą godzinę, niezależnie od
 * rynku na wykresie.
 */

const MIN = 60_000;
const STALE_MS = 15 * MIN;
const pct = (p: number) => Math.round(p * 100);

export const SchrodiLauncher: React.FC<{ className?: string }> = ({ className }) => {
  const st = useSchrodi();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Bieżąca cena BTC do poziomów: zamknięcie ostatniej świecy 1m, co 15 s, tylko przy otwartym dymku
  const [livePx, setLivePx] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const pull = async () => {
      const xs = await fetchCandles('BTC', '1m', Date.now() - 3 * MIN);
      const c = xs[xs.length - 1]?.c;
      if (alive && c && c > 0) setLivePx(c);
    };
    void pull();
    const id = setInterval(() => void pull(), 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);
  const f = st.status === 'ready' ? st.f : null;
  const stale = st.status !== 'ready' || now - st.at > STALE_MS;
  const mood = moodOf(f, now, stale);
  const dir = f ? (f.stance === 'long' ? `LONG ${pct(f.pUp)}%` : f.stance === 'short' ? `SHORT ${pct(1 - f.pUp)}%` : tr('kierunek ?', 'direction ?')) : '';
  return (
    <div className={`relative ${className ?? ''}`}>
      {open && st.status === 'ready' && (
        <div className="absolute bottom-full left-0 mb-1.5 z-40 w-[min(340px,calc(100vw-32px))] max-h-[min(560px,calc(100dvh-15rem))] overflow-y-auto rounded-xl shadow-2xl">
          <SchrodiPanel f={st.f} model={st.model} at={st.at} now={now} stale={stale} livePx={livePx} onClose={() => setOpen(false)} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={st.status !== 'ready'}
        aria-expanded={open}
        aria-label={tr('Schrödi: prognoza ruchu i kierunku BTC na godzinę', 'Schrödi: BTC move and direction forecast for the hour')}
        title={
          st.status === 'loading'
            ? tr('Schrödi liczy…', 'Schrödi is thinking…')
            : st.status === 'error'
              ? tr('Schrödi nie ma danych', 'Schrödi has no data')
              : tr('Schrödi: kliknij, żeby zobaczyć prognozę', 'Schrödi: click to see the forecast')
        }
        className={`flex items-center gap-1.5 h-7 pl-0.5 pr-2 rounded-md font-mono text-[10px] leading-none transition-colors duration-150 hover:bg-surface-2 disabled:opacity-60 ${
          open ? 'bg-surface-2' : ''
        }`}
      >
        <SchrodiCat pUp={f?.pUp ?? null} mood={mood} size={26} beat={f?.t} />
        {f && !stale ? (
          <span className="whitespace-nowrap">
            <span className="font-semibold text-accent">
              {tr('ruch', 'move')} {pct(f.pBig)}%
            </span>
            <span className="text-ink-3"> · </span>
            <span className={f.stance === 'long' ? 'text-buy-ink' : f.stance === 'short' ? 'text-sell-ink' : 'text-ink-3'}>{dir}</span>
          </span>
        ) : (
          <span className="text-ink-3">Schrödi</span>
        )}
      </button>
    </div>
  );
};
