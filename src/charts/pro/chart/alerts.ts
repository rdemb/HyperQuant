import { tr } from '../../../i18n';
/**
 * Alerty cenowe zapisywane w przeglądarce: jednorazowe, wyzwalane, gdy cena rynku dojdzie do poziomu od strony,
 * z której alert ustawiono. Sprawdzane tylko przy otwartej stronie (bez serwera i bez kont).
 */

export interface PriceAlert {
  id: string;
  coin: string;
  price: number;
  /** 1 = cena ma wzrosnąć do poziomu, −1 = spaść do niego. */
  dir: 1 | -1;
  created: number;
}

const KEY = 'hq.charts.alerts.v1';
/** Najwięcej alertów naraz (wszystkie rynki). */
export const MAX_ALERTS = 50;

let seq = 0;

/** Alert na poziomie `price` ustawiany przy cenie `current` — kierunek wynika z położenia poziomu względem ceny. */
export function newAlert(coin: string, price: number, current: number, now = Date.now()): PriceAlert {
  return { id: `${now.toString(36)}${(seq++).toString(36)}`, coin, price, dir: price >= current ? 1 : -1, created: now };
}

/** Alert osiągnięty przy cenie `px`. */
export function reached(a: PriceAlert, px: number): boolean {
  return a.dir === 1 ? px >= a.price : px <= a.price;
}

/**
 * Cena wpisana ręcznie: „75000”, „75,000”, „2 950.5” albo „2950,5”. Przy jednym przecinku bez kropki
 * (separator tysięcy albo dziesiętny) wybieramy odczyt bliższy bieżącej ceny `ref`.
 */
export function parsePriceInput(text: string, ref: number): number | null {
  const t = text.replace(/[\s\u00a0']/g, '');
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

export function parseAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceAlert[] = [];
  for (const v of raw) {
    const a = v as Partial<PriceAlert> | null;
    if (!a || typeof a.id !== 'string' || typeof a.coin !== 'string' || !(typeof a.price === 'number' && a.price > 0)) continue;
    if (a.dir !== 1 && a.dir !== -1) continue;
    out.push({ id: a.id, coin: a.coin, price: a.price, dir: a.dir, created: typeof a.created === 'number' ? a.created : 0 });
  }
  return out.slice(-MAX_ALERTS);
}

export function loadAlerts(): PriceAlert[] {
  try {
    const s = localStorage.getItem(KEY);
    return parseAlerts(s ? JSON.parse(s) : null);
  } catch {
    return [];
  }
}

export function saveAlerts(list: readonly PriceAlert[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Prywatne okno albo zablokowana pamięć — alerty działają do końca sesji
  }
}

/** Wspólna lista alertów strony (wszystkie panele układu), zapisywana przy każdej zmianie. */
class AlertBook {
  private list: PriceAlert[] | null = null;
  private readonly listeners = new Set<() => void>();

  get = (): PriceAlert[] => (this.list ??= loadAlerts());

  update = (fn: (list: PriceAlert[]) => PriceAlert[]): void => {
    this.list = fn(this.get());
    saveAlerts(this.list);
    this.listeners.forEach((l) => l());
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export const alertBook = new AlertBook();

// ───────────────────────── powiadomienie ─────────────────────────

let audio: AudioContext | null = null;

/** Dźwięk wymaga gestu użytkownika — kontekst audio tworzymy przy ustawianiu alertu. */
export function primeAlertSound(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // Przeglądarka bez Web Audio — alert bez dźwięku
  }
}

function alertTone(): void {
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  [660, 990].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = t + i * 0.16;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  });
}

/** Powiadomienie systemowe (po zgodzie przeglądarki) i krótki dźwięk. */
export function notifyAlert(text: string, tag: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(tr('HyperQuant · alert cenowy', 'HyperQuant · price alert'), { body: text, tag });
  } catch {
    // Część przeglądarek mobilnych nie ma konstruktora Notification — zostaje dźwięk i komunikat na wykresie
  }
  alertTone();
}

/** Prośba o zgodę na powiadomienia (raz, przy pierwszym alercie). */
export function askNotifications(): void {
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
  } catch {
    // Brak API powiadomień
  }
}
