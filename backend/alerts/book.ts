import type { Lang } from '../../src/i18n.ts';
import type { AlertEvent, AlertRule } from '../../src/utils/alertRules.ts';
import type { PushTarget } from './push.ts';

/**
 * Alarmy wszystkich urządzeń w jednym silniku: identyfikatory, pary i łańcuchy dostają przedrostek urządzenia
 * (`urządzenie/alarm`), więc alarmy różnych osób nigdy się nie kasują ani nie uruchamiają nawzajem. Stan pilnowania
 * (powrót uzbrojony, seria zamknięć, start z łańcucha) prowadzi serwer: lista z przeglądarki go nie cofa, chyba że
 * alarm został zmieniony (nowa chwila ustawienia).
 */

/** Urządzenie ze skrzynki; `rules: null` = usunięte. */
export interface SyncDevice {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
  rules: AlertRule[] | null;
}

export interface Device extends PushTarget {
  id: string;
  lang: Lang;
}

/** Zdarzenie z powrotem w przestrzeni urządzenia (tak, jak zna je przeglądarka). */
export interface DeviceEvent extends AlertEvent {
  device: string;
}

/** Start alarmu z łańcucha (do zapisu w skrzynce). */
export interface DeviceStart {
  device: string;
  id: string;
  created: number;
  from: number;
}

const SEP = '/';
const ns = (dev: string, id: string): string => (id ? `${dev}${SEP}${id}` : '');
const strip = (id: string): string => {
  const i = id.indexOf(SEP);
  return i < 0 ? id : id.slice(i + 1);
};
const owner = (id: string): string => id.slice(0, Math.max(0, id.indexOf(SEP)));

/** Definicja alarmu bez stanu pilnowania. */
const definition = (r: AlertRule): string => JSON.stringify([r.coin, r.price, r.kind, r.dir, r.iv, r.closes, r.delta, r.until, r.pair, r.note]);

export class DeviceBook {
  readonly devices = new Map<string, Device>();
  private list: AlertRule[] = [];
  /** Stan pilnowania odczytany po restarcie, przyjmowany przy pierwszym pojawieniu się alarmu. */
  private restored = new Map<string, { armed: boolean; streak: number }>();

  get rules(): readonly AlertRule[] {
    return this.list;
  }

  set rules(next: readonly AlertRule[]) {
    this.list = [...next];
  }

  restore(state: Record<string, { armed?: unknown; streak?: unknown }>): void {
    for (const [id, s] of Object.entries(state)) this.restored.set(id, { armed: s.armed === true, streak: typeof s.streak === 'number' ? s.streak : 0 });
  }

  /** Stan pilnowania do zapisu (tylko alarmy w toku). */
  snapshot(): Record<string, { armed: boolean; streak: number }> {
    const out: Record<string, { armed: boolean; streak: number }> = {};
    for (const r of this.list) if (r.armed || r.streak > 0) out[r.id] = { armed: r.armed, streak: r.streak };
    return out;
  }

  /** Zmiana urządzenia ze skrzynki. */
  apply(d: SyncDevice): void {
    const mine = (r: AlertRule) => owner(r.id) === d.id;
    if (d.rules === null || !d.endpoint) {
      this.devices.delete(d.id);
      this.list = this.list.filter((r) => !mine(r));
      return;
    }
    this.devices.set(d.id, { id: d.id, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, lang: d.lang === 'en' ? 'en' : 'pl' });
    const prev = new Map(this.list.filter(mine).map((r) => [r.id, r]));
    const next = d.rules.map((r): AlertRule => {
      const n = { ...r, id: ns(d.id, r.id), pair: ns(d.id, r.pair), after: ns(d.id, r.after) };
      const p = prev.get(n.id);
      if (p && definition(p) === definition(n) && n.created <= p.created) return p;
      const s = this.restored.get(n.id);
      this.restored.delete(n.id);
      return s ? { ...n, ...s } : n;
    });
    this.list = [...this.list.filter((r) => !mine(r)), ...next];
  }

  /** Zdarzenia silnika w przestrzeni urządzeń; starty z łańcucha z porównania listy przed i po. */
  split(events: readonly AlertEvent[], before: readonly AlertRule[]): { events: DeviceEvent[]; starts: DeviceStart[] } {
    const out = events.map((e) => ({ ...e, device: owner(e.rule.id), rule: { ...e.rule, id: strip(e.rule.id), pair: strip(e.rule.pair), after: strip(e.rule.after) } }));
    const was = new Map(before.map((r) => [r.id, r]));
    const starts: DeviceStart[] = [];
    for (const r of this.list) if (!r.after && was.get(r.id)?.after) starts.push({ device: owner(r.id), id: strip(r.id), created: r.created, from: r.from });
    return { events: out, starts };
  }
}
