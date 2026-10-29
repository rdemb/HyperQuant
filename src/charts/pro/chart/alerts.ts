import { tr } from '../../../i18n';
import { ALERT_INTERVALS, type AlertEvent, type AlertKind, type AlertRule, DEFAULT_TTL_MS, MAX_CLOSES } from '../../../utils/alertRules';
/**
 * Alarmy cenowe zapisywane w przeglądarce (warunki sprawdza `AlertEngine` z utils/alertRules, pilnowanie: alertWatch.ts):
 * lista alarmów, historia zdarzeń, dźwięk i powiadomienie systemowe. Bez serwera i bez kont.
 */

export type PriceAlert = AlertRule;

const KEY = 'hq.charts.alerts.v1';
const LOG_KEY = 'hq.charts.alerts.log.v1';
const SEEN_KEY = 'hq.charts.alerts.seen.v1';
/** Najwięcej alarmów naraz (wszystkie rynki) i wpisów w historii. */
export const MAX_ALERTS = 50;
export const LOG_MAX = 30;

let seq = 0;

/** Nowy alarm z formularza albo menu wykresu; `now` w zegarze giełdy. */
export interface AlertSpec {
  coin: string;
  price: number;
  kind: AlertKind;
  dir: 1 | -1;
  iv: string;
  closes: number;
  delta: boolean;
  from: number;
  until: number;
  pair: string;
  note: string;
  after: string;
}

/** Najdłuższy własny opis alarmu. */
export const NOTE_MAX = 60;

export function newAlert(spec: AlertSpec, now: number): PriceAlert {
  return { ...spec, id: `${now.toString(36)}${(seq++).toString(36)}`, created: now, armed: false, streak: 0 };
}

/**
 * Cena wpisana ręcznie: „75000”, „75,000”, „2 950.5” albo „2950,5”. Przy jednym przecinku bez kropki
 * (separator tysięcy albo dziesiętny) wybieramy odczyt bliższy bieżącej ceny `ref`.
 */
export function parsePriceInput(text: string, ref: number): number | null {
  const t = text.replace(/[\s ']/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  let v: number;
  if (t.includes('.')) v = Number(t.replace(/,/g, ''));
  else if ((t.match(/,/g) ?? []).length === 1) {
    const asDec = Number(t.replace(',', '.'));
    const asInt = Number(t.replace(',', ''));
    v = ref > 0 && Math.abs(Math.log(asInt / ref)) < Math.abs(Math.log(asDec / ref)) ? asInt : asDec;
  } else v = Number(t.replace(/,/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Odczyt z zapisu: uszkodzone wpisy odpadają, alarmy z poprzedniej wersji (samo dotknięcie) dostają domyślne pola. */
export function parseAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceAlert[] = [];
  for (const v of raw) {
    const a = v as Partial<PriceAlert> | null;
    if (!a || typeof a.id !== 'string' || typeof a.coin !== 'string' || !(typeof a.price === 'number' && a.price > 0)) continue;
    if (a.dir !== 1 && a.dir !== -1) continue;
    const created = num(a.created, 0) || Date.now();
    out.push({
      id: a.id,
      coin: a.coin,
      price: a.price,
      kind: a.kind === 'close' || a.kind === 'reclaim' ? a.kind : 'touch',
      dir: a.dir,
      iv: (ALERT_INTERVALS as readonly string[]).includes(a.iv ?? '') ? (a.iv as string) : '15m',
      closes: Math.min(MAX_CLOSES, Math.max(1, Math.round(num(a.closes, 1)))),
      delta: a.delta === true,
      from: num(a.from, 0),
      until: num(a.until, 0) > 0 ? (a.until as number) : created + DEFAULT_TTL_MS,
      pair: typeof a.pair === 'string' ? a.pair : '',
      note: typeof a.note === 'string' ? a.note.slice(0, NOTE_MAX) : '',
      after: typeof a.after === 'string' ? a.after : '',
      created,
      armed: a.armed === true,
      streak: Math.max(0, Math.round(num(a.streak, 0))),
    });
  }
  return out.slice(-MAX_ALERTS);
}

/** Historia: zdarzenia z poprawnym alarmem, najnowsze pierwsze. */
export function parseLog(raw: unknown): AlertEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: AlertEvent[] = [];
  for (const v of raw) {
    const e = v as Partial<AlertEvent> | null;
    if (!e || (e.type !== 'fire' && e.type !== 'expire' && e.type !== 'cancel') || typeof e.at !== 'number' || typeof e.px !== 'number') continue;
    const [rule] = parseAlerts([e.rule]);
    if (rule) out.push({ type: e.type, rule, at: e.at, px: e.px, facts: e.facts && typeof e.facts === 'object' ? e.facts : null });
  }
  return out.slice(0, LOG_MAX);
}

/** Lista zapisana w przeglądarce, wspólna dla wszystkich paneli i kart strony (zmiana w innej karcie przychodzi zdarzeniem `storage`). */
class StoredList<T> {
  private list: T[] | null = null;
  private readonly listeners = new Set<() => void>();
  private synced = false;

  constructor(
    private readonly key: string,
    private readonly parse: (raw: unknown) => T[]
  ) {}

  private load(): T[] {
    try {
      const s = localStorage.getItem(this.key);
      return this.parse(s ? JSON.parse(s) : null);
    } catch {
      return [];
    }
  }

  get = (): T[] => (this.list ??= this.load());

  update = (fn: (list: T[]) => T[]): void => {
    this.list = fn(this.get());
    try {
      localStorage.setItem(this.key, JSON.stringify(this.list));
    } catch {
      // Prywatne okno albo zablokowana pamięć — lista działa do końca sesji
    }
    this.listeners.forEach((l) => l());
  };

  subscribe = (fn: () => void): (() => void) => {
    if (!this.synced && typeof window !== 'undefined') {
      this.synced = true;
      window.addEventListener('storage', (e) => {
        if (e.key !== this.key) return;
        this.list = this.load();
        this.listeners.forEach((l) => l());
      });
    }
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export const alertBook = new StoredList<PriceAlert>(KEY, parseAlerts);
export const alertLog = new StoredList<AlertEvent>(LOG_KEY, parseLog);

/** Chwila ostatniego obejrzenia historii (znacznik nowych zdarzeń na dzwonku). */
export function lastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function markSeen(t: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(t));
  } catch {
    // Bez zapisu znacznik wraca po przeładowaniu
  }
}

const DAY = 24 * 3600_000;
/** Godzina HH:MM dnia chwili `ref` (czas lokalny). */
function clockAt(hm: string, ref: number): number {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(ref);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Okno alarmu z godzin HH:MM: koniec — najbliższa taka godzina; początek — ostatnia taka godzina przed końcem. */
export function windowOf(fromHm: string, untilHm: string, now: number): [number, number] {
  const next = (hm: string) => {
    const t = clockAt(hm, now);
    return t > now ? t : t + DAY;
  };
  const until = untilHm ? next(untilHm) : now + DEFAULT_TTL_MS;
  if (!fromHm) return [now, until];
  if (!untilHm) return [next(fromHm), until];
  const f = clockAt(fromHm, until);
  return [f < until ? f : f - DAY, until];
}

/** Krótki podpis linii alarmu przy osi ceny. */
export function lineLabel(a: PriceAlert): string {
  const wait = a.after ? tr(' · czeka', ' · waiting') : '';
  if (a.kind === 'touch') return tr('Alarm', 'Alert') + wait;
  const iv = a.closes > 1 ? `${a.iv}×${a.closes}` : a.iv;
  const side = a.dir === 1 ? tr('nad', 'above') : tr('pod', 'below');
  return (a.kind === 'close' ? tr(`Alarm ${iv} ${side}`, `Alert ${iv} ${side}`) : tr(`Alarm ${iv} powrót ${side}`, `Alert ${iv} back ${side}`)) + wait;
}

/** Usuwa alarm razem z alarmami, które na niego czekały (łańcuch bez początku nigdy by nie ruszył). */
export function removeAlert(id: string): void {
  alertBook.update((l) => {
    const gone = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of l)
        if (a.after && gone.has(a.after) && !gone.has(a.id)) {
          gone.add(a.id);
          grew = true;
        }
    }
    return l.filter((a) => !gone.has(a.id));
  });
}

/** Dodaje alarm; dźwięk i prośba o zgodę na powiadomienia korzystają z gestu użytkownika. */
export function addAlert(spec: AlertSpec, now: number): PriceAlert {
  const a = newAlert(spec, now);
  alertBook.update((l) => [...l, a].slice(-MAX_ALERTS));
  primeAlertSound();
  askNotifications();
  return a;
}

// ───────────────────────── powiadomienie ─────────────────────────

let audio: AudioContext | null = null;

/** Dźwięk wymaga gestu użytkownika — kontekst audio tworzymy przy ustawianiu alarmu albo pierwszym dotknięciu strony. */
export function primeAlertSound(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // Przeglądarka bez Web Audio — alarm bez dźwięku
  }
}

/** Trzy podwójne sygnały w ~1 s: wyraźnie inne niż dźwięk dużych zleceń z taśmy. */
function alertTone(): void {
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  for (let k = 0; k < 3; k++)
    [660, 990].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = t + k * 0.4 + i * 0.16;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    });
}

/**
 * Powiadomienie systemowe (po zgodzie przeglądarki), zostaje na ekranie do kliknięcia; `sound` — także sygnał.
 * Przez service worker, gdy jest (Android pozwala tylko tak, a kliknięcie wraca do karty desku).
 */
export function notifyAlert(body: string, tag: string, sound = true): void {
  const title = tr('HyperQuant · alarm', 'HyperQuant · alert');
  const opts: NotificationOptions = { body, tag, requireInteraction: true, icon: './icons/icon-192.png' };
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const plain = () => {
        const n = new Notification(title, opts);
        n.onclick = () => window.focus();
      };
      const sw = navigator.serviceWorker;
      if (sw) void sw.getRegistration().then((reg) => (reg ? reg.showNotification(title, opts) : plain())).catch(() => undefined);
      else plain();
    }
  } catch {
    // Część przeglądarek mobilnych nie ma konstruktora Notification — zostaje dźwięk i komunikat na wykresie
  }
  if (sound) alertTone();
}

/** Prośba o zgodę na powiadomienia (raz, przy pierwszym alarmie albo przyciskiem w panelu). */
export function askNotifications(): Promise<NotificationPermission | null> {
  try {
    if ('Notification' in window && Notification.permission === 'default') return Notification.requestPermission().catch(() => null);
  } catch {
    // Brak API powiadomień
  }
  return Promise.resolve(null);
}
