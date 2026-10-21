import React, { useEffect, useState } from 'react';
import { CheckSquare, Clock, Crosshair, ShieldCheck, Square } from 'lucide-react';
import { QuantMathMetrics, ShaakuniState } from '../types/trading';
import { PlanDraft } from '../state/types';
import { Badge, Panel, fmtPct, fmtPrice } from '../ui';
import { nyHourInTimeZone } from '../utils/shaakuniEngine';

interface DayTradingPrepDeskProps {
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  currentPrice: number;
  /** Przekazuje scenariusz (kierunek + poziomy) do Analizatora planu — ocena, nie sygnał */
  onPrefillPlan: (draft: PlanDraft) => void;
}

interface ChecklistItem {
  id: string;
  title: string;
  detail: string;
}

// Proces, nie przewaga: pytania kontrolne przed wejściem (bez progów sugerujących skuteczność)
const CHECKLIST: ChecklistItem[] = [
  {
    id: 'session',
    title: '01. Okno czasowe',
    detail: 'Czy plan przypada na okno, w którym zwykle handlujesz (np. otwarcie Londynu lub Nowego Jorku)? Poza nim płynność bywa niższa.',
  },
  {
    id: 'context',
    title: '02. Kontekst poziomów',
    detail: 'Gdzie jest cena względem D-EQ, PDH/PDL i PWH/PWL? Zapisz to przed wejściem, nie po.',
  },
  {
    id: 'levels',
    title: '03. Wejście, stop i cel zdefiniowane z góry',
    detail: 'Stop wynika z miejsca, w którym plan przestaje mieć sens — nie z kwoty, którą chcesz ryzykować.',
  },
  {
    id: 'macro',
    title: '04. Kalendarz makro',
    detail: 'Czy w horyzoncie planu jest publikacja (CPI, NFP, FOMC)? Zmienność wokół publikacji bywa wielokrotnie wyższa.',
  },
  {
    id: 'analyzer',
    title: '05. Analizator planu',
    detail: 'Sprawdź P(cel przed stopem), EV po kosztach i odległość stopu od ceny likwidacji.',
  },
  {
    id: 'risk',
    title: '06. Stałe ryzyko i dziennik',
    detail: 'Wielkość ze stałego, małego % kapitału; zapisz plan do dziennika, by mierzyć własną trafność.',
  },
];

const CHECK_KEY = 'hq.prepChecklist.v2';

function readChecked(): string[] {
  try {
    const raw = localStorage.getItem(CHECK_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** „Plan na jutro”: drabina poziomów HTF, dwa scenariusze-hipotezy do oceny w Analizatorze, harmonogram sesji, checklista. */
export const DayTradingPrepDesk: React.FC<DayTradingPrepDeskProps> = ({ shaakuni, quant, currentPrice, onPrefillPlan }) => {
  const [checked, setChecked] = useState<string[]>(readChecked);

  useEffect(() => {
    try {
      localStorage.setItem(CHECK_KEY, JSON.stringify(checked));
    } catch {
      // Brak dostępu do storage — checklista tylko w tej sesji
    }
  }, [checked]);

  const toggle = (id: string) => setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const done = CHECKLIST.filter((c) => checked.includes(c.id)).length;

  // Brak realnego poziomu = „—” (żadnych wartości zastępczych)
  const { pdh, pdl, deq, pwh, pwl, weq, atr14 } = shaakuni;
  const atr = isNum(atr14) && atr14 > 0 ? atr14 : null;
  const distPct = (v: number | null) => (isNum(v) && isNum(currentPrice) ? fmtPct(((v - currentPrice) / currentPrice) * 100, 2) : '—');

  const freshBull = shaakuni.orderBlocks.filter((o) => o.state === 'fresh' && o.type === 'bull').slice(-1)[0];
  const freshBear = shaakuni.orderBlocks.filter((o) => o.state === 'fresh' && o.type === 'bear').slice(-1)[0];

  // Scenariusz A (LONG): strefa = świeży bull OB lub PDL–D-EQ; stop pod strefą; cel D-EQ lub PDH powyżej wejścia
  const longZone =
    freshBull ? { lo: freshBull.bottom, hi: freshBull.top, label: 'świeży bull OB' } : isNum(pdl) && isNum(deq) ? { lo: pdl, hi: deq, label: 'PDL – D-EQ' } : null;
  const longEntry = longZone ? (longZone.lo + longZone.hi) / 2 : null;
  const longStop = longZone && atr ? longZone.lo - atr * 0.4 : null;
  const longTarget = longEntry !== null ? [deq, pdh].find((v): v is number => isNum(v) && v > longEntry) ?? null : null;

  // Scenariusz B (SHORT): strefa = świeży bear OB lub D-EQ–PDH; stop nad strefą; cel D-EQ lub PDL poniżej wejścia
  const shortZone =
    freshBear ? { lo: freshBear.bottom, hi: freshBear.top, label: 'świeży bear OB' } : isNum(deq) && isNum(pdh) ? { lo: deq, hi: pdh, label: 'D-EQ – PDH' } : null;
  const shortEntry = shortZone ? (shortZone.lo + shortZone.hi) / 2 : null;
  const shortStop = shortZone && atr ? shortZone.hi + atr * 0.4 : null;
  const shortTarget = shortEntry !== null ? [deq, pdl].find((v): v is number => isNum(v) && v < shortEntry) ?? null : null;

  // Godziny PL liczone z Intl dla dzisiejszej daty — poprawne także w tygodniach rozjazdu DST USA/UE
  const plRange = (nyFrom: number, nyTo: number) => {
    const from = nyHourInTimeZone(nyFrom);
    const to = nyHourInTimeZone(nyTo);
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
    return `${hh(from.hour)}–${hh(to.hour)} (${from.label})`;
  };
  const sessions = [
    { name: 'Azja', ny: '20:00–00:00 NY', pl: plRange(20, 0), note: 'Zwykle niższy wolumen; zakres często wyznacza punkt odniesienia na resztę dnia.', active: shaakuni.nySession === 'Asian' },
    { name: 'Londyn', ny: '02:00–05:00 NY', pl: plRange(2, 5), note: 'Otwarcie Europy — wzrost wolumenu.', active: shaakuni.nySession === 'London' },
    { name: 'Nowy Jork', ny: '07:00–10:00 NY', pl: plRange(7, 10), note: 'Najwyższy wolumen dnia; publikacje USA o 08:30 NY.', active: shaakuni.nySession === 'New York' },
    { name: 'Zamknięcie Londynu', ny: '10:00–12:00 NY', pl: plRange(10, 12), note: 'Koniec sesji europejskiej — wolumen zwykle spada.', active: shaakuni.nySession === 'London Close' },
  ];

  const ladder: { label: string; val: number | null; sub?: string }[] = [
    { label: 'PWH', val: pwh },
    { label: `PDH · ${shaakuni.pdhStatus}`, val: pdh },
    { label: 'POC (profil wolumenu)', val: isNum(quant.pocPrice) && quant.pocPrice > 0 ? quant.pocPrice : null, sub: 'MODEL' },
    { label: 'D-EQ (50% dnia)', val: deq },
    { label: 'W-EQ (50% tygodnia)', val: weq },
    { label: `PDL · ${shaakuni.pdlStatus}`, val: pdl },
    { label: 'PWL', val: pwl },
  ];

  return (
    <Panel
      title="Plan na jutro"
      eyebrow={<>Przygotowanie sesji · cena {fmtPrice(currentPrice, 0)}</>}
      actions={
        <>
          <span className="text-xs font-mono tabular-nums text-ink-2">
            {done}/{CHECKLIST.length}
          </span>
          <button
            type="button"
            onClick={() => setChecked([])}
            className="h-9 px-2.5 text-xs text-ink-2 hover:text-ink-1 border border-line hover:bg-surface-3 rounded-md transition-colors whitespace-nowrap"
          >
            Resetuj listę
          </button>
        </>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      {/* Drabina poziomów HTF (z realnych świec 1D/1W Hyperliquid) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {ladder.map((l) => (
          <div key={l.label} className="bg-surface-2 border border-line rounded-md px-2.5 py-2 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3 truncate">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-level shrink-0" aria-hidden="true" />
              <span className="truncate">{l.label}</span>
            </div>
            <div className="text-sm font-mono tabular-nums text-ink-1 mt-0.5">{fmtPrice(l.val, 0)}</div>
            <div className="text-[11px] font-mono tabular-nums text-ink-3">{distPct(l.val)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 flex flex-col gap-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Scenario
              title="Scenariusz A · LONG"
              sign="▲"
              signCls="text-buy-ink"
              zone={longZone}
              entry={longEntry}
              stop={longStop}
              target={longTarget}
              onEvaluate={() =>
                longEntry !== null &&
                onPrefillPlan({
                  direction: 'LONG',
                  entry: longEntry,
                  stop: longStop ?? undefined,
                  target: longTarget ?? undefined,
                  source: 'Plan na jutro',
                  note: `Scenariusz A: strefa ${longZone?.label}, stop 0.4×ATR pod strefą — hipoteza do oceny.`,
                })
              }
            />
            <Scenario
              title="Scenariusz B · SHORT"
              sign="▼"
              signCls="text-sell-ink"
              zone={shortZone}
              entry={shortEntry}
              stop={shortStop}
              target={shortTarget}
              onEvaluate={() =>
                shortEntry !== null &&
                onPrefillPlan({
                  direction: 'SHORT',
                  entry: shortEntry,
                  stop: shortStop ?? undefined,
                  target: shortTarget ?? undefined,
                  source: 'Plan na jutro',
                  note: `Scenariusz B: strefa ${shortZone?.label}, stop 0.4×ATR nad strefą — hipoteza do oceny.`,
                })
              }
            />
          </div>
          <p className="text-[11px] text-ink-3 leading-relaxed -mt-1">
            Scenariusze to mechaniczne hipotezy z poziomów struktury — nie rekomendacje. Oceń je w Analizatorze (prawdopodobieństwo,
            koszty, likwidacja) i zdecyduj sam.
          </p>

          <div className="bg-surface-2 border border-line rounded-lg p-3.5">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-1 mb-2.5">
              <Clock className="w-4 h-4 text-ink-3" aria-hidden="true" />
              Sesje (czas Nowego Jorku i Twój czas lokalny PL)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {sessions.map((s) => (
                <div key={s.name} className={`p-2.5 rounded-md border ${s.active ? 'border-accent/50 bg-surface-3' : 'border-line bg-surface-1'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-1">
                      {s.name} {s.active && <Badge tone="model">teraz</Badge>}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-ink-2">{s.pl}</span>
                  </div>
                  <div className="text-[11px] text-ink-3 font-mono tabular-nums mt-0.5">{s.ny}</div>
                  <div className="text-[11px] text-ink-2 mt-1 leading-snug">{s.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-surface-2 border border-line rounded-lg p-4 min-w-0">
          <div className="flex items-center justify-between pb-2.5 border-b border-line">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-1">
              <ShieldCheck className="w-4 h-4 text-ink-3" aria-hidden="true" />
              Lista kontrolna przed wejściem
            </div>
            <span className="text-[11px] font-mono tabular-nums text-ink-2">
              {done}/{CHECKLIST.length}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {CHECKLIST.map((item) => {
              const on = checked.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(item.id)}
                  className={`w-full text-left p-2.5 rounded-md border transition-colors flex items-start gap-2.5 ${
                    on ? 'border-line-strong bg-surface-3 text-ink-1' : 'border-line bg-surface-1 text-ink-2 hover:bg-surface-3'
                  }`}
                >
                  {on ? (
                    <CheckSquare className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <Square className="w-4 h-4 text-ink-3 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <span>
                    <span className="block text-xs font-medium">{item.title}</span>
                    <span className="block text-[11px] text-ink-3 mt-0.5 leading-snug">{item.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
};

const Scenario: React.FC<{
  title: string;
  sign: string;
  signCls: string;
  zone: { lo: number; hi: number; label: string } | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  onEvaluate: () => void;
}> = ({ title, sign, signCls, zone, entry, stop, target, onEvaluate }) => (
  <div className="bg-surface-2 border border-line rounded-lg p-3.5 flex flex-col justify-between gap-3 min-w-0">
    <div>
      <div className="text-xs font-medium text-ink-1 flex items-center gap-1.5">
        <span className={signCls} aria-hidden="true">
          {sign}
        </span>
        {title}
      </div>
      {zone ? (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-3">Strefa ({zone.label})</dt>
          <dd className="text-right font-mono tabular-nums text-ink-1">
            {fmtPrice(zone.lo, 0)}–{fmtPrice(zone.hi, 0)}
          </dd>
          <dt className="text-ink-3">Wejście (środek)</dt>
          <dd className="text-right font-mono tabular-nums text-ink-1">{fmtPrice(entry, 0)}</dd>
          <dt className="text-ink-3">− Stop</dt>
          <dd className="text-right font-mono tabular-nums text-ink-1">{fmtPrice(stop, 0)}</dd>
          <dt className="text-ink-3">+ Cel</dt>
          <dd className="text-right font-mono tabular-nums text-ink-1">{fmtPrice(target, 0)}</dd>
        </dl>
      ) : (
        <div className="mt-2.5 text-xs text-ink-3">Brak poziomów (PDH/PDL/D-EQ lub świeżego OB) — czekam na dane.</div>
      )}
    </div>
    <button
      type="button"
      disabled={entry === null}
      onClick={onEvaluate}
      className="w-full h-11 sm:h-9 rounded-md border border-line-strong text-xs font-medium text-ink-1 hover:bg-surface-3 disabled:opacity-40 disabled:pointer-events-none transition-colors inline-flex items-center justify-center gap-1.5"
    >
      <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
      Oceń w Analizatorze
    </button>
  </div>
);
