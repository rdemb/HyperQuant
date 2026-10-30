import React, { useState, useSyncExternalStore } from 'react';
import { Bell, Pencil, Trash2, Volume2, X } from 'lucide-react';
import { Segmented } from '../../../ui';
import { lang, tr } from '../../../i18n';
import { ALERT_INTERVALS, type AlertKind, DEFAULT_TTL_MS, NOTE_MAX, defaultDir, eventBody, ruleText } from '../../../utils/alertRules';
import { fmtHm, fmtSince } from '../core/time';
import { fmtPx } from './layout';
import { type AlertSpec, MAX_ALERTS, type PriceAlert, alertBook, alertLog, askNotifications, newAlert, parsePriceInput, primeAlertSound, removeAlert, windowOf } from './alerts';
import { testAlert } from './alertWatch';
import { PUSH_MAX, disablePush, enablePush, pushNeedsHomeScreen, usePushStatus } from './pushAlerts';

/** Cena z wykresu, od której zaczyna formularz (menu pod prawym przyciskiem albo zaznaczona linia pozioma). */
export interface AlertDraft {
  price: number;
  kind: AlertKind;
}

const KIND_OPTIONS: { value: AlertKind; label: string; title: string }[] = [
  { value: 'touch', label: tr('Dotknięcie', 'Touch'), title: tr('Pierwsza transakcja na poziomie', 'The first trade at the level') },
  { value: 'close', label: tr('Zamknięcie', 'Close'), title: tr('Świeca zamknięta nad albo pod poziomem', 'A candle closes above or below the level') },
  { value: 'reclaim', label: tr('Powrót', 'Reclaim'), title: tr('Wyjście za poziom, potem zamknięcie z powrotem', 'A move through the level, then a close back') },
  { value: 'squeeze', label: tr('Wyciskanie', 'Squeeze'), title: tr('Gwałtowny ruch, gdy pozycje są zamykane (spadek OI)', 'A sharp move while positions close (falling OI)') },
];
const IV_OPTIONS = ALERT_INTERVALS.map((iv) => ({ value: iv as string, label: iv }));
const CLOSES_OPTIONS = [1, 2, 3].map((n) => ({ value: n, label: `${n}×`, title: tr(`${n} zamknięcia z rzędu`, `${n} closes in a row`) }));
const SQUEEZE_DIRS = [
  { value: 1 as const, label: tr('W górę', 'Up'), title: tr('Zamykane shorty', 'Shorts closing') },
  { value: -1 as const, label: tr('W dół', 'Down'), title: tr('Zamykane longi', 'Longs closing') },
];
/** Próg wyciskania wpisany ręcznie: „1”, „1,2” albo „1.2 %”, od 0,2 do 10. */
function parsePct(text: string): number | null {
  const v = Number(text.replace(/[\s%]/g, '').replace(',', '.'));
  return Number.isFinite(v) && v >= 0.2 && v <= 10 ? v : null;
}
const fmtPct = (v: number): string => (lang === 'en' ? v.toFixed(1) : v.toFixed(1).replace('.', ','));

/** Panel alarmów: nowy alarm (warunek, cena, świeca, filtry, okno, łańcuch, para, opis), lista do edycji, historia i powiadomienia. */
export const AlertsMenu: React.FC<{ coin: string; price: number; draft: AlertDraft | null; serverNow: () => number }> = ({ coin, price, draft, serverNow }) => {
  const alerts = useSyncExternalStore(alertBook.subscribe, alertBook.get);
  const log = useSyncExternalStore(alertLog.subscribe, alertLog.get);
  const [kind, setKind] = useState<AlertKind>(draft?.kind ?? 'touch');
  const [text, setText] = useState(draft ? fmtPx(draft.price) : '');
  const [iv, setIv] = useState('15m');
  const [dirPick, setDirPick] = useState<1 | -1 | null>(null);
  const [closes, setCloses] = useState(1);
  const [delta, setDelta] = useState(false);
  const [fromHm, setFromHm] = useState('');
  const [untilHm, setUntilHm] = useState('');
  const [pairWith, setPairWith] = useState('');
  const [note, setNote] = useState('');
  const [afterId, setAfterId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'none'>(() => ('Notification' in window ? Notification.permission : 'none'));
  const push = usePushStatus();

  const squeeze = kind === 'squeeze';
  const candle = kind === 'close' || kind === 'reclaim';
  const value = squeeze ? parsePct(text) : parsePriceInput(text, price);
  const autoDir = value !== null && price > 0 && !squeeze ? defaultDir(kind, value, price) : 1;
  const dir = kind === 'touch' ? autoDir : (dirPick ?? autoDir);
  const spec = value !== null ? { kind, dir, price: value, iv, closes: candle ? closes : 1, delta: candle && delta } : null;
  const partners = alerts.filter((a) => a.coin === coin && a.id !== editing);
  // Warunek już spełniony przy obecnej cenie: zamknięcie zadziała przy najbliższej świecy, powrót czeka tylko na zamknięcie
  const already = spec && price > 0 && candle && (kind === 'close' ? (dir === 1 ? price > spec.price : price < spec.price) : dir === 1 ? price < spec.price : price > spec.price);

  const reset = () => {
    setText(squeeze ? fmtPct(1) : '');
    setDirPick(null);
    setEditing(null);
    setPairWith('');
    setNote('');
    setAfterId('');
  };

  const save = () => {
    if (!spec) return;
    const now = serverNow();
    const [from, until] = windowOf(fromHm, untilHm, Date.now());
    const other = alerts.find((a) => a.id === pairWith);
    const pair = other ? other.pair || `p${now.toString(36)}` : editing ? (alerts.find((a) => a.id === editing)?.pair ?? '') : '';
    const full: AlertSpec = { ...spec, coin, from, until, pair, note: note.trim(), after: alerts.some((a) => a.id === afterId) ? afterId : '' };
    alertBook.update((l) => {
      const out = l.map((a) => (other && a.id === other.id ? { ...a, pair } : a));
      return editing ? out.map((a) => (a.id === editing ? { ...newAlert(full, now), id: editing } : a)) : [...out, newAlert(full, now)].slice(-MAX_ALERTS);
    });
    primeAlertSound();
    void askNotifications().then((p) => p && setPerm(p));
    reset();
  };

  const edit = (a: PriceAlert) => {
    setEditing(a.id);
    setKind(a.kind);
    setText(a.kind === 'squeeze' ? fmtPct(a.price) : fmtPx(a.price));
    setIv(a.iv);
    setDirPick(a.dir);
    setCloses(a.closes);
    setDelta(a.delta);
    setFromHm(a.from > a.created + 60_000 ? fmtHm(a.from) : '');
    setUntilHm(a.until - a.created < DEFAULT_TTL_MS - 60_000 ? fmtHm(a.until) : '');
    setPairWith(a.pair ? (alerts.find((b) => b.pair === a.pair && b.id !== a.id)?.id ?? '') : '');
    setNote(a.note);
    setAfterId(a.after);
  };

  const dirOptions =
    kind === 'close'
      ? [
          { value: 1 as const, label: tr('Nad', 'Above') },
          { value: -1 as const, label: tr('Pod', 'Below') },
        ]
      : [
          { value: 1 as const, label: tr('Powrót nad', 'Back above'), title: tr('Po zejściu pod poziom', 'After a dip below the level') },
          { value: -1 as const, label: tr('Powrót pod', 'Back below'), title: tr('Po wyjściu nad poziom', 'After a move above the level') },
        ];

  return (
    <div className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-xs">
      <Section title={editing ? tr('Zmiana alarmu', 'Edit alert') : tr(`Nowy alarm · ${coin}`, `New alert · ${coin}`)}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Segmented<AlertKind> ariaLabel={tr('Warunek alarmu', 'Alert condition')} value={kind}
            onChange={(k) => {
              // Próg wyciskania w % zamiast ceny: pole dostaje wartość domyślną albo wraca puste
              if (k === 'squeeze') setText(fmtPct(1));
              else if (squeeze) setText('');
              setKind(k);
              setDirPick(null);
            }}
            options={KIND_OPTIONS} size="xs" cols={2} />
          {squeeze ? (
            <Row label={tr('Ruch w 10 min', 'Move within 10 min')}>
              <span className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={tr(`Próg ruchu ${coin} w 10 min, %`, `${coin} move within 10 min, %`)}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="h-8 w-20 px-2 rounded-md bg-page border border-line font-mono text-right text-ink-1 focus:outline-none focus:border-line-strong"
                />
                <span className="text-ink-2">%</span>
              </span>
            </Row>
          ) : (
            <input
              type="text"
              inputMode="decimal"
              aria-label={tr(`Cena alarmu ${coin}`, `${coin} alert price`)}
              placeholder={price > 0 ? `${tr('Poziom', 'Level')} · ${tr('teraz', 'now')} ${fmtPx(price)}` : tr(`Cena ${coin}`, `${coin} price`)}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-9 px-2.5 rounded-lg bg-surface-1 border border-line font-mono text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
            />
          )}
          {squeeze && (
            <Row label={tr('Kierunek', 'Direction')}>
              <Segmented<1 | -1> ariaLabel={tr('Kierunek', 'Direction')} value={dir} onChange={setDirPick} options={SQUEEZE_DIRS} size="xs" />
            </Row>
          )}
          {candle && (
            <>
              <Row label={tr('Świeca', 'Candle')}>
                <Segmented<string> ariaLabel={tr('Interwał świecy', 'Candle timeframe')} value={iv} onChange={setIv} options={IV_OPTIONS} size="xs" />
              </Row>
              <Row label={tr('Kierunek', 'Direction')}>
                <Segmented<1 | -1> ariaLabel={tr('Kierunek', 'Direction')} value={dir} onChange={setDirPick} options={dirOptions} size="xs" />
              </Row>
              <Row label={tr('Zamknięcia z rzędu', 'Closes in a row')}>
                <Segmented<number> ariaLabel={tr('Zamknięcia z rzędu', 'Closes in a row')} value={closes} onChange={setCloses} options={CLOSES_OPTIONS} size="xs" />
              </Row>
              <label className="flex items-center gap-2.5 min-h-8 cursor-pointer text-ink-1">
                <input type="checkbox" checked={delta} onChange={(e) => setDelta(e.target.checked)} className="w-4 h-4 accent-accent" />
                {dir === 1 ? tr('Tylko przy dodatniej delcie świecy', 'Only with positive candle delta') : tr('Tylko przy ujemnej delcie świecy', 'Only with negative candle delta')}
              </label>
            </>
          )}
          <Row label={tr('Aktywny', 'Active')}>
            <span className="flex items-center gap-1">
              <TimeInput label={tr('Od godziny', 'From')} value={fromHm} onChange={setFromHm} />
              <span className="text-ink-3">–</span>
              <TimeInput label={tr('Do godziny', 'Until')} value={untilHm} onChange={setUntilHm} />
            </span>
          </Row>
          {partners.length > 0 && (
            <Row label={tr('Aktywny po', 'Active after')}>
              <select
                aria-label={tr('Alarm czeka, aż uruchomi się wybrany alarm', 'The alert waits until the chosen alert fires')}
                value={afterId}
                onChange={(e) => setAfterId(e.target.value)}
                className="h-8 max-w-44 bg-page border border-line rounded-md px-1.5 text-ink-1"
              >
                <option value="">{tr('od razu', 'right away')}</option>
                {partners.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.note || ruleText(a, lang)}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {partners.length > 0 && (
            <Row label={tr('W parze z', 'Paired with')}>
              <select
                aria-label={tr('Para: pierwszy uruchomiony alarm kasuje drugi', 'Pair: the first alert to fire cancels the other')}
                value={pairWith}
                onChange={(e) => setPairWith(e.target.value)}
                className="h-8 max-w-44 bg-page border border-line rounded-md px-1.5 text-ink-1"
              >
                <option value="">{tr('bez pary', 'none')}</option>
                {partners.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.note || ruleText(a, lang)}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <input
            type="text"
            maxLength={NOTE_MAX}
            aria-label={tr('Opis alarmu (opcjonalnie)', 'Alert label (optional)')}
            placeholder={tr('Opis, np. long po pułapce (opcjonalnie)', 'Label, e.g. long after a trap (optional)')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 px-2.5 rounded-lg bg-surface-1 border border-line text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
          />
          <p className="text-[11px] leading-snug text-ink-2 min-h-[2.6em]">
            {spec ? (
              <>
                {tr('Alarm: ', 'Alert: ')}
                <span className="text-ink-1">{ruleText(spec, lang)}</span>
                {fromHm || untilHm ? `, ${windowText(...windowOf(fromHm, untilHm, Date.now()))}` : ''}.
                {already && (
                  <span className="block text-warn">
                    {kind === 'close'
                      ? tr(`Cena już jest po tej stronie: alarm zadziała przy najbliższym zamknięciu ${iv}.`, `Price is already on that side: it fires at the next ${iv} close.`)
                      : tr('Cena już jest za poziomem: alarm czeka tylko na zamknięcie z powrotem.', 'Price is already through the level: it only waits for the close back.')}
                  </span>
                )}
              </>
            ) : squeeze ? (
              tr('Wpisz próg ruchu w %, od 0,2 do 10.', 'Type the move threshold in %, from 0.2 to 10.')
            ) : (
              tr('Wpisz poziom albo kliknij wykres prawym przyciskiem i wybierz „Alarm…”.', 'Type a level, or right-click the chart and pick “Alert…”.')
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={!spec}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1 disabled:opacity-40"
            >
              <Bell className="w-3.5 h-3.5" />
              {editing ? tr('Zapisz zmiany', 'Save changes') : tr('Dodaj alarm', 'Add alert')}
            </button>
            {editing && (
              <button type="button" onClick={reset} className="h-9 px-3 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-3">
                {tr('Anuluj', 'Cancel')}
              </button>
            )}
          </div>
        </form>
      </Section>

      <Section
        title={tr(`Aktywne (${alerts.length})`, `Active (${alerts.length})`)}
        action={alerts.length > 1 ? { label: tr('Usuń wszystkie', 'Remove all'), on: () => alertBook.update(() => []) } : undefined}
      >
        {alerts.length === 0 ? (
          <p className="text-[11px] text-ink-3">{tr('Brak alarmów.', 'No alerts.')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {alerts.map((a) => (
              <li key={a.id} className={`flex items-start gap-1 rounded-md px-1.5 py-1 ${a.id === editing ? 'bg-surface-3' : ''}`}>
                <div className="flex-1 min-w-0">
                  {a.note && <div className="text-warn leading-snug truncate">{a.note}</div>}
                  <div className="text-ink-1 leading-snug">
                    <span className="font-mono text-ink-3">{a.coin}</span> {ruleText(a, lang)}
                  </div>
                  <div className="text-[11px] text-ink-3 leading-snug">{statusText(a, alerts)}</div>
                </div>
                <IconBtn label={tr('Zmień alarm', 'Edit alert')} onClick={() => edit(a)}>
                  <Pencil className="w-3.5 h-3.5" />
                </IconBtn>
                <IconBtn
                  label={a.kind === 'squeeze' ? tr(`Usuń alarm wyciskania ${a.coin}`, `Remove ${a.coin} squeeze alert`) : tr(`Usuń alarm ${a.coin} ${fmtPx(a.price)}`, `Remove alert ${a.coin} ${fmtPx(a.price)}`)}
                  onClick={() => removeAlert(a.id)}
                >
                  <X className="w-4 h-4" />
                </IconBtn>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {log.length > 0 && (
        <Section title={tr('Historia', 'History')} action={{ label: tr('Wyczyść', 'Clear'), on: () => alertLog.update(() => []) }}>
          <ul className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {log.map((e, i) => (
              <li key={`${e.rule.id}-${e.type}-${i}`} className="leading-snug">
                <span className={`font-mono ${e.type === 'fire' ? 'text-warn' : 'text-ink-3'}`}>{fmtSince(e.at, Date.now())}</span>{' '}
                <span className={e.type === 'fire' ? 'text-ink-1' : 'text-ink-2'}>{eventBody(e, lang)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={tr('Powiadomienia', 'Notifications')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {perm === 'default' ? (
            <button
              type="button"
              onClick={() => void askNotifications().then((p) => p && setPerm(p))}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1"
            >
              <Bell className="w-3.5 h-3.5" />
              {tr('Włącz powiadomienia systemowe', 'Turn on system notifications')}
            </button>
          ) : (
            <span className={perm === 'granted' ? 'text-good' : 'text-ink-3'}>
              {perm === 'granted'
                ? tr('Powiadomienia systemowe włączone', 'System notifications on')
                : perm === 'denied'
                  ? tr('Powiadomienia zablokowane w ustawieniach przeglądarki', 'Notifications are blocked in the browser settings')
                  : tr('Ta przeglądarka nie ma powiadomień systemowych', 'This browser has no system notifications')}
            </span>
          )}
          <button type="button" onClick={testAlert} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-3">
            <Volume2 className="w-3.5 h-3.5" />
            {tr('Test', 'Test')}
          </button>
        </div>
        <p className="text-[11px] leading-snug text-ink-3">
          {tr(
            'Alarm jest jednorazowy, a warunek sprawdza każda transakcja. Działa, gdy strona jest otwarta, także w tle i w innej zakładce desku: dźwięk, powiadomienie i 🔔 w tytule karty.',
            'Each alert fires once, and every trade checks its condition. It works while the page is open, also in the background and on another desk tab: sound, notification and 🔔 in the tab title.'
          )}
        </p>
        {push !== 'unsupported' ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
            <div className="flex items-center justify-between gap-2">
              <span className={`font-medium ${push === 'on' ? 'text-good' : 'text-ink-1'}`}>{push === 'on' ? tr('Powiadomienia 24/7 włączone', '24/7 notifications on') : tr('Powiadomienia 24/7', '24/7 notifications')}</span>
              <button
                type="button"
                disabled={push === 'busy'}
                onClick={() => void (push === 'on' ? disablePush() : enablePush())}
                className={`h-8 px-2.5 rounded-lg font-medium disabled:opacity-60 ${push === 'on' ? 'text-ink-2 hover:text-ink-1 hover:bg-surface-3' : 'border border-line-strong bg-surface-3 text-ink-1'}`}
              >
                {push === 'on' ? tr('Wyłącz', 'Turn off') : push === 'busy' ? tr('Włączam…', 'Turning on…') : tr('Włącz', 'Turn on')}
              </button>
            </div>
            <p className="text-[11px] leading-snug text-ink-2">
              {push === 'error'
                ? tr('Nie udało się włączyć. Zezwól stronie na powiadomienia i spróbuj jeszcze raz.', 'Could not turn on. Allow notifications for this site and try again.')
                : tr(
                    `Alarm przyjdzie także przy zamkniętej stronie i zablokowanym telefonie: pilnuje go serwer HyperQuant (do ${PUSH_MAX} alarmów tego urządzenia).`,
                    `The alert arrives even with the page closed and the phone locked: the HyperQuant server watches it (up to ${PUSH_MAX} alerts on this device).`
                  )}
            </p>
            <p className="text-[11px] leading-snug text-ink-3">
              {tr(
                'Zapisujemy tylko adres powiadomień tej przeglądarki, alarmy i język. Bez konta i e-maila, adresu IP nie zapisujemy. Wyłączenie usuwa wszystko, a urządzenie nieużywane 30 dni znika samo.',
                'We store only this browser’s notification address, the alerts and the language. No account or e-mail, and no IP address is stored. Turning it off deletes everything, and a device unused for 30 days is removed automatically.'
              )}
            </p>
          </div>
        ) : (
          pushNeedsHomeScreen() && (
            <p className="text-[11px] leading-snug text-ink-2">
              {tr(
                'Powiadomienia 24/7 na iPhonie działają w aplikacji: Udostępnij, „Do ekranu początkowego”, potem otwórz HyperQuant z ekranu.',
                'On iPhone, 24/7 notifications work in the app: Share, “Add to Home Screen”, then open HyperQuant from the Home Screen.'
              )}
            </p>
          )
        )}
      </Section>
    </div>
  );
};

function windowText(from: number, until: number): string {
  const now = Date.now();
  return from > now + 60_000 ? tr(`od ${fmtSince(from, now)} do ${fmtSince(until, now)}`, `from ${fmtSince(from, now)} until ${fmtSince(until, now)}`) : tr(`do ${fmtSince(until, now)}`, `until ${fmtSince(until, now)}`);
}

/** Stan alarmu pod warunkiem: okno, łańcuch, postęp serii, czy powrót czeka na wyjście za poziom, para. */
function statusText(a: PriceAlert, all: readonly PriceAlert[]): string {
  const parts = [windowText(a.from, a.until)];
  const parent = a.after ? all.find((b) => b.id === a.after) : undefined;
  if (parent) parts.push(tr(`czeka na alarm: ${parent.note || ruleText(parent, lang)}`, `waits for: ${parent.note || ruleText(parent, lang)}`));
  if (a.kind === 'reclaim')
    parts.push(
      a.armed
        ? a.dir === 1 ? tr('cena była pod poziomem, czeka na zamknięcie nad', 'price went below, waiting for a close above') : tr('cena była nad poziomem, czeka na zamknięcie pod', 'price went above, waiting for a close below')
        : a.dir === 1 ? tr('czeka na zejście pod poziom', 'waiting for a dip below') : tr('czeka na wyjście nad poziom', 'waiting for a move above')
    );
  if ((a.kind === 'close' || a.kind === 'reclaim') && a.closes > 1 && a.streak > 0) parts.push(tr(`${a.streak} z ${a.closes} zamknięć`, `${a.streak} of ${a.closes} closes`));
  if (a.delta && (a.kind === 'close' || a.kind === 'reclaim')) parts.push(tr('z filtrem delty', 'with delta filter'));
  if (a.pair) parts.push(tr('w parze', 'paired'));
  return parts.join(' · ');
}

const Section: React.FC<{ title: string; action?: { label: string; on: () => void }; children: React.ReactNode }> = ({ title, action, children }) => (
  <fieldset className="flex flex-col gap-2 min-w-0">
    <legend className="mb-1 flex w-full items-center justify-between text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
      {title}
      {action && (
        <button type="button" onClick={action.on} className="normal-case tracking-normal text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" />
          {action.label}
        </button>
      )}
    </legend>
    {children}
  </fieldset>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-ink-2 shrink-0">{label}</span>
    {children}
  </div>
);

const TimeInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <input
    type="time"
    aria-label={label}
    title={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-8 w-[5.5rem] px-1.5 rounded-md bg-page border border-line font-mono text-ink-1 [color-scheme:dark]"
  />
);

const IconBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3"
  >
    {children}
  </button>
);

/** Zestaw alarmów z linku: podgląd i dodanie dopiero po potwierdzeniu (obok obecnych albo w ich miejsce). */
export const AlarmLinkCard: React.FC<{ list: readonly PriceAlert[]; existing: number; onAdd: (replace: boolean) => void; onClose: () => void }> = ({ list, existing, onAdd, onClose }) => (
  <div role="dialog" aria-label={tr('Alarmy z linku', 'Alerts from a link')} className="bg-surface-2 border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-2.5 text-xs">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr(`Alarmy z linku (${list.length})`, `Alerts from a link (${list.length})`)}</span>
      <IconBtn label={tr('Zamknij', 'Close')} onClick={onClose}>
        <X className="w-4 h-4" />
      </IconBtn>
    </div>
    <ul className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
      {list.map((a) => (
        <li key={a.id} className="leading-snug">
          {a.note && <div className="text-warn">{a.note}</div>}
          <div className="text-ink-1">
            <span className="font-mono text-ink-3">{a.coin}</span> {ruleText(a, lang)}
          </div>
          <div className="text-[11px] text-ink-3">{statusText(a, list)}</div>
        </li>
      ))}
    </ul>
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onAdd(false)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line-strong bg-surface-3 font-medium text-ink-1">
        <Bell className="w-3.5 h-3.5" />
        {tr('Dodaj alarmy', 'Add alerts')}
      </button>
      {existing > 0 && (
        <button type="button" onClick={() => onAdd(true)} className="h-9 px-3 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-3">
          {tr(`Zastąp obecne (${existing})`, `Replace current (${existing})`)}
        </button>
      )}
    </div>
    <p className="text-[11px] leading-snug text-ink-3">{tr('Poziomy są tylko w tym linku i w Twojej przeglądarce.', 'The levels live only in this link and in your browser.')}</p>
  </div>
);
