import { useEffect, useRef } from 'react';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { fmtDayTime } from '../core/time';
import type { FlowEvent, FlowSnapshot, SmcOrderflow } from '../core/smcOrderflow';
import { numberedContacts } from '../core/smcOrderflow';
import type { FlowTotal } from '../core/smcObservationBins';
import { flowAlignment } from './smcOrderflowAdapter';
import type { SmcStyle } from './smcLayer';

export type FlowOption = 'defense' | 'initiative' | 'anchored' | 'formation' | 'memory';
const n = (v: number | null, digits = 2): string => v === null || !Number.isFinite(v) ? '—' : numLang(v.toFixed(digits));
const time = (t: number | null): string => t === null ? '—' : `${fmtDayTime(t, Date.now())}:${String(new Date(t).getSeconds()).padStart(2, '0')}`;
const options = (): [FlowOption, string][] => [
  ['defense', tr('Obrona OB', 'OB defense')], ['initiative', tr('Sweep i retest', 'Sweep and retest')],
  ['anchored', tr('Delta / VWAP', 'Delta / VWAP')], ['formation', tr('Powstanie FVG', 'FVG formation')], ['memory', tr('Pamięć zdarzeń', 'Event memory')],
];
export function flowEventText(kind: FlowEvent['kind']): string {
  const texts: Record<FlowEvent['kind'], string> = {
    formation: tr('Element dostępny w obserwacji', 'Element available for observation'), contact: tr('Zaobserwowano kontakt z poziomem', 'Contact with the level observed'),
    'contact-end': tr('Kontakt zakończony', 'Contact ended'), defense: tr('Porównano zakończone kontakty', 'Completed contacts compared'),
    sweep: tr('Zamknięto okno trzech świec po sweepie', 'Three-candle post-sweep window closed'), retest: tr('Transakcja przy poziomie retestu', 'Trade at the retest level'),
    profile: tr('Uzupełniono profil powstania', 'Formation profile updated'), metrics: tr('Zapis pomiarów przepływu', 'Flow measurement sample'),
    gap: tr('Przerwa w obserwacji — brak pełnego pokrycia', 'Observation gap — incomplete coverage'), structure: tr('Zmieniła się potwierdzona struktura', 'Confirmed structure changed'),
    filled: tr('Luka wypełniona', 'Gap filled'), mitigated: tr('Order block zmitygowany', 'Order block mitigated'), expired: tr('Element wygasł', 'Element expired'), late: tr('Dotarła spóźniona transakcja', 'Late trade received'),
  }; return texts[kind];
}
function flowEventReason(e: FlowEvent): string {
  const s = e.snapshot;
  if (e.kind === 'contact' && s.kind === 'ob') return s.contacts <= 1 ? tr('Pierwszy kontakt — bez porównania', 'First contact — no comparison') : tr(`Zaobserwowano kontakt ${s.contacts}`, `Contact ${s.contacts} observed`);
  if (e.kind === 'defense') {
    if (s.defense === 'weakening') return tr('Obrona słabnie: głębsza penetracja, mniejsze odbicie, atak nie rośnie', 'Defense weakening: deeper penetration, smaller rebound, attack not increasing');
    if (s.defense === 'absorption') return tr('Większy atak bez głębszej penetracji i bez słabszego odbicia', 'Larger attack without deeper penetration or smaller rebound');
    return s.defense === 'unknown' ? tr('Porównanie wstrzymane: nieporównywalne kontakty', 'Comparison paused: contacts not comparable') : tr('Zakończone kontakty: brak jednoznacznej zmiany', 'Completed contacts: no clear change');
  }
  return flowEventText(e.kind);
}
function Totals({ label, value, valid, unit }: { label: string; value: FlowTotal; valid: boolean; unit: string }) {
  return <div className="rounded-lg border border-white/10 p-3" data-flow-totals={label}>
    <h4 className="font-semibold">{label}</h4>
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
      <dt>Delta ({unit})</dt><dd>{n(valid ? value.delta : null)}</dd>
      <dt>VWAP</dt><dd>{n(valid && value.volume > 0 ? value.pv / value.volume : null)}</dd>
      <dt>{tr('Kupno / sprzedaż', 'Buy / sell')} ({unit})</dt><dd>{valid ? `${n(value.buy)} / ${n(value.sell)}` : '—'}</dd>
      <dt>USD</dt><dd>{n(valid ? value.buyUsd + value.sellUsd : null)}</dd>
      <dt>{tr('Transakcje', 'Trades')}</dt><dd>{valid ? value.count : '—'}</dd>
    </dl>
  </div>;
}
export function SmcFlowDetails({ s, opts, unit }: { s: FlowSnapshot; opts: SmcStyle; unit: string }) {
  const valid = s.complete && s.anchor !== null;
  const defense = { first: tr('Pierwszy kontakt — bez porównania', 'First contact — no comparison'), weakening: tr('Obrona słabnie', 'Defense weakening'), absorption: tr('Więcej oznak absorpcji', 'More signs of absorption'), mixed: tr('Brak jednoznacznej zmiany', 'No clear change'), unknown: tr('Brak porównywalnego pokrycia', 'No comparable coverage') };
  const alignment = flowAlignment(s);
  const side = s.since.volume > 0 && s.since.buy / s.since.volume >= .6 ? 'buy' : s.since.volume > 0 && s.since.sell / s.since.volume >= .6 ? 'sell' : null;
  const share = s.since.volume > 0 ? (side === 'buy' ? s.since.buy : s.since.sell) / s.since.volume : null;
  const structureText = { up: tr('Struktura wzrostowa', 'Upward structure'), down: tr('Struktura spadkowa', 'Downward structure'), mixed: tr('Struktura mieszana', 'Mixed structure') }[s.structure];
  const unavailable = !s.complete ? tr('Brak pełnego pokrycia taśmą', 'Incomplete tape coverage') : s.since.volume <= 0 ? tr('Brak dodatniego wolumenu od kontaktu', 'No positive volume since contact') : tr('Brak zakończonego, kompletnego kontaktu', 'No completed, fully observed contact');
  const relation = { aligned: tr('Struktura i przepływ zgodne', 'Structure and flow aligned'), divergent: tr('Struktura i przepływ rozbieżne', 'Structure and flow divergent'), ambiguous: tr('Brak jednoznacznej zgodności', 'No clear alignment'), unavailable: tr('— Potrzebny zakończony kontakt i pełna taśma', '— Requires a completed contact and full tape') };
  const f = s.fvg;
  return <div className="space-y-3 text-sm" data-smc-flow-details={s.kind}>
    <div className="text-xs text-ink-3">{tr('Znany od', 'Known since')} {time(s.knownAt)} · {tr('Zaobserwowany stan', 'Observed state')} {time(s.observedAt)}<br />
      {tr('Zakres', 'Range')}: {n(s.lo)}–{n(s.hi)} · {s.ended ? tr('zakończony', 'ended') : tr('obserwowany', 'observed')}</div>
    {!s.complete && <p role="status" className="rounded-lg bg-amber-400/10 p-2 text-xs">{tr('Niepełna obserwacja. Brak danych nie oznacza zera; kontakty sprzed obserwacji nie są odtwarzane.', 'Incomplete observation. Missing data is not zero; contacts before observation are not reconstructed.')}</p>}
    {opts.defense !== false && s.kind === 'ob' && <section data-flow-section="defense"><h3 className="font-semibold">{s.contacts ? defense[s.defense] : tr('Jeszcze bez zaobserwowanego kontaktu', 'No contact observed yet')} <span className="text-xs text-ink-3">MODEL</span></h3>
      <p className="text-xs text-ink-3">{tr('Zaobserwowane kontakty', 'Observed contacts')}: {s.contacts} · {tr('zakończone', 'ended')}: {s.completed}</p>
      {s.recent.map((c, i) => <p key={`${c.from}:${i}`} className="mt-1 text-xs tabular-nums">{time(c.from)} · {({ active: tr('w toku', 'active'), retreat: tr('odejście', 'retreat'), broken: tr('przebicie', 'broken'), expired: tr('limit czasu', 'timed out') })[c.result]} · {tr('atak w strefie', 'attack inside zone')} {n(c.complete ? c.attack : null)} {unit} · {tr('penetracja / odbicie ATR', 'penetration / rebound ATR')} {n(c.complete && s.atr > 0 ? c.penetration / s.atr : null)} / {n(c.complete && s.atr > 0 ? c.rebound / s.atr : null)} · {tr('kupno / sprzedaż w strefie', 'buy / sell inside zone')} {n(c.complete ? c.flow.buy : null)} / {n(c.complete ? c.flow.sell : null)} {unit} · Δ {n(c.complete ? c.flow.delta : null)} {unit} · USD {n(c.complete ? c.flow.pv : null)}</p>)}
      <p className="mt-1 text-xs text-ink-3">{tr('Heurystyka kontaktów, nie dowód iceberg ani prognoza.', 'Contact heuristic, not evidence of an iceberg or a forecast.')}</p>
    </section>}
    {opts.initiative !== false && s.sweep && <section data-flow-section="initiative"><h3 className="font-semibold">{tr('Sweep → powrót → retest', 'Sweep → return → retest')}</h3>
      <p>{({ observing: tr('Obserwacja trzech pełnych świec', 'Observing three full candles'), initiative: tr('Powrót z inicjatywą przepływu', 'Return with flow initiative'), 'return-only': tr('Powrót bez potwierdzonej inicjatywy', 'Return without confirmed initiative'), beyond: tr('Ponowne zamknięcie za poziomem', 'Closed beyond the level again'), unknown: tr('— Niepełne pokrycie okna', '— Incomplete window coverage') })[s.sweep.state]} <span className="text-xs text-ink-3">MODEL</span></p>
      <p className="text-xs">{tr('Zamknięcia po stronie powrotu', 'Closes on the return side')}: {s.sweep.closes}/3 · {tr('Pełne świece', 'Full candles')}: {s.sweep.bars}/3 · {tr('Retest', 'Retest')}: {s.sweep.retest === null ? tr('nie zaobserwowano', 'not observed') : time(s.sweep.retest)}</p>
      <p className="text-xs text-ink-3">{time(s.knownAt)} → {time(s.knownAt + 3 * s.intervalMs)}</p>
      <p className="text-xs">{tr('Agresja kupna / sprzedaży, całe okno', 'Aggressive buy / sell, whole window')}: {n(s.sweep.flow?.buy ?? null)} / {n(s.sweep.flow?.sell ?? null)} {unit}</p>
      <p className="text-xs">{tr('Na i nad poziomem', 'At and above level')}: {n(s.sweep.above?.buy ?? null)} / {n(s.sweep.above?.sell ?? null)} · {tr('Pod poziomem', 'Below level')}: {n(s.sweep.below?.buy ?? null)} / {n(s.sweep.below?.sell ?? null)} {unit}</p>
    </section>}
    {opts.formation !== false && f && <section data-flow-section="formation"><h3 className="font-semibold">{tr('Profil trzech świec powstania', 'Three-candle formation profile')} <span className="text-xs text-ink-3">LIVE / MODEL</span></h3>
      <p className="text-xs text-ink-3">{time(f.from)} → {time(f.to)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-xs tabular-nums"><dt>{tr('Wolumen całego okna USD', 'Whole-window volume USD')}</dt><dd>{n(f.totalUsd)}</dd>
        <dt>{tr('W luce USD / udział', 'Inside gap USD / share')}</dt><dd>{n(f.insideUsd)} / {f.share === null ? '—' : `${n(f.share * 100)}%`}</dd>
        <dt>Delta ({unit})</dt><dd>{n(f.delta)}</dd><dt>{tr('Widoczna L2, średnia próbek USD', 'Visible L2, sample mean USD')}</dt><dd>{n(f.depthUsd)}</dd>
        <dt>{tr('Referencje przepływu / L2', 'Flow / L2 reference windows')}</dt><dd>{f.flowReferences} / {f.depthReferences}</dd>
        <dt>{tr('Próg p80 USD / L2 p20 USD', 'p80 USD / L2 p20 USD threshold')}</dt><dd>{n(f.volumeP80)} / {n(f.depthP20)}</dd><dt>{tr('Krok agregacji L2', 'L2 aggregation step')}</dt><dd>{n(f.step)}</dd></dl>
      <p className="mt-2 text-xs">{tr('Agresor zgodny z impulsem', 'Aggressor matching impulse')}: {f.impulseShare === null ? '—' : `${n(f.impulseShare * 100)}%`} · {tr('warunki: USD ≥p80 i udział ≥60%', 'conditions: USD ≥p80 and share ≥60%')}</p>
      <p className="mt-2">{f.strongFlow === null ? tr('— Brak pełnego przepływu lub 20 wcześniejszych okien', '— Missing full flow or 20 earlier windows') : f.strongFlow ? tr('Silny przepływ przy powstaniu', 'Strong formation flow') : tr('Próg silnego przepływu nie został osiągnięty', 'Strong-flow threshold not met')}</p>
      <p>{f.lowLiquidity === null ? tr('— L2: brak ciągłego pokrycia całej luki lub porównywalnych okien', '— L2: no continuous full-gap coverage or comparable windows') : f.lowLiquidity ? tr('Mała widoczna płynność', 'Low visible liquidity') : tr('Widoczna płynność nie poniżej progu p20', 'Visible liquidity not below p20')}</p>
      <p className="mt-1 text-xs text-ink-3">{tr('Obie cechy mogą współistnieć. Widoczne poziomy nie opisują całego arkusza ani przyczyny ruchu. Percentyle nearest-rank, odniesienia sprzed początku okna; brak próbek L2 >12 s unieważnia porównanie.', 'Both features may coexist. Visible levels describe neither the whole book nor the cause of a move. Nearest-rank percentiles, references before the window starts; L2 sample gaps >12 s invalidate comparison.')}</p>
    </section>}
    {opts.anchored !== false && <section data-flow-section="anchored"><h3 className="font-semibold">{tr('Od pierwszego zaobserwowanego kontaktu', 'Since first observed contact')} <span className="text-xs text-ink-3">LIVE · {s.ended ? tr('zakończony', 'ended') : tr('pomiar w toku', 'provisional')}</span></h3>
      <p className="mb-2 text-xs text-ink-3">{time(s.anchor)} → {time(s.observedAt)} · {tr('Jednostka bazowa, osobno USD. VWAP nie istnieje bez wolumenu.', 'Base units, USD separate. No VWAP without volume.')}</p>
      <div className="grid gap-2 sm:grid-cols-2"><Totals label={tr('Tylko w strefie', 'Inside the zone only')} value={s.zone} valid={valid} unit={unit} /><Totals label={tr('Cały przepływ od kontaktu', 'All flow since contact')} value={s.since} valid={valid} unit={unit} /></div>
      <p className="mt-2 text-xs">{relation[alignment]} · MODEL</p>
      <p className="text-xs">{structureText}; {alignment === 'unavailable' ? unavailable : side === null ? tr('brak przewagi agresora 60%', 'no 60% aggressor dominance') : `${side === 'buy' ? tr('przewaga agresywnego kupna', 'aggressive buying dominant') : tr('przewaga agresywnej sprzedaży', 'aggressive selling dominant')} ${n(share === null ? null : share * 100)}%`}</p>
      <p className="text-xs text-ink-3">{tr('Porównanie dotyczy całej delty od kontaktu, nie tylko wnętrza strefy; próg przewagi strony 60%.', 'Comparison uses all delta since contact, not only trades inside the zone; side dominance threshold 60%.')}</p>
    </section>}
  </div>;
}

export function SmcOrderflowPanel({ model, selected, replay, opts, unit, onSelect, onReplay, onOption, onClose, contactChoice }: {
  model: SmcOrderflow; selected: string; opts: SmcStyle; unit: string;
  replay: number | null; onReplay: (at: number | null) => void;
  onSelect: (id: string) => void; onOption: (key: FlowOption, on: boolean) => void; onClose: () => void;
  contactChoice?: { ordinal: number | null; onChoose: (ordinal: number | null) => void };
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const s = replay === null ? model.current(selected) : model.at(selected, replay);
  const events = model.events(selected), list = model.list();
  const latest = [...events].reverse().find(e => e.kind !== 'metrics' && (replay === null || e.observedAt <= replay));
  const contacts = s && contactChoice ? numberedContacts(s) : [];
  return <aside role="dialog" aria-label={tr('SMC — obserwacja przepływu', 'SMC — flow observation')} className="fixed z-40 bottom-16 left-2 right-2 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-surface-1 p-3 shadow-2xl sm:absolute sm:bottom-2 sm:left-auto sm:max-h-[78%] sm:w-[420px]" data-smc-flow-panel>
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-ink-1">SMC · {tr('obserwacja przepływu', 'flow observation')}</h2><button ref={close} type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg hover:bg-white/10" aria-label={tr('Zamknij panel SMC', 'Close SMC panel')}>×</button></div>
    <label className="block text-xs text-ink-3">{tr('Element', 'Element')}<select value={selected} onChange={e => onSelect(e.target.value)} className="my-2 block min-h-11 w-full rounded-lg border border-white/15 bg-surface-2 px-2 text-ink-1">{list.map(x => <option key={x.id} value={x.id}>{x.kind.toUpperCase()} · {n(x.lo)}–{n(x.hi)} · {time(x.knownAt)}</option>)}</select></label>
    {contactChoice && contacts.length > 0 && <label className="block text-xs text-ink-3">{tr('Kontakt na profilu delty', 'Contact on the delta profile')}
      <select value={contactChoice.ordinal ?? ''} onChange={e => contactChoice.onChoose(e.target.value ? Number(e.target.value) : null)}
        className="my-2 block min-h-11 w-full rounded-lg border border-white/15 bg-surface-2 px-2 text-ink-1">
        <option value="">{tr('Najnowszy', 'Latest')}</option>
        {contacts.map(({ ordinal, contact }) => <option key={ordinal} value={ordinal}>#{ordinal} · {time(contact.from)}{contact.result === 'active' ? tr(' · trwa', ' · ongoing') : ''}</option>)}
        {contactChoice.ordinal !== null && !contacts.some(c => c.ordinal === contactChoice.ordinal) && <option value={contactChoice.ordinal} disabled>#{contactChoice.ordinal} · {tr('brak w tej chwili', 'unavailable at this time')}</option>}
      </select>
    </label>}
    <div className="mb-3 flex flex-wrap gap-x-3">{options().map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-1 text-xs"><input type="checkbox" checked={opts[key] !== false} onChange={e => onOption(key, e.target.checked)} />{label}</label>)}</div>
    {s ? <>
      {latest && <div className="mb-3 rounded-lg border border-white/10 p-2 text-xs">
        <strong>{tr('Co się zmieniło', 'What changed')}</strong><br />{time(latest.observedAt)} · {flowEventReason(latest)}
        {opts.memory !== false && <button type="button" className="block min-h-11 text-accent" onClick={() => onReplay(latest.observedAt)}>{tr('Pokaż tę obserwację', 'Show this observation')}</button>}
      </div>}
      <SmcFlowDetails s={s} opts={opts} unit={unit} />
    </> : <p>{tr('Brak zachowanego stanu z tej chwili.', 'No retained state at this time.')}</p>}
    {opts.memory !== false && <details className="mt-3 border-t border-white/10 pt-3" data-flow-section="memory" open={replay !== null || undefined}><summary className="min-h-11 cursor-pointer font-semibold">{tr('Pamięć obserwowanych zdarzeń', 'Observed event memory')}</summary>
      <p className="text-xs text-ink-3">{tr('Zachowane od', 'Retained since')} {time(events[0]?.observedAt ?? null)}</p>
      <p className="text-xs text-ink-3">{tr('Historia tylko tej sesji strony, do 256 zapisów na element. Wybór chwili odtwarza adnotacje i panel SMC. Świece pozostają bieżące. Po przeładowaniu zapis znika.', 'History of this page session only, up to 256 records per element. Selecting a time replays the SMC annotations and panel. Candles stay current. Reloading clears the record.')}</p>
      <div className="my-2 flex flex-wrap items-center justify-between gap-1"><span className="text-xs">{replay === null ? 'LIVE' : `${tr('Obserwacja z', 'Observation at')} ${time(replay)}`}</span><button type="button" className="min-h-11 rounded-lg border border-white/15 px-3 text-xs" onClick={() => onReplay(null)}>{tr('Teraz', 'Now')}</button><button type="button" className="min-h-11 rounded-lg border border-white/15 px-3 text-xs" onClick={onClose}>{tr('Pokaż wykres', 'Show chart')}</button></div>
      <label className="block text-xs">{tr('Zachowane punkty obserwacji', 'Retained observation points')}<input aria-label={tr('Chwila obserwacji SMC', 'SMC observation time')} type="range" className="min-h-11 w-full" min={0} max={Math.max(0, events.length - 1)} value={replay === null ? Math.max(0, events.length - 1) : Math.max(0, events.findIndex(e => e.observedAt >= replay))} onChange={e => onReplay(events[Number(e.target.value)]?.observedAt ?? null)} /></label>
      <ol className="max-h-40 overflow-y-auto">{events.filter(e => e.kind !== 'metrics').slice(-24).reverse().map((e, i) => <li key={`${e.observedAt}:${i}`}><button type="button" className="min-h-11 w-full rounded-lg px-1 text-left text-xs hover:bg-white/5" onClick={() => onReplay(e.observedAt)}>{time(e.observedAt)} · {flowEventReason(e)}<span className="block text-ink-3">{tr('Czas giełdy', 'Exchange time')}: {time(e.exchangeAt)}</span></button></li>)}</ol>
    </details>}
    <p className="mt-3 text-[11px] text-ink-3">{s?.version} · {tr('Źródło: publiczne trades / l2Book Hyperliquid. LIVE: pomiary, MODEL: heurystyki interfejsu. Bez prognozy i obietnicy przewagi.', 'Source: public Hyperliquid trades / l2Book. LIVE: measurements, MODEL: interface heuristics. No forecast or claim of an edge.')}</p>
  </aside>;
}
