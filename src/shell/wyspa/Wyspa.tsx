import React, { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BellRing, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { SESSION_LABEL, type SessionId } from '../../charts/pro/core/sessions';
import { alertBook, askNotifications, parsePriceInput, primeAlertSound } from '../../charts/pro/chart/alerts';
import { lang, tr } from '../../i18n';
import { useDesk } from '../../state/DeskContext';
import type { ViewId } from '../../state/types';
import { CopyButton } from '../../views/agents/CopyButton';
import { SKILL_RECIPES } from '../../views/agents/catalog';
import { NPX_COMMAND } from '../../views/agents/installLinks';
import { useZaloga } from './Dok';
import { addRule, clearLog, needsValue, pauseStore, removeRule, toggleRule, useLog, usePaused, useRules } from './magazyn';
import { KALIBRACJA, PERSONY, type Persona, type PersonaId, type PersonaState, type Preset, personaOf, personaState } from './persony';
import { Postac } from './Postac';
import { type GuardEvent, MAX_RULES, type Rule, type RuleKind } from './straznicy';
import { LABELS } from './useStraznicy';

/**
 * Panel załogi (wysuwa się z doku albo z przycisku w nagłówku): u góry cała załoga, niżej karta wybranej postaci — co
 * pilnuje, jak często naprawdę się odzywa (kalibracja z historii), źródło, jej reguły i gotowe warunki; Sufler podsuwa
 * pytania dla agenta AI przez serwer MCP. Bez kont i bez danych na serwerze; teksty opisują stan rynku, nie kierunek.
 */

/** Nazwy gotowych poleceń serwera MCP w kolejności przepisów skilla (od `hyperquant-mcp` 0.1.5; zgodność w teście). */
export const PROMPT_NAMES = ['prepare_session', 'session_now', 'review_session', 'check_level', 'market_note'] as const;

const KIND_LABEL: Record<RuleKind, string> = {
  poziom: tr('Poziom ceny', 'Price level'),
  pdh: tr('Przecięcie PDH', 'PDH cross'),
  pdl: tr('Przecięcie PDL', 'PDL cross'),
  sesja: tr('Otwarcie sesji', 'Session open'),
  funding: tr('Funding ponad próg', 'Funding above'),
  ruch: tr('Ruch w 15 min', 'Move in 15 min'),
  likwidacje: tr('Likwidacje w 5 min', 'Liquidations in 5 min'),
};

export function ruleText(r: Pick<Rule, 'kind' | 'value' | 'session'>): string {
  if (r.kind === 'poziom') return `${KIND_LABEL.poziom} ${LABELS.price(r.value!)}`;
  if (r.kind === 'sesja') return `${KIND_LABEL.sesja}: ${SESSION_LABEL[r.session!]}`;
  if (r.kind === 'funding') return tr(`Funding ≥ ${LABELS.pct(r.value!)} rocznie (w obie strony)`, `Funding ≥ ${LABELS.pct(r.value!)} per year (either sign)`);
  if (r.kind === 'ruch') return tr(`Ruch ceny ≥ ${LABELS.pct(r.value!)} w 15 min`, `Price move ≥ ${LABELS.pct(r.value!)} in 15 min`);
  if (r.kind === 'likwidacje') return tr(`Likwidacje ≥ ${LABELS.usd(r.value!)} w 5 min`, `Liquidations ≥ ${LABELS.usd(r.value!)} in 5 min`);
  return KIND_LABEL[r.kind];
}

const same = (r: Rule, p: Preset) => r.kind === p.kind && (p.session === undefined || r.session === p.session) && (p.value === undefined || r.value === p.value);

const CHIP = 'inline-flex items-center gap-1.5 min-h-10 px-3 rounded-full border border-line-strong bg-surface-2 text-[13px] text-ink-1 hover:bg-surface-3 transition-colors duration-150';
const FIELD = 'min-h-11 sm:min-h-10 rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink-1 focus-visible:outline-2 focus-visible:outline-accent';
const LABEL = 'text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3';

const hhmm = (t: number) => new Date(t).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });
const STATE_TEXT: Record<PersonaState, string> = { spi: tr('śpi', 'asleep'), czuwa: tr('czuwa', 'watching'), alarm: tr('zdarzenie', 'event') };

function usePermission(): [NotificationPermission | null, () => void] {
  const read = () => (typeof Notification === 'undefined' ? null : Notification.permission);
  const [p, setP] = useState(read);
  return [p, () => void askNotifications().then(() => setP(read()))];
}

/** Karta strażnika: opis, częstość, źródło, reguły tej postaci, gotowe warunki i własny próg. */
const KartaStraznika: React.FC<{ p: Persona; state: PersonaState }> = ({ p, state }) => {
  const { feed, cexEnabled, setCexEnabled } = useDesk();
  const rules = useRules();
  const mine = rules.filter((r) => p.kinds.includes(r.kind));
  const chartAlerts = useSyncExternalStore(alertBook.subscribe, alertBook.get, alertBook.get).length;
  const [perm, ask] = usePermission();
  const [text, setText] = useState('');
  const [session, setSession] = useState<SessionId>('london');
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const kind = p.kinds[0];
  const full = rules.length >= MAX_RULES;
  const presets = p.presets.filter((pr) => !rules.some((r) => same(r, pr)));

  const add = (k: RuleKind, opts: { value?: number; session?: SessionId }) => {
    primeAlertSound();
    if (perm === 'default') ask();
    if (!addRule(k, opts)) setError(full ? tr(`Najwyżej ${MAX_RULES} reguł dla całej załogi.`, `At most ${MAX_RULES} rules for the whole crew.`) : tr('Nie udało się dodać.', 'Could not add.'));
    else setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === 'sesja') return add('sesja', { session });
    const v = kind === 'poziom' ? parsePriceInput(text, feed.currentPrice) : Number(text.replace(/\s/g, '').replace(',', '.'));
    const value = v !== null && Number.isFinite(v) && v > 0 ? (kind === 'likwidacje' ? v * 1e6 : v) : undefined;
    if (value === undefined) return setError(tr('Wpisz liczbę większą od zera.', 'Enter a number above zero.'));
    add(kind, { value });
    setText('');
  };
  const unit = kind === 'poziom' ? '$' : kind === 'likwidacje' ? tr('mln $', '$M') : '%';
  const placeholder = kind === 'poziom' && Number.isFinite(feed.currentPrice) ? String(Math.round(feed.currentPrice / 100) * 100) : kind === 'likwidacje' ? '3' : kind === 'funding' ? '15' : '1';

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className={LABEL}>{tr('Jak często', 'How often')}</dt>
          <dd className="mt-1 text-[13px] leading-snug text-ink-1">
            {p.freq ?? tr('nie da się podać z historii', 'not available from history')}
            {p.freq && <span className="block text-[11px] text-ink-3">{tr(`MODEL · kalibracja z ${KALIBRACJA.dni} dni`, `MODEL · calibrated on ${KALIBRACJA.dni} days`)}</span>}
          </dd>
        </div>
        <div>
          <dt className={LABEL}>{tr('Kiedy działa', 'When it works')}</dt>
          <dd className="mt-1 text-[13px] leading-snug text-ink-2">
            {tr('przy otwartej karcie z danymi LIVE; karta w tle do minuty później, zablokowany telefon — wcale', 'while this tab is open with LIVE data; a background tab up to a minute late, a locked phone — not at all')}
          </dd>
        </div>
      </dl>
      {p.note && <p className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">{p.note}</p>}

      {p.id === 'iskra' && !cexEnabled && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-[13px] text-ink-1">
          <span className="min-w-0 flex-1">{tr('Iskra śpi: strumienie giełd są wyłączone.', 'Spark is asleep: the exchange streams are off.')}</span>
          <button type="button" onClick={() => setCexEnabled(true)} className={CHIP}>
            {tr('Włącz Binance, Bybit i OKX', 'Turn on Binance, Bybit and OKX')}
          </button>
        </div>
      )}

      {perm !== 'granted' && mine.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          <BellRing className="h-4 w-4 shrink-0 text-lume" aria-hidden="true" />
          {perm === 'default' ? (
            <>
              <span className="min-w-0 flex-1">{tr('Powiadomienia systemowe są wyłączone; zdarzenia zobaczysz w dymku nad dokiem.', 'System notifications are off; you will see events in a bubble above the dock.')}</span>
              <button type="button" onClick={ask} className={CHIP}>
                {tr('Włącz', 'Turn on')}
              </button>
            </>
          ) : (
            <span className="min-w-0 flex-1">{tr('Przeglądarka blokuje powiadomienia tej strony: zdarzenia zobaczysz w dymku nad dokiem.', 'The browser blocks notifications for this site: you will see events in a bubble above the dock.')}</span>
          )}
        </div>
      )}

      <section aria-labelledby={`${formId}-reguly`} className="flex flex-col gap-2">
        <h4 id={`${formId}-reguly`} className={LABEL}>
          {tr('Pilnuje', 'Watching')} <span className="font-mono tabular-nums">{mine.length}</span>
        </h4>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-3 text-[13px] text-ink-3">{state === 'spi' ? tr('Na razie śpi. Wybierz, czego ma pilnować.', 'Asleep for now. Choose what to watch.') : ''}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {mine.map((r) => (
              <li key={r.id} data-straznik={r.kind} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.on}
                  aria-label={tr(`${ruleText(r)}: ${r.on ? 'włączony' : 'wyłączony'}`, `${ruleText(r)}: ${r.on ? 'on' : 'off'}`)}
                  onClick={() => toggleRule(r.id)}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${r.on ? 'bg-lume' : 'bg-surface-3'}`}
                >
                  <span aria-hidden="true" className={`absolute top-1 h-4 w-4 rounded-full transition-[left] duration-150 ${r.on ? 'left-5 bg-page' : 'left-1 bg-ink-3'}`} />
                </button>
                <span className={`min-w-0 flex-1 text-sm ${r.on ? 'text-ink-1' : 'text-ink-3'}`}>{ruleText(r)}</span>
                <button type="button" aria-label={tr(`Usuń: ${ruleText(r)}`, `Remove: ${ruleText(r)}`)} onClick={() => removeRule(r.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink-1">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!full && presets.length > 0 && (
        <section aria-label={tr('Gotowe warunki', 'Ready conditions')} className="flex flex-wrap gap-2">
          {presets.map((pr) => (
            <button key={`${pr.kind}-${pr.session ?? pr.value ?? ''}`} type="button" onClick={() => add(pr.kind, pr)} className={CHIP}>
              <Plus className="h-3.5 w-3.5 text-lume" aria-hidden="true" />
              {ruleText(pr)}
            </button>
          ))}
        </section>
      )}

      {!full && kind !== 'pdh' && (
        <form onSubmit={submit} aria-label={tr('Własny warunek', 'Custom condition')} className="flex flex-wrap gap-2">
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
              <span className="sr-only">{KIND_LABEL[kind]}</span>
              <input
                inputMode="decimal"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={placeholder}
                aria-invalid={error !== null}
                aria-describedby={error ? `${formId}-blad` : undefined}
                className={`${FIELD} w-full min-w-0 font-mono tabular-nums`}
              />
              <span className="shrink-0 text-[13px] text-ink-3">{unit}</span>
            </label>
          )}
          <button type="submit" className="inline-flex min-h-11 sm:min-h-10 items-center gap-1.5 rounded-lg bg-lume px-4 text-sm font-semibold text-page hover:brightness-110">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {tr('Dodaj', 'Add')}
          </button>
        </form>
      )}
      {error && (
        <p id={`${formId}-blad`} role="alert" className="text-xs text-warn">
          {error}
        </p>
      )}

      {p.id === 'kotwicz' && (
        <p className="text-[13px] text-ink-3">
          {tr('Alarmy ceny na wykresie (24/7, zamknięcie świecy, powrót nad poziom):', 'Price alerts on the chart (24/7, candle close, reclaim):')}{' '}
          <a href="#charts" className="font-medium text-ink-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink-1">
            {chartAlerts > 0 ? tr(`ustawione: ${chartAlerts}`, `set: ${chartAlerts}`) : tr('ustaw w W sesji', 'set in In session')}
          </a>
        </p>
      )}
    </div>
  );
};

/** Karta Suflera: polecenie serwera MCP i przepisy (pytania do skopiowania, nazwa polecenia w serwerze). */
const KartaSuflera: React.FC<{ go: (v: ViewId) => void }> = ({ go }) => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <span className={LABEL}>{tr('Serwer MCP', 'MCP server')}</span>
      <code className="break-all font-mono text-[13px] text-ink-1">{NPX_COMMAND}</code>
      <CopyButton text={NPX_COMMAND} label={tr('Kopiuj polecenie', 'Copy command')} fallback={tr('Zaznacz polecenie i skopiuj ręcznie.', 'Select the command and copy it by hand.')} />
    </div>
    <section aria-label={tr('Przepisy', 'Recipes')} className="flex flex-col gap-2">
      <h4 className={LABEL}>{tr('Przepisy: zapytaj swojego agenta', 'Recipes: ask your agent')}</h4>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {SKILL_RECIPES.map((r, i) => (
          <li key={r.title.en} className="flex flex-col gap-2 p-3">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink-1">{r.title[lang]}</span>
              <code className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-3" title={tr('Gotowe polecenie w serwerze MCP', 'Ready-made prompt in the MCP server')}>
                {PROMPT_NAMES[i]}
              </code>
            </span>
            <span className="text-[13px] text-ink-2">„{r.ask[lang]}”</span>
            <CopyButton text={r.ask[lang]} label={tr('Kopiuj pytanie', 'Copy question')} fallback={tr('Zaznacz pytanie i skopiuj ręcznie.', 'Select the question and copy it by hand.')} />
          </li>
        ))}
      </ul>
    </section>
    <p className="text-[13px] text-ink-3">{tr('Agent działa u Ciebie: nie widzimy pytań ani odpowiedzi.', 'The agent runs on your side: we do not see the questions or answers.')}</p>
    <button type="button" onClick={() => go('agents')} className="self-start text-sm font-medium text-ink-1 underline decoration-line-strong underline-offset-4 hover:decoration-ink-1">
      {tr('Instalacja krok po kroku: Agenci AI', 'Step-by-step setup: AI agents')}
    </button>
  </div>
);

const Dziennik: React.FC = () => {
  const log = useLog();
  const id = useId();
  if (log.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 id={id} className={LABEL}>
          {tr('Dziennik załogi', 'Crew log')}
        </h4>
        <button type="button" onClick={clearLog} className="min-h-10 px-2 text-xs text-ink-3 underline underline-offset-2 hover:text-ink-1">
          {tr('Wyczyść', 'Clear')}
        </button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {log.map((e: GuardEvent, i) => {
          const p = personaOf(e.kind);
          return (
            <li key={`${e.ruleId}-${e.at}-${i}`} className="flex items-center gap-2.5 text-[13px] leading-snug">
              <Postac id={p.id} state="czuwa" size={22} className="postac-still" />
              <time dateTime={new Date(e.at).toISOString()} className="w-11 shrink-0 font-mono tabular-nums text-ink-3">
                {hhmm(e.at)}
              </time>
              <span className="min-w-0 text-ink-2">{e.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

const PANEL_W = 480;

/** Panel załogi: przy doku (komputer) albo od dołu ekranu nad dolnym paskiem (telefon). Esc i klik obok zamykają. */
export const Wyspa: React.FC<{
  open: boolean;
  onClose: () => void;
  go: (v: ViewId) => void;
  anchor: React.RefObject<HTMLElement | null>;
  persona?: PersonaId;
  flash: GuardEvent | null;
}> = ({ open, onClose, go, anchor, persona, flash }) => {
  const { crew } = useZaloga(flash);
  const rules = useRules();
  const paused = usePaused();
  const { feed, cexEnabled } = useDesk();
  const [sel, setSel] = useState<PersonaId>(persona ?? crew.find((c) => c.state !== 'spi' && c.p.id !== 'sufler')?.p.id ?? 'latarnik');
  useEffect(() => {
    if (persona) setSel(persona);
  }, [persona]);
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const titleId = useId();
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const opts = { paused, live: feed.dataStatus === 'LIVE', alarmIds: new Set(flash ? [flash.ruleId] : []), cex: cexEnabled };
  const stateOf = (p: Persona): PersonaState => (p.id === 'sufler' ? 'czuwa' : personaState(p, rules, opts));
  const cur = PERSONY.find((p) => p.id === sel)!;

  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchor.current;
    if (!open || !el || !a || window.innerWidth < 1024) return setPos(null);
    const r = a.getBoundingClientRect();
    // Szerokość docelowa (klasa w-[480px]); pomiar przed ustawieniem pozycji dałby szerokość wersji telefonu
    const w = PANEL_W;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    setPos(r.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - r.top + 12 } : { left, top: r.bottom + 12 });
  }, [open, anchor]);

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
      if (!ref.current?.contains(t) && !anchor.current?.contains(t) && !(t instanceof Element && t.closest('[data-dok]'))) onClose();
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
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={pos ?? undefined}
      className={`fixed z-50 flex flex-col overflow-hidden rounded-3xl border border-line-strong bg-surface-1 shadow-2xl outline-none ${
        pos ? 'w-[480px] max-h-[min(78dvh,720px)]' : 'inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] max-h-[calc(100dvh-var(--hq-header-h,7rem)-5rem)]'
      }`}
    >
      {/* Załoga: wszystkie postacie z nazwą i stanem; wybrana ma kartę niżej */}
      <div className="flex items-start gap-2 border-b border-line bg-[radial-gradient(120%_90%_at_50%_0%,color-mix(in_oklab,var(--color-lume)_9%,transparent),transparent_70%)] px-3 pt-3">
        <div role="tablist" aria-label={tr('Załoga', 'Crew')} className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
          {PERSONY.map((p) => {
            const st = stateOf(p);
            const on = p.id === sel;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-zaloga-postac={p.id}
                onClick={() => setSel(p.id)}
                className={`flex w-[66px] shrink-0 flex-col items-center gap-1 rounded-2xl px-1 pb-1.5 pt-1 transition-colors duration-150 ${on ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
              >
                <Postac id={p.id} state={st} size={44} />
                <span className={`max-w-full truncate text-[11px] font-medium ${on ? 'text-ink-1' : 'text-ink-3'}`}>{p.name}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label={tr('Zamknij załogę', 'Close the crew')}
          onClick={() => {
            onClose();
            anchor.current?.focus();
          }}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink-1"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div role="tabpanel" aria-labelledby={titleId} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Postac id={cur.id} state={stateOf(cur)} size={84} />
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-2xl font-bold leading-none tracking-tight [font-stretch:90%] text-ink-1">
              {cur.name}
            </h2>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{cur.id === 'sufler' ? tr('agent AI · MCP', 'AI agent · MCP') : STATE_TEXT[stateOf(cur)]}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{cur.role}</p>
          </div>
        </div>
        {cur.id === 'sufler' ? <KartaSuflera go={(v) => (onClose(), go(v))} /> : <KartaStraznika p={cur} state={stateOf(cur)} />}
        <Dziennik />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2">
        <p className="text-[11px] text-ink-3">{tr('Reguły i dziennik tylko na tym urządzeniu. Opis stanu rynku, nie porada.', 'Rules and the log stay on this device. Market state, not advice.')}</p>
        {rules.length > 0 && (
          <button type="button" aria-pressed={paused} onClick={() => pauseStore.set(!paused)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink-1">
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            {paused ? tr('Obudź załogę', 'Wake the crew') : tr('Uśpij załogę', 'Put the crew to sleep')}
          </button>
        )}
      </div>
    </motion.div>
  );
};
