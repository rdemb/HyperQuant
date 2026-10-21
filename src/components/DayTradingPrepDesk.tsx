import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Clock,
  Crosshair,
  ShieldCheck,
  Square,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

interface DayTradingPrepDeskProps {
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  currentPrice: number;
  onTriggerScenarioSignal: (
    dir: 'LONG' | 'SHORT',
    title: string,
    reason: string
  ) => void;
}

interface ChecklistItem {
  id: string;
  title: string;
  detail: string;
  checked: boolean;
}

const INITIAL_CHECKLIST: ChecklistItem[] = [
  {
    id: 'chk-session',
    title: '01. Okno czasowe Killzone (Sesja NY / Londyn)',
    detail:
      'Handluj w oknach najwyższej płynności Shaakuni: London (08:00–11:00 PL), New York Open (13:00–16:00 PL) lub London Close (16:00–18:00 PL).',
    checked: true,
  },
  {
    id: 'chk-shaakuni',
    title: '02. Kontekst Shaakuni: Status PDH / PDL (Sweep ! vs Break) & EQ 50%',
    detail:
      'Sprawdź, czy cena znajduje się w dyskoncie (< D-EQ 50%) dla pozycji LONG lub w premii (> D-EQ 50%) dla pozycji SHORT, albo czy nastąpił płynnościowy Sweep PDH/PDL.',
    checked: true,
  },
  {
    id: 'chk-ob',
    title: '03. Retest świeżego Order Blocka (Unmitigated OB / POI ≥ 0.7x ATR)',
    detail:
      'Wejście powinno opierać się o niezmitigowaną strefę popytu/podaży wygenerowaną po wybiciu struktury z impulsem ATR.',
    checked: false,
  },
  {
    id: 'chk-aggr',
    title: '04. Konfluencja AggrBTCv5: Dywergencja Spot CVD vs Perp CVD + StDev Delta',
    detail:
      'Potwierdź absorpcję: dla LONG szukaj rosnącego Spot CVD (Coinbase/Binance) przy wyprzedaży na Perpach oraz słupka High-Vol (> 1σ) na histogramie Delta.',
    checked: false,
  },
  {
    id: 'chk-micro',
    title: '05. Mikrostruktura: VPIN > 45%, Lambda Kyle’a & Magnes Grawitacyjny U(p)',
    detail:
      'Upewnij się, że kierunek zagrania pokrywa się z niższym oporem arkusza L2 (Lambda Kyle’a) oraz głównym magnesem likwidacyjnym U(p).',
    checked: false,
  },
  {
    id: 'chk-risk',
    title: '06. Egzekucja Hyperliquid: Stop Loss za OB/Sweepem & Dźwignia wg Kelly’ego',
    detail:
      'Ustaw twardy Stop Loss 0.25x ATR poniżej/powyżej Order Blocka i ogranicz ryzyko na pojedynczy trejd do 0.5%–1.5% kapitału.',
    checked: false,
  },
];

export const DayTradingPrepDesk: React.FC<DayTradingPrepDeskProps> = ({
  shaakuni,
  quant,
  currentPrice,
  onTriggerScenarioSignal,
}) => {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem('hyperquant_daytrading_checklist');
      if (saved) return JSON.parse(saved);
    } catch {
      // Ignore storage errors
    }
    return INITIAL_CHECKLIST;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        'hyperquant_daytrading_checklist',
        JSON.stringify(checklist)
      );
    } catch {
      // Ignore storage errors
    }
  }, [checklist]);

  const toggleItem = (id: string) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const resetChecklist = () => {
    setChecklist(INITIAL_CHECKLIST.map((i) => ({ ...i, checked: false })));
  };

  const completedCount = checklist.filter((c) => c.checked).length;
  const readinessPct = Math.round((completedCount / checklist.length) * 100);

  const pdh = shaakuni.pdh ?? currentPrice + 450;
  const pdl = shaakuni.pdl ?? currentPrice - 650;
  const deq = shaakuni.deq ?? (pdh + pdl) / 2;
  const pwh = shaakuni.pwh ?? currentPrice + 1500;
  const pwl = shaakuni.pwl ?? currentPrice - 2200;
  const weq = shaakuni.weq ?? (pwh + pwl) / 2;

  const freshBullOB = shaakuni.orderBlocks
    .filter((o) => o.state === 'fresh' && o.type === 'bull')
    .slice(-1)[0];
  const freshBearOB = shaakuni.orderBlocks
    .filter((o) => o.state === 'fresh' && o.type === 'bear')
    .slice(-1)[0];

  // Dynamic Long & Short Gameplan levels for tomorrow
  const longEntryZone = freshBullOB
    ? `$${Math.round(freshBullOB.bottom)} – $${Math.round(freshBullOB.top)}`
    : `$${Math.round(pdl)} – $${Math.round(deq)}`;
  const longInvalidation = freshBullOB
    ? Math.round(freshBullOB.bottom - shaakuni.atr14 * 0.4)
    : Math.round(pdl - shaakuni.atr14 * 0.5);

  const shortEntryZone = freshBearOB
    ? `$${Math.round(freshBearOB.bottom)} – $${Math.round(freshBearOB.top)}`
    : `$${Math.round(pdh)} – $${Math.round(pdh + shaakuni.atr14 * 0.8)}`;
  const shortInvalidation = freshBearOB
    ? Math.round(freshBearOB.top + shaakuni.atr14 * 0.4)
    : Math.round(pdh + shaakuni.atr14 * 0.6);

  const sessionsSchedule = [
    {
      name: 'Asian Session',
      nyHours: '20:00 – 00:00 NY',
      plHours: '02:00 – 06:00 PL (CET)',
      profile: 'Budowanie zakresu początkowego i akumulacja płynności wokół D-EQ',
      isActive: shaakuni.nySession === 'Asian',
    },
    {
      name: 'London Killzone',
      nyHours: '02:00 – 05:00 NY',
      plHours: '08:00 – 11:00 PL (CET)',
      profile: 'Pierwszy impuls kierunkowy, częsty Sweep azjatyckiego High/Low lub PDL/PDH',
      isActive: shaakuni.nySession === 'London',
    },
    {
      name: 'New York Killzone',
      nyHours: '07:00 – 10:00 NY',
      plHours: '13:00 – 16:00 PL (CET)',
      profile: 'Największy wolumen Spot (Coinbase) + Perp (Hyperliquid), główne wybicia i retesty OB',
      isActive: shaakuni.nySession === 'New York',
    },
    {
      name: 'London Close',
      nyHours: '10:00 – 12:00 NY',
      plHours: '16:00 – 18:00 PL (CET)',
      profile: 'Realizacja zysków z sesji europejskiej, powrót Ornsteina-Uhlenbecka do D-EQ / VWAP',
      isActive: shaakuni.nySession === 'London Close',
    },
  ];

  return (
    <div className="bg-[#0B101B] border border-slate-800/90 rounded-lg p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-white">
            Plan Dnia & Pre-Market Desk na Jutro (BTCUSD Hyperliquid)
          </h2>
          <p className="text-xs text-slate-400">
            Zsynchronizowane z rzeczywistymi świecami 1D / 1W / 5M na Hyperliquid · Aktualna cena:{' '}
            <strong className="font-mono text-cyan-300">
              ${currentPrice.toFixed(1)}
            </strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs font-mono text-slate-300">
            Gotowość przedtrejdowa:{' '}
            <strong
              className={
                readinessPct >= 80
                  ? 'text-emerald-400'
                  : readinessPct >= 50
                  ? 'text-amber-300'
                  : 'text-rose-400'
              }
            >
              {completedCount}/{checklist.length} ({readinessPct}%)
            </strong>
          </div>
          <button
            type="button"
            onClick={resetChecklist}
            className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
          >
            Resetuj Checklistę
          </button>
        </div>
      </div>

      {/* Row 1: Complete Structural Price Ladder (PWH, PDH, POC, D-EQ, W-EQ, PDL, PWL) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 font-mono tabular-nums">
        {[
          {
            label: 'PWH (Prev Week High)',
            val: pwh,
            color: 'text-rose-400',
            sub: `${(((pwh - currentPrice) / currentPrice) * 100).toFixed(2)}%`,
          },
          {
            label: `PDH (${shaakuni.pdhStatus})`,
            val: pdh,
            color: 'text-orange-400',
            sub: `${(((pdh - currentPrice) / currentPrice) * 100).toFixed(2)}%`,
          },
          {
            label: 'Volume POC (Control)',
            val: quant.pocPrice,
            color: 'text-yellow-300',
            sub: 'Max Volume Node',
          },
          {
            label: 'D-EQ (Daily 50%)',
            val: deq,
            color: 'text-cyan-300',
            sub: 'Intraday Equilibrium',
          },
          {
            label: 'W-EQ (Weekly 50%)',
            val: weq,
            color: 'text-amber-300',
            sub: 'Weekly Equilibrium',
          },
          {
            label: `PDL (${shaakuni.pdlStatus})`,
            val: pdl,
            color: 'text-sky-400',
            sub: `${(((pdl - currentPrice) / currentPrice) * 100).toFixed(2)}%`,
          },
          {
            label: 'PWL (Prev Week Low)',
            val: pwl,
            color: 'text-emerald-400',
            sub: `${(((pwl - currentPrice) / currentPrice) * 100).toFixed(2)}%`,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-[#090D16] border border-slate-800/90 rounded-md p-2.5"
          >
            <div className="text-[10px] font-sans text-slate-400 truncate">
              {item.label}
            </div>
            <div className={`text-sm font-bold mt-0.5 ${item.color}`}>
              ${Math.round(item.val).toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* Row 2: Two Actionable Gameplan Scenarios (Long Plan vs Short Plan) + Pre-Trade Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7 Cols: Scenarios & NY/PL Killzone Schedule */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Scenario A: Bullish Setup */}
            <div className="bg-[#090D16] border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" />
                    <span>SCENARIUSZ A: LONG (BULLISH PLAN)</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    P(PDH) = {(quant.combinatorialPathProbPDH * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-xs font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Strefa Wejścia (POI):</span>
                    <span className="text-white font-semibold">{longEntryZone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Warunek Wyzwalający:</span>
                    <span className="text-cyan-300 font-sans">
                      Sweep PDL / Retest Bull OB + Spot CVD ↑
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Cel 1 (TP1):</span>
                    <span className="text-emerald-400">
                      ${Math.round(Math.max(deq, currentPrice + 280)).toLocaleString()} (D-EQ / POC)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Cel 2 (TP2):</span>
                    <span className="text-cyan-300">
                      ${Math.round(pdh).toLocaleString()} (PDH) → ${Math.round(pwh).toLocaleString()} (PWH)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Inwalidacja (SL):</span>
                    <span className="text-rose-400">
                      Zamknięcie 5m poniżej ${longInvalidation.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onTriggerScenarioSignal(
                    'LONG',
                    'HYPERLIQUID LONG // GAMEPLAN SCENARIO A',
                    `Aktywowano Scenariusz A (Long) ze strefy ${longEntryZone} z celem na PDH ($${Math.round(
                      pdh
                    )}) i SL na $${longInvalidation}.`
                  )
                }
                className="mt-3 w-full py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Załaduj Scenariusz LONG na Wykres</span>
              </button>
            </div>

            {/* Scenario B: Bearish Setup */}
            <div className="bg-[#090D16] border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4" />
                    <span>SCENARIUSZ B: SHORT (BEARISH PLAN)</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    P(PDL) = {(quant.combinatorialPathProbPDL * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-xs font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Strefa Podaży (POI):</span>
                    <span className="text-white font-semibold">{shortEntryZone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Warunek Wyzwalający:</span>
                    <span className="text-amber-300 font-sans">
                      Sweep PDH / Bear OB + Wyczerpanie Perp CVD
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Cel 1 (TP1):</span>
                    <span className="text-emerald-400">
                      ${Math.round(deq).toLocaleString()} (D-EQ 50%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Cel 2 (TP2):</span>
                    <span className="text-cyan-300">
                      ${Math.round(pdl).toLocaleString()} (PDL) → ${Math.round(pwl).toLocaleString()} (PWL)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Inwalidacja (SL):</span>
                    <span className="text-rose-400">
                      Zamknięcie 5m powyżej ${shortInvalidation.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onTriggerScenarioSignal(
                    'SHORT',
                    'HYPERLIQUID SHORT // GAMEPLAN SCENARIO B',
                    `Aktywowano Scenariusz B (Short) ze strefy ${shortEntryZone} z celem na D-EQ ($${Math.round(
                      deq
                    )}) oraz PDL ($${Math.round(pdl)}).`
                  )
                }
                className="mt-3 w-full py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Załaduj Scenariusz SHORT na Wykres</span>
              </button>
            </div>
          </div>

          {/* Killzones Schedule (NY vs Czas Polski PL) */}
          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2.5">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span>Harmonogram Sesji Shaakuni na Jutro (Czas Nowojorski NY vs Czas Polski CET)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {sessionsSchedule.map((s) => (
                <div
                  key={s.name}
                  className={`p-2.5 rounded border ${
                    s.isActive
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-[#0B101B] border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-sans font-semibold text-white">
                      {s.name}
                    </span>
                    <span className="text-cyan-300 text-[11px]">{s.plHours}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {s.nyHours}
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1 leading-snug">
                    {s.profile}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Interactive Pre-Trade Checklist */}
        <div className="lg:col-span-5 bg-[#090D16] border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-white">
                  Procedura Przedtrejdowa (Quant + PA Checklist)
                </span>
              </div>
              <span className="text-[11px] font-mono text-cyan-300">
                {completedCount}/{checklist.length}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className={`w-full text-left p-2.5 rounded-md border transition-colors flex items-start gap-2.5 ${
                    item.checked
                      ? 'bg-emerald-500/10 border-emerald-500/35 text-slate-100'
                      : 'bg-[#0B101B] border-slate-800 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  {item.checked ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-xs font-semibold">{item.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                      {item.detail}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
