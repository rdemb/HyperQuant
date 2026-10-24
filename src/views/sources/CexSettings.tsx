import React, { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useDesk } from '../../state/DeskContext';
import { CEX_ADAPTERS } from '../../utils/cexAdapters';
import { Badge, DUR, EASE_IN, EASE_OUT, Panel } from '../../ui';
import { lang, locale, tr } from '../../i18n';

/** Przełącznik (role="switch") z celem dotyku ≥ 44 px. */
const Toggle: React.FC<{ checked: boolean; onChange: () => void; label: React.ReactNode; hint?: React.ReactNode; describedBy?: string }> = ({
  checked,
  onChange,
  label,
  hint,
  describedBy,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-describedby={describedBy}
    onClick={onChange}
    className="w-full min-h-11 flex items-center justify-between gap-3 text-left rounded-lg px-1 -mx-1 hover:bg-surface-2 transition-colors duration-150"
  >
    <span className="min-w-0">
      <span className="block text-sm font-medium text-ink-1">{label}</span>
      {hint && <span className="block text-xs text-ink-3 leading-snug mt-0.5">{hint}</span>}
    </span>
    <span
      aria-hidden="true"
      className={`relative shrink-0 w-10 h-6 rounded-full border transition-colors duration-150 ${
        checked ? 'bg-accent/25 border-accent' : 'bg-surface-3 border-line-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4.5 h-4.5 rounded-full transition-transform duration-200 ease-out-quint motion-reduce:transition-none ${
          checked ? 'translate-x-[18px] bg-accent' : 'translate-x-0.5 bg-ink-3'
        }`}
      />
    </span>
  </button>
);

type VenueView = { icon: React.ReactNode; text: string; tone: string };

/** Stan połączenia zawsze jako ikona + etykieta (kolor nie jest jedynym nośnikiem). */
function venueView(state: string | undefined, enabled: boolean, paused: boolean, silentForMs: number | null): VenueView {
  if (!enabled) return { icon: <MinusCircle className="w-3.5 h-3.5" />, text: tr('wyłączone', 'off'), tone: 'text-ink-3' };
  if (paused) return { icon: <MinusCircle className="w-3.5 h-3.5" />, text: tr('wstrzymane', 'paused'), tone: 'text-ink-3' };
  if (state === 'open') {
    if (silentForMs !== null && silentForMs > 60000)
      return { icon: <AlertTriangle className="w-3.5 h-3.5" />, text: tr('połączono, brak transakcji > 60 s', 'connected, no trades > 60 s'), tone: 'text-warn' };
    return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: tr('połączono', 'connected'), tone: 'text-good' };
  }
  if (state === 'closed') return { icon: <XCircle className="w-3.5 h-3.5" />, text: tr('rozłączono — ponawiam', 'disconnected — retrying'), tone: 'text-critical' };
  return { icon: <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />, text: tr('łączenie…', 'connecting…'), tone: 'text-warn' };
}

/** Ustawienia: opt-in strumieni CEX (z wyjaśnieniem przed włączeniem), status per giełda, dźwięk taśmy. */
export const CexSettings: React.FC = () => {
  const { feed, cexEnabled, setCexEnabled, audioEnabled, setAudioEnabled } = useDesk();
  const reduce = useReducedMotion();
  const [confirming, setConfirming] = useState(false);
  const explainId = useId();
  const paused = !feed.isStreaming;

  const onToggleCex = () => {
    if (cexEnabled) {
      setCexEnabled(false);
      return;
    }
    setConfirming((c) => !c);
  };

  return (
    <Panel eyebrow={tr('Ustawienia', 'Settings')} title={tr('Źródła i dźwięk', 'Sources and sound')} hero bodyClassName="px-4 py-3 flex flex-col gap-3">
      <Toggle
        checked={cexEnabled}
        onChange={onToggleCex}
        describedBy={confirming ? explainId : undefined}
        label={tr('Moje źródła CEX (opt-in, tylko w tej przeglądarce)', 'My CEX sources (opt-in, this browser only)')}
        hint={tr(
          'Binance, Bybit, OKX, Coinbase — realne transakcje i likwidacje BTC na taśmie i w wolumenie świec.',
          'Binance, Bybit, OKX, Coinbase — real BTC trades and liquidations on the tape and in candle volume.'
        )}
      />

      <AnimatePresence initial={false}>
        {confirming && !cexEnabled && (
          <motion.div
            key="confirm"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1, transition: { duration: 0.12 } } : { opacity: 1, height: 'auto', transition: { duration: DUR.ui, ease: EASE_OUT } }}
            exit={reduce ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, height: 0, transition: { duration: DUR.uiExit, ease: EASE_IN } }}
            className="overflow-hidden"
          >
            <div id={explainId} className="rounded-lg border border-line-strong bg-surface-2 p-3 text-xs text-ink-2 leading-relaxed flex flex-col gap-2">
              {lang === 'en' ? (
                <>
                  <p>
                    <span className="text-ink-1 font-medium">Your browser fetches the data</span> — directly from the exchanges' public APIs, for your
                    personal use. Nothing goes through a HyperQuant server and nothing is stored anywhere.
                  </p>
                  <p>
                    Some exchanges' terms forbid showing their data publicly, so the public version has this option
                    <span className="text-ink-1"> off by default</span>. Do not share screenshots or streams with this data without checking that
                    exchange's terms.
                  </p>
                  <p>Some exchanges block connections from certain countries — the status then stays "disconnected".</p>
                  <p className="text-ink-3">This is not legal advice.</p>
                </>
              ) : (
                <>
                  <p>
                    <span className="text-ink-1 font-medium">Dane pobiera Twoja przeglądarka</span> — bezpośrednio z publicznych API giełd, do Twojego
                    użytku osobistego. Nic nie przechodzi przez serwer HyperQuant ani nie jest nigdzie zapisywane.
                  </p>
                  <p>
                    Regulaminy części giełd zabraniają publicznego pokazywania ich danych, dlatego wersja publiczna ma tę opcję
                    <span className="text-ink-1"> domyślnie wyłączoną</span>. Nie udostępniaj zrzutów ani streamów z tymi danymi bez sprawdzenia regulaminu
                    danej giełdy.
                  </p>
                  <p>Niektóre giełdy blokują połączenia z wybranych krajów — wtedy status pozostanie „rozłączono”.</p>
                  <p className="text-ink-3">To nie jest porada prawna.</p>
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setCexEnabled(true);
                    setConfirming(false);
                  }}
                  className="min-h-11 sm:min-h-9 px-3 rounded-lg bg-accent/15 border border-accent/50 text-ink-1 text-sm font-medium hover:bg-accent/25 transition-colors duration-150"
                >
                  {tr('Rozumiem, włącz', 'I understand, enable')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-11 sm:min-h-9 px-3 rounded-lg border border-line-strong text-ink-2 text-sm hover:text-ink-1 hover:bg-surface-3 transition-colors duration-150"
                >
                  {tr('Anuluj', 'Cancel')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1.5">{tr('Połączenia', 'Connections')}</div>
        <ul className="divide-y divide-line border border-line rounded-lg">
          {CEX_ADAPTERS.map((a) => {
            const state = feed.cex.venues[a.id];
            const last = feed.cex.lastTickAt[a.id];
            const silentFor = state === 'open' && last !== undefined ? feed.nowTick - last : null;
            const v = venueView(state, cexEnabled, paused, silentFor);
            const n = feed.cex.received[a.id];
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="min-w-0">
                  <span className="text-ink-1 font-medium">{a.label}</span>
                  <span className="ml-1.5 text-ink-3">{a.isPerp ? 'perp' : 'spot'}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {cexEnabled && n !== undefined && (
                    <span className="font-mono tabular-nums text-ink-2" title={tr('Realne transakcje odebrane od włączenia', 'Real trades received since enabling')}>
                      {n.toLocaleString(locale)} {tr('tr.', 'trades')}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 ${v.tone}`}>
                    {v.icon}
                    <span>{v.text}</span>
                  </span>
                  {state === 'open' && n !== undefined && <Badge tone="live">LIVE</Badge>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-ink-3 leading-snug mt-1.5">
          {paused
            ? tr('Strumień desku jest wstrzymany — połączenia CEX są zamknięte do wznowienia.', 'The desk stream is paused — CEX connections stay closed until it resumes.')
            : tr(
                'Ustawienie zapisane w tej przeglądarce. Drobne transakcje (poniżej progu Aggr) są sumowane w paczkach co 250 ms; duże i likwidacje — pojedynczo.',
                'Setting saved in this browser. Small trades (below the Aggr threshold) are summed in 250 ms batches; large trades and liquidations — one by one.'
              )}
        </p>
      </div>

      <div className="border-t border-line pt-2">
        <Toggle
          checked={audioEnabled}
          onChange={() => setAudioEnabled(!audioEnabled)}
          label={tr('Dźwięk taśmy', 'Tape sound')}
          hint={tr('Krótki ton dla transakcji i likwidacji powyżej progu Aggr. Domyślnie wyłączony.', 'A short tone for trades and liquidations above the Aggr threshold. Off by default.')}
        />
      </div>
    </Panel>
  );
};
