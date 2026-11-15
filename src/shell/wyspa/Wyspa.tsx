import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BellRing, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { SESSION_LABEL, type SessionId } from '../../charts/pro/core/sessions';
import { alertBook, askNotifications, parsePriceInput, primeAlertSound } from '../../charts/pro/chart/alerts';
import { lang, tr } from '../../i18n';
import { useDesk } from '../../state/DeskContext';
import type { ViewId } from '../../state/types';
import { Segmented } from '../../ui';
import { CopyButton } from '../../views/agents/CopyButton';
import { SKILL_RECIPES } from '../../views/agents/catalog';
import { NPX_COMMAND } from '../../views/agents/installLinks';
import { addRule, clearLog, needsValue, pauseStore, removeRule, toggleRule, useLog, usePaused, useRules } from './magazyn';
import { MAX_RULES, type Rule, type RuleKind } from './straznicy';
import { LABELS } from './useStraznicy';

/**
 * Wyspa (wysuwany panel z nagłówka): strażnicy BTC liczeni w tej karcie i przepisy dla własnego agenta AI przez serwer
 * MCP. Bez kont i bez danych na serwerze; teksty opisują stan rynku, nie kierunek.
 */

type Tab = 'straznicy' | 'agenci';

const KIND_LABEL: Record<RuleKind, string> = {
  poziom: tr('Poziom ceny', 'Price level'),
  pdh: tr('Przecięcie PDH', 'PDH cross'),
  pdl: tr('Przecięcie PDL', 'PDL cross'),
  sesja: tr('Otwarcie sesji', 'Session open'),
  funding: tr('Funding ponad próg', 'Funding above'),
  ruch: tr('Ruch w 15 min', 'Move in 15 min'),
  likwidacje: tr('Likwidacje w 5 min', 'Liquidations in 5 min'),
};

/** Opis reguły w liście: rodzaj i wartość. */
function ruleText(r: Rule): string {
  if (r.kind === 'poziom') return `${KIND_LABEL.poziom} ${LABELS.price(r.value!)}`;
  if (r.kind === 'sesja') return `${KIND_LABEL.sesja}: ${SESSION_LABEL[r.session!]}`;
  if (r.kind === 'funding') return tr(`Funding ≥ ${LABELS.pct(r.value!)} rocznie (w obie strony)`, `Funding ≥ ${LABELS.pct(r.value!)} per year (either sign)`);
  if (r.kind === 'ruch') return tr(`Ruch ceny ≥ ${LABELS.pct(r.value!)} w 15 min`, `Price move ≥ ${LABELS.pct(r.value!)} in 15 min`);
  if (r.kind === 'likwidacje') return tr(`Likwidacje ≥ ${LABELS.usd(r.value!)} w 5 min`, `Liquidations ≥ ${LABELS.usd(r.value!)} in 5 min`);
  return KIND_LABEL[r.kind];
}

/** Gotowe warunki jednym dotknięciem (próg można potem zastąpić własnym). */
const PRESETS: { kind: RuleKind; value?: number; session?: SessionId }[] = [
  { kind: 'pdh' },
  { kind: 'pdl' },
  { kind: 'sesja', session: 'london' },
  { kind: 'sesja', session: 'ny' },
  { kind: 'funding', value: 25 },
  { kind: 'ruch', value: 1 },
  { kind: 'likwidacje', value: 3_000_000 },
];

const same = (r: Rule, p: (typeof PRESETS)[number]) => r.kind === p.kind && (p.session === undefined || r.session === p.session) && (p.value === undefined || r.value === p.value);

const CHIP =
  'inline-flex items-center gap-1.5 min-h-10 px-3 rounded-full border border-line-strong bg-surface-2 text-[13px] text-ink-1 hover:bg-surface-3 transition-colors duration-150';
const FIELD = 'min-h-11 sm:min-h-10 rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink-1 focus-visible:outline-2 focus-visible:outline-accent';

const hhmm = (t: number) => new Date(t).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });

/** Stan zgody na powiadomienia (bez API — null). */
function usePermission(): [NotificationPermission | null, () => void] {
  const read = () => (typeof Notification === 'undefined' ? null : Notification.permission);
  const [p, setP] = useState(read);
  return [p, () => void askNotifications().then(() => setP(read()))];
}

const Straznicy: React.FC = () => {
  const { feed } = useDesk();
  const rules = useRules();
  const log = useLog();
  const paused = usePaused();
  const chartAlerts = useSyncExternalStore(alertBook.subscribe, alertBook.get, alertBook.get).length;
  const [perm, ask] = usePermission();
  const [kind, setKind] = useState<RuleKind>('poziom');
  const [text, setText] = useState('');
  const [session, setSession] = useState<SessionId>('london');
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const full = rules.length >= MAX_RULES;
  const presets = PRESETS.filter((p) => !rules.some((r) => same(r, p)));

  const add = (k: RuleKind, opts: { value?: number; session?: SessionId }) => {
    primeAlertSound();
    if (perm === 'default') ask();
    return addRule(k, opts);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let value: number | undefined;
    if (needsValue(kind)) {
      const v = kind === 'poziom' ? parsePriceInput(text, feed.currentPrice) : Number(text.replace(/\s/g, '').replace(',', '.'));
      value = v !== null && Number.isFinite(v) && v > 0 ? (kind === 'likwidacje' ? v * 1e6 : v) : undefined;
      if (value === undefined) return setError(tr('Wpisz liczbę większą od zera.', 'Enter a number above zero.'));
    }
    if (!add(kind, { value, session })) return setError(full ? tr(`Najwyżej ${MAX_RULES} strażników.`, `At most ${MAX_RULES} guards.`) : tr('Nie udało się dodać.', 'Could not add.'));
    setText('');
    setError(null);
  };

  const unit = kind === 'poziom' ? '$' : kind === 'likwidacje' ? tr('mln $', '$M') : '%';

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-ink-2">
        {tr(
          'Strażnicy patrzą na BTC, dopóki ta karta jest otwarta (karta w tle sprawdza rzadziej). Reguły i dziennik zostają tylko na tym urządzeniu.',
          'Guards watch BTC while this tab is open (a background tab checks less often). Rules and the log stay on this device only.'
        )}
      </p>

      {perm !== 'granted' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          <BellRing className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {perm === 'default' ? (
            <>
              <span className="min-w-0 flex-1">{tr('Powiadomienia systemowe są wyłączone.', 'System notifications are off.')}</span>
              <button type="button" onClick={ask} className={CHIP}>
                {tr('Włącz', 'Turn on')}
              </button>
            </>
          ) : (
            <span className="min-w-0 flex-1">
              {perm === 'denied'
                ? tr('Przeglądarka blokuje powiadomienia tej strony: zdarzenia zobaczysz tu i w rogu ekranu.', 'The browser blocks notifications for this site: you will see events here and in the corner of the screen.')
                : tr('Ta przeglądarka nie ma powiadomień: zdarzenia zobaczysz tu i w rogu ekranu.', 'This browser has no notifications: you will see events here and in the corner of the screen.')}
            </span>
          )}
        </div>
      )}

      <section aria-labelledby={`${formId}-lista`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${formId}-lista`} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            {tr('Twoi strażnicy', 'Your guards')} <span className="font-mono tabular-nums">{`${rules.length}/${MAX_RULES}`}</span>
          </h3>
          {rules.length > 0 && (
            <button type="button" aria-pressed={paused} onClick={() => pauseStore.set(!paused)} className={CHIP}>
              {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
              {paused ? tr('Wznów wszystkich', 'Resume all') : tr('Wstrzymaj wszystkich', 'Pause all')}
            </button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-3">{tr('Nic nie pilnuje. Wybierz gotowy warunek poniżej albo dodaj własny.', 'Nothing is being watched. Pick a ready condition below or add your own.')}</p>
        ) : (
          <ul className={`flex flex-col divide-y divide-line rounded-xl border border-line ${paused ? 'opacity-60' : ''}`}>
            {rules.map((r) => (
              <li key={r.id} data-straznik={r.kind} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.on}
                  aria-label={tr(`${ruleText(r)}: ${r.on ? 'włączony' : 'wyłączony'}`, `${ruleText(r)}: ${r.on ? 'on' : 'off'}`)}
                  onClick={() => toggleRule(r.id)}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${r.on ? 'bg-accent' : 'bg-surface-3'}`}
                >
                  <span aria-hidden="true" className={`absolute top-1 h-4 w-4 rounded-full transition-[left] duration-150 ${r.on ? 'left-5 bg-page' : 'left-1 bg-ink-3'}`} />
                </button>
                <span className={`min-w-0 flex-1 text-sm ${r.on ? 'text-ink-1' : 'text-ink-3'}`}>{ruleText(r)}</span>
                <button
                  type="button"
                  aria-label={tr(`Usuń: ${ruleText(r)}`, `Remove: ${ruleText(r)}`)}
                  onClick={() => removeRule(r.id)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink-1"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!full && presets.length > 0 && (
        <section aria-label={tr('Gotowe warunki', 'Ready conditions')} className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const r = { id: '', on: true, ...p } as Rule;
            return (
              <button key={`${p.kind}-${p.session ?? p.value ?? ''}`} type="button" onClick={() => add(p.kind, p)} className={CHIP}>
                <Plus className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                {ruleText(r)}
              </button>
            );
          })}
        </section>
      )}

      {!full && (
        <form onSubmit={submit} aria-label={tr('Własny strażnik', 'Custom guard')} className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select aria-label={tr('Rodzaj', 'Kind')} value={kind} onChange={(e) => (setKind(e.target.value as RuleKind), setError(null))} className={`${FIELD} min-w-0 flex-1`}>
              {(['poziom', 'funding', 'ruch', 'likwidacje', 'sesja'] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {kind === 'sesja' ? (
              <select aria-label={tr('Sesja', 'Session')} value={session} onChange={(e) => setSession(e.target.value as SessionId)} className={`${FIELD} min-w-0 flex-1`}>
                {(['asia', 'london', 'ny'] as const).map((s) => (
                  <option key={s} value={s}>
                    {SESSION_LABEL[s]}
                  </option>
                ))}
              </select>
            ) : (
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <span className="sr-only">{tr('Wartość', 'Value')}</span>
                <input
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={kind === 'poziom' && Number.isFinite(feed.currentPrice) ? String(Math.round(feed.currentPrice / 100) * 100) : kind === 'likwidacje' ? '3' : '1'}
                  aria-invalid={error !== null}
                  aria-describedby={error ? `${formId}-blad` : undefined}
                  className={`${FIELD} w-full min-w-0 font-mono tabular-nums`}
                />
                <span className="shrink-0 text-[13px] text-ink-3">{unit}</span>
              </label>
            )}
            <button type="submit" className="inline-flex min-h-11 sm:min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-page hover:brightness-110">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {tr('Dodaj', 'Add')}
            </button>
          </div>
          {error && (
            <p id={`${formId}-blad`} role="alert" className="text-xs text-warn">
              {error}
            </p>
          )}
        </form>
      )}

      <p className="text-[13px] text-ink-3">
        {tr('Alarmy cenowe na wykresie (zamknięcie świecy, powrót nad poziom):', 'Price alerts on the chart (candle close, reclaim):')}{' '}
        <a href="#charts" className="font-medium text-ink-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink-1">
          {chartAlerts > 0 ? tr(`ustawione: ${chartAlerts}`, `set: ${chartAlerts}`) : tr('ustaw w W sesji', 'set in In session')}
        </a>
      </p>

      <section aria-labelledby={`${formId}-dziennik`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${formId}-dziennik`} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            {tr('Dziennik', 'Log')}
          </h3>
          {log.length > 0 && (
            <button type="button" onClick={clearLog} className="min-h-10 px-2 text-xs text-ink-3 underline underline-offset-2 hover:text-ink-1">
              {tr('Wyczyść', 'Clear')}
            </button>
          )}
        </div>
        {log.length === 0 ? (
          <p className="text-[13px] text-ink-3">{tr('Jeszcze bez zdarzeń.', 'No events yet.')}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {log.map((e, i) => (
              <li key={`${e.ruleId}-${e.at}-${i}`} className="flex gap-3 text-[13px] leading-snug">
                <time dateTime={new Date(e.at).toISOString()} className="w-11 shrink-0 font-mono tabular-nums text-ink-3">
                  {hhmm(e.at)}
                </time>
                <span className="min-w-0 text-ink-2">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

const Agenci: React.FC<{ go: (v: ViewId) => void }> = ({ go }) => (
  <div className="flex flex-col gap-5">
    <p className="text-[13px] leading-relaxed text-ink-2">
      {tr(
        'Twój agent AI (Claude, ChatGPT, OpenBot i inne) czyta dane HyperQuant przez serwer MCP. Działa u Ciebie: nie widzimy pytań ani odpowiedzi.',
        'Your AI agent (Claude, ChatGPT, OpenBot and others) reads HyperQuant data through the MCP server. It runs on your side: we do not see the questions or answers.'
      )}
    </p>
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Serwer MCP', 'MCP server')}</span>
      <code className="break-all font-mono text-[13px] text-ink-1">{NPX_COMMAND}</code>
      <CopyButton text={NPX_COMMAND} label={tr('Kopiuj polecenie', 'Copy command')} fallback={tr('Zaznacz polecenie i skopiuj ręcznie.', 'Select the command and copy it by hand.')} />
    </div>
    <section aria-label={tr('Przepisy', 'Recipes')} className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Przepisy: zapytaj agenta', 'Recipes: ask your agent')}</h3>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {SKILL_RECIPES.map((r) => (
          <li key={r.title.en} className="flex flex-col gap-2 p-3">
            <span className="text-sm font-medium text-ink-1">{r.title[lang]}</span>
            <span className="text-[13px] text-ink-2">„{r.ask[lang]}”</span>
            <span className="flex flex-wrap gap-1">
              {r.tools.map((t) => (
                <code key={t} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-3">
                  {t}
                </code>
              ))}
            </span>
            <CopyButton text={r.ask[lang]} label={tr('Kopiuj pytanie', 'Copy question')} fallback={tr('Zaznacz pytanie i skopiuj ręcznie.', 'Select the question and copy it by hand.')} />
          </li>
        ))}
      </ul>
    </section>
    <button type="button" onClick={() => go('agents')} className="self-start text-sm font-medium text-ink-1 underline decoration-line-strong underline-offset-4 hover:decoration-ink-1">
      {tr('Instalacja krok po kroku: Agenci AI', 'Step-by-step setup: AI agents')}
    </button>
  </div>
);

/** Panel wyspy: pod nagłówkiem po prawej (komputer), nad dolnym paskiem (telefon). Esc i klik obok zamykają. */
export const Wyspa: React.FC<{ open: boolean; onClose: () => void; go: (v: ViewId) => void; anchor: React.RefObject<HTMLElement | null> }> = ({ open, onClose, go, anchor }) => {
  const [tab, setTab] = useState<Tab>('straznicy');
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <motion.div
      ref={ref}
      data-wyspa
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="fixed z-50 inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] max-h-[calc(100dvh-var(--hq-header-h,7rem)-5rem)] lg:inset-x-auto lg:bottom-auto lg:right-6 lg:top-[calc(var(--hq-header-h,6.5rem)+0.5rem)] lg:w-[420px] lg:max-h-[calc(100dvh-var(--hq-header-h,6.5rem)-1.5rem)] flex flex-col rounded-2xl border border-line-strong bg-surface-1 shadow-2xl outline-none origin-top-right"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 id={titleId} className="font-display text-lg font-bold tracking-tight [font-stretch:90%] text-ink-1">
          {tr('Wyspa', 'Island')}
        </h2>
        <div className="min-w-0 flex-1">
          <Segmented<Tab>
            ariaLabel={tr('Zakładka wyspy', 'Island tab')}
            size="xs"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'straznicy', label: tr('Strażnicy', 'Guards') },
              { value: 'agenci', label: tr('Agenci AI', 'AI agents') },
            ]}
          />
        </div>
        <button
          type="button"
          aria-label={tr('Zamknij wyspę', 'Close island')}
          onClick={() => {
            onClose();
            anchor.current?.focus();
          }}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink-1"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {tab === 'straznicy' ? (
          <Straznicy />
        ) : (
          <Agenci
            go={(v) => {
              onClose();
              go(v);
            }}
          />
        )}
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">{tr('Opis stanu rynku, nie porada inwestycyjna.', 'A description of market state, not investment advice.')}</p>
    </motion.div>
  );
};
