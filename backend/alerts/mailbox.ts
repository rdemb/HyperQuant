import { type KeyObject, sign } from 'node:crypto';
import { parseRules } from '../../src/utils/alertRules.ts';
import { signedMessage } from '../../src/utils/alertsServer.ts';
import type { DeviceEvent, DeviceStart, SyncDevice } from './book.ts';

/** Klient skrzynki alarmów: każde zapytanie podpisane kluczem Ed25519 serwera (czas + treść). */
export class Mailbox {
  private readonly url: string;
  private readonly key: KeyObject;
  private readonly fetchFn: typeof fetch;

  constructor(url: string, key: KeyObject, fetchFn: typeof fetch = fetch) {
    this.url = url.replace(/\/+$/, '');
    this.key = key;
    this.fetchFn = fetchFn;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
    const text = body ? JSON.stringify(body) : '';
    const time = Date.now();
    const sig = sign(null, Buffer.from(signedMessage(method, path, time, text)), this.key).toString('base64url');
    const res = await this.fetchFn(this.url + path, {
      method,
      headers: { 'x-hq-time': String(time), 'x-hq-sig': sig, ...(text ? { 'content-type': 'application/json' } : {}) },
      body: text || undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path.split('?')[0]}`);
    return res.json();
  }

  /** Zmienione urządzenia od kursora (alarmy jeszcze raz sprawdzone tym samym parserem co w przeglądarce). */
  async sync(cursor: string): Promise<{ cursor: string; more: boolean; devices: SyncDevice[] }> {
    const r = (await this.call('GET', `/v1/sync?cursor=${encodeURIComponent(cursor)}`)) as { cursor: string; more: boolean; devices: SyncDevice[] };
    const now = Date.now();
    return { cursor: String(r.cursor), more: r.more === true, devices: r.devices.map((d) => ({ ...d, rules: d.rules === null ? null : parseRules(d.rules, now) })) };
  }

  async report(body: { events: DeviceEvent[]; starts: DeviceStart[]; gone: string[] }): Promise<void> {
    await this.call('POST', '/v1/report', body);
  }
}
