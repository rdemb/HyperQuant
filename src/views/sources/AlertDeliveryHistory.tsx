import example from '../../data/alertDeliveryExample.v1.json';
import { tr } from '../../i18n';

/**
 * Historia prób powiadomienia na podstawie przykładowego dziennika.
 * Rozróżnia trzy rzeczy, których nie wolno mieszać: przyjęcie przez serwis (HTTP 2xx), potwierdzenie z urządzenia
 * i próbę przerwaną bez odpowiedzi (wynik nieznany). Dane pochodzą z syntetycznego dziennika (SIM), nie z prawdziwego push.
 */
type Attempt = { attempt: number; at: number; status: number; outcome: string };
type Case = { kind: string; detection: { id: string; ruleRevision: string; geometryRevision: string; observationRevision: string; at: number };
  attempts: Attempt[]; acknowledgedAt: number | null; pending: { attempt: number; at: number } | null };

const hms = (t: number) => new Date(t).toISOString().slice(11, 19) + ' UTC';
const outcome = (a: Attempt) => a.outcome === 'retry' ? tr(`HTTP ${a.status} · ponowienie`, `HTTP ${a.status} · retry`)
  : a.outcome === 'accepted-by-service' ? tr(`HTTP ${a.status} · przyjęte przez serwis`, `HTTP ${a.status} · accepted by the service`)
    : `HTTP ${a.status} · ${a.outcome}`;

function verdict(c: Case) {
  if (c.acknowledgedAt !== null) return tr(`Potwierdzone przez urządzenie ${hms(c.acknowledgedAt)}`, `Acknowledged by the device ${hms(c.acknowledgedAt)}`);
  if (c.pending) return tr(`Próba ${c.pending.attempt} przerwana bez odpowiedzi (${hms(c.pending.at)}): wynik nieznany, nie ponawiamy na ślepo`,
    `Attempt ${c.pending.attempt} interrupted without a response (${hms(c.pending.at)}): outcome unknown, no blind retry`);
  if (c.attempts.some(a => a.outcome === 'accepted-by-service')) return tr('Przyjęte przez serwis, brak potwierdzenia z urządzenia', 'Accepted by the service, no device acknowledgement');
  return tr('Brak udanej próby', 'No successful attempt');
}

export function AlertDeliveryHistory() {
  const cases = (example as { v: number; source: string; cases: Case[] }).cases;
  return <section className="card p-4 flex flex-col gap-3" aria-labelledby="alert-delivery-h" data-alert-delivery>
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 id="alert-delivery-h" className="text-sm font-semibold">{tr('Historia prób powiadomienia', 'Alert delivery attempts')}</h2>
      <span className="text-[11px] font-mono px-1.5 border border-current rounded">SIM</span>
    </div>
    <p className="text-xs text-ink-2">{tr('Przykład z syntetycznego dziennika (bez prawdziwego push i bez danych prywatnych). HTTP 202 oznacza przyjęcie przez serwis. Status doręczenia wynika z osobnego potwierdzenia urządzenia.',
      'Example from a synthetic journal (no real push, no private data). HTTP 202 means accepted by the service; only the device confirms delivery.')}</p>
    <ol className="flex flex-col gap-3">
      {cases.map(c => <li key={c.detection.id} className="flex flex-col gap-1 text-xs" data-alert-case={c.detection.id}>
        <strong className="text-ink-1">{verdict(c)}</strong>
        <span className="font-mono text-ink-2">{c.detection.id} · {tr('wykrycie', 'detected')} {hms(c.detection.at)} · {tr('reguła', 'rule')} {c.detection.ruleRevision}</span>
        <span className="font-mono text-ink-2">{tr('geometria', 'geometry')} {c.detection.geometryRevision} · {tr('obserwacja', 'observation')} {c.detection.observationRevision}</span>
        {c.attempts.length > 0 ? <ul className="font-mono text-ink-2 pl-3">
          {c.attempts.map(a => <li key={a.attempt}>#{a.attempt} {hms(a.at)} · {outcome(a)}</li>)}
        </ul> : <span className="font-mono text-ink-2 pl-3">{tr('brak zakończonych prób', 'no completed attempts')}</span>}
      </li>)}
    </ol>
  </section>;
}
