import React, { useState, useSyncExternalStore } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import { Segmented } from '../../../ui';
import { fmtDm, fmtHm, fmtHms } from '../core/time';
import { REPLAY_SPEEDS, type ReplaySession, type ReplaySpeed } from './session';

const SPEED_OPTIONS = REPLAY_SPEEDS.map((s) => ({ value: s, label: `${s}×`, title: `${s} × szybciej niż na żywo` }));

/**
 * Pasek powtórki nad wykresem: start i pauza, tempo, suwak chwili w zakresie nagrania i powrót na żywo. Suwak przewija
 * po puszczeniu (przewinięcie wstecz buduje wykres od nowa), w trakcie przeciągania pokazuje tylko czas.
 */
export const ReplayBar: React.FC<{ session: ReplaySession; narrow: boolean; onExit: () => void }> = ({ session, narrow, onExit }) => {
  useSyncExternalStore(session.subscribe, () => session.version);
  const [drag, setDrag] = useState<number | null>(null);
  const t = drag ?? session.t;
  const commit = () => {
    if (drag === null) return;
    session.seek(drag);
    setDrag(null);
  };
  const toggle = () => (session.playing ? session.pause() : session.play());
  const when = `${fmtDm(t)} ${fmtHms(t)}`;
  const range = `${fmtHm(session.from)}–${fmtHm(session.to)}`;

  const playBtn = (
    <button
      type="button"
      onClick={toggle}
      aria-label={session.playing ? 'Pauza' : 'Odtwarzaj'}
      title={session.playing ? 'Pauza' : 'Odtwarzaj nagranie od tej chwili'}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors duration-150"
    >
      {session.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
    </button>
  );
  const slider = (
    <input
      type="range"
      aria-label="Chwila nagrania"
      aria-valuetext={when}
      min={session.from}
      max={session.to}
      step={1000}
      value={t}
      onChange={(e) => setDrag(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      className="flex-1 min-w-0 h-8 accent-accent cursor-pointer"
    />
  );
  const liveBtn = (
    <button
      type="button"
      onClick={onExit}
      title="Wróć do wykresu na żywo"
      className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150"
    >
      <Radio className="w-4 h-4" />
      Na żywo
    </button>
  );
  const clock = (
    <span className="shrink-0 font-mono text-[11px] text-ink-1 tabular-nums" title={`Chwila nagrania (czas lokalny); nagranie ${range}`}>
      {narrow ? fmtHms(t) : when}
    </span>
  );

  if (narrow)
    return (
      <div className="shrink-0 border-b border-line px-2 py-1">
        <div className="flex items-center gap-1.5">
          {playBtn}
          {clock}
          <label className="ml-auto shrink-0">
            <span className="sr-only">Tempo odtwarzania</span>
            <select
              value={session.speed}
              onChange={(e) => session.setSpeed(Number(e.target.value) as ReplaySpeed)}
              className="h-8 rounded-lg border border-line bg-page px-1.5 text-xs text-ink-1"
            >
              {SPEED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {liveBtn}
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] text-ink-3">{fmtHm(session.from)}</span>
          {slider}
          <span className="shrink-0 font-mono text-[10px] text-ink-3">{fmtHm(session.to)}</span>
        </div>
      </div>
    );

  return (
    <div className="flex items-center gap-2 px-2 sm:px-3 h-10 shrink-0 border-b border-line min-w-0">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent" title="Powtórka nagranej taśmy i arkusza Hyperliquid — dane z przeszłości, nie na żywo">
        Powtórka
      </span>
      {playBtn}
      <Segmented<ReplaySpeed> ariaLabel="Tempo odtwarzania" value={session.speed} onChange={(s) => session.setSpeed(s)} options={SPEED_OPTIONS} size="xs" />
      {clock}
      <span className="shrink-0 font-mono text-[10px] text-ink-3">{fmtHm(session.from)}</span>
      {slider}
      <span className="shrink-0 font-mono text-[10px] text-ink-3">{fmtHm(session.to)}</span>
      {liveBtn}
    </div>
  );
};
