import React, { useEffect, useRef } from 'react';
import { Highlighter, Volume2, VolumeX, X } from 'lucide-react';
import { fmtCompact } from '../../../ui/format';
import { fmtSignedVol } from '../../orderflow/renderer';
import { fmtVol } from '../../orderflow/footprint';
import { classify, shortAddress, walletSummary } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';
import { fmtHms } from '../core/time';
import type { ProStore } from '../store/proStore';
import { fmtPx } from './layout';
import type { LiquidityPick } from './liquidity';
import type { ChartSettings } from './settings';

/**
 * Karta obiektu klikniętego na wykresie (zlecenie agresora z podsumowaniem adresu biorcy, seria, ściana)
 * i taśma zleceń agresora (Time & Sales) z filtrem wartości i dźwiękiem dużych zleceń.
 * Adres biorcy pochodzi z publicznych transakcji Hyperliquid; pokazujemy go skróconego i nie zapisujemy.
 */

/** 200K zamiast 200.0K. */
export const compact = (v: number) => fmtCompact(v).replace(/\.0([KMB])$/, '$1');
const usd = (v: number) => `${compact(v)} USD`;
const amount = (v: number, coin: string) => `${fmtVol(v)} ${coin}`;

const SideTag: React.FC<{ buy: boolean; children?: React.ReactNode }> = ({ buy, children }) => (
  <span className={`font-semibold ${buy ? 'text-of-buy-ink' : 'text-of-sell-ink'}`}>{children ?? (buy ? 'Kupno' : 'Sprzedaż')}</span>
);

const ClassTag: React.FC<{ label: string; tone: 'clash' | 'big' | 'plain' }> = ({ label, tone }) => (
  <span
    className={`px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-[0.06em] ${
      tone === 'clash' ? 'bg-warn/20 text-warn' : tone === 'big' ? 'bg-surface-3 text-ink-1' : 'bg-surface-3 text-ink-3'
    }`}
  >
    {label}
  </span>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-ink-3">{label}</span>
    <span className="font-mono text-ink-1 text-right">{children}</span>
  </div>
);

export const PickCard: React.FC<{
  pick: LiquidityPick;
  store: ProStore;
  bigUsd: number;
  highlight: string;
  onHighlight: (address: string) => void;
  onClose: () => void;
}> = ({ pick, store, bigUsd, highlight, onHighlight, onClose }) => {
  let head: React.ReactNode;
  let body: React.ReactNode;
  if (pick.kind === 'order') {
    const o = pick.order;
    const buy = o.side === 1;
    const top = o.notional > 0 ? o.topMakerUsd / o.notional : 0;
    const w = o.taker ? walletSummary(store.orders.range(0, Number.MAX_SAFE_INTEGER), o.taker) : null;
    head = (
      <>
        <SideTag buy={buy} />
        <ClassTag label={pick.cls === 'clash' ? 'Bitwa' : pick.cls === 'big' ? 'Duże zlecenie' : 'Zlecenie'} tone={pick.cls ?? 'plain'} />
        <span className="font-mono text-ink-3">{fmtHms(o.time)}</span>
      </>
    );
    body = (
      <>
        <Row label="Wielkość">
          {amount(o.sz, store.coin)} · {usd(o.notional)}
        </Row>
        <Row label="Cena średnia">{fmtPx(o.vwap)}</Row>
        <Row label="Zakres">
          {fmtPx(o.pxFirst)} → {fmtPx(o.pxLast)} · {o.levels} {o.levels === 1 ? 'poziom' : 'poz.'}
        </Row>
        <Row label="Makerzy">{o.makers}</Row>
        <Row label="Największy maker">
          {usd(o.topMakerUsd)} · {Math.round(top * 100)}%
        </Row>
        {pick.cls === 'clash' && (
          <p className="text-[11px] leading-snug text-warn">Jeden maker przyjął co najmniej połowę progu ({usd(bigUsd / 2)}) z tego zlecenia.</p>
        )}
        <div className="mt-1 pt-2 border-t border-line flex flex-col gap-1">
          {w ? (
            <>
              <Row label="Adres biorcy">{w.label}</Row>
              <Row label="Zleceń na taśmie">{w.orders}</Row>
              <Row label="Kupno / sprzedaż">
                <SideTag buy>{fmtVol(w.buySz)}</SideTag> / <SideTag buy={false}>{fmtVol(w.sellSz)}</SideTag> {store.coin}
              </Row>
              <Row label="Netto">
                {fmtSignedVol(w.buySz - w.sellSz)} {store.coin}
              </Row>
              <Row label="Największe">{usd(w.largestUsd)}</Row>
              <Row label="Aktywny">
                {fmtHms(w.first)} – {fmtHms(w.last)}
              </Row>
              <button
                type="button"
                onClick={() => onHighlight(highlight === o.taker ? '' : o.taker)}
                className={`mt-1 inline-flex items-center justify-center gap-1.5 min-h-9 px-3 rounded-lg border text-xs font-medium ${
                  highlight === o.taker ? 'bg-warn/15 border-warn/50 text-warn' : 'border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3'
                }`}
              >
                <Highlighter className="w-3.5 h-3.5" />
                {highlight === o.taker ? 'Wyłącz podświetlenie' : 'Podświetl zlecenia tego adresu'}
              </button>
              <p className="text-[10px] leading-snug text-ink-3">Publiczne dane Hyperliquid od otwarcia strony. Adres nie jest zapisywany.</p>
            </>
          ) : (
            <p className="text-[11px] text-ink-3">Transakcja bez adresu biorcy.</p>
          )}
        </div>
      </>
    );
  } else if (pick.kind === 'burst') {
    const b = pick.burst;
    head = (
      <>
        <SideTag buy={b.side === 1} />
        <ClassTag label="Seria" tone="big" />
        <span className="font-mono text-ink-3">
          {fmtHms(b.from)}–{fmtHms(b.to)}
        </span>
      </>
    );
    body = (
      <>
        <Row label="Zleceń / adresów">
          {b.orders} / {b.takers}
        </Row>
        <Row label="Razem">
          {amount(b.sz, store.coin)} · {usd(b.usd)}
        </Row>
        <Row label="Cena średnia">{fmtPx(b.vwap)}</Row>
        <p className="text-[11px] leading-snug text-ink-3">
          Drobne zlecenia (każde poniżej {usd(bigUsd / 4)}) różnych adresów po jednej stronie w ciągu 2 s, razem od progu {usd(bigUsd)}.
        </p>
      </>
    );
  } else {
    const w = pick.wall;
    const bid = w.side === 1;
    head = (
      <>
        <SideTag buy={bid}>{bid ? 'Ściana na bidzie' : 'Ściana na asku'}</SideTag>
        <span className="font-mono text-ink-1">{fmtPx(w.px)}</span>
      </>
    );
    body = (
      <>
        <Row label="Wchłonięte">
          {amount(w.sz, store.coin)} · {usd(w.usd)}
        </Row>
        <Row label="Zleceń agresora">{w.hits}</Row>
        <Row label="Czas">
          {fmtHms(w.from)} – {fmtHms(w.to)}
        </Row>
        <p className="text-[11px] leading-snug text-ink-3">
          Jeden maker na tej cenie przyjmował {bid ? 'agresywną sprzedaż' : 'agresywne kupno'} (przerwy najwyżej 30 s).
        </p>
      </>
    );
  }
  return (
    <div className="bg-surface-2/95 backdrop-blur border border-line-strong rounded-xl p-3 shadow-2xl flex flex-col gap-1.5 text-xs">
      <div className="flex items-center gap-2 mb-0.5">
        {head}
        <button
          type="button"
          aria-label="Zamknij"
          title="Zamknij"
          onClick={onClose}
          className="ml-auto -mr-1 inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {body}
    </div>
  );
};

const TAPE_MIN_OPTIONS = [0, 10_000, 50_000, 100_000, 250_000, 1_000_000];
/** Przeglądane najnowsze zlecenia i najwięcej wierszy taśmy. */
const TAPE_SCAN = 3000;
const TAPE_ROWS = 160;

/** Krótki ton: kupno wyżej, sprzedaż niżej. */
function beep(ctx: AudioContext, buy: boolean): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = buy ? 880 : 520;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

export const TapePanel: React.FC<{
  store: ProStore;
  settings: ChartSettings;
  bigUsd: number;
  selected: AggressorOrder | null;
  highlight: string;
  className: string;
  onPick: (o: AggressorOrder) => void;
  onChange: (p: Partial<ChartSettings>) => void;
}> = ({ store, settings: s, bigUsd, selected, highlight, className, onPick, onChange }) => {
  const recent = store.orders.latest(TAPE_SCAN);
  const rows: AggressorOrder[] = [];
  for (const o of recent) {
    if (o.notional < s.tapeMinUsd) continue;
    rows.push(o);
    if (rows.length >= TAPE_ROWS) break;
  }

  // Dźwięk: tylko nowe zlecenia od progu dużego (pierwsze renderowanie oznacza zastane jako widziane)
  const seen = useRef<WeakSet<AggressorOrder> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const first = seen.current === null;
    const set = (seen.current ??= new WeakSet());
    let fresh: AggressorOrder | null = null;
    for (const o of recent.slice(0, 50)) {
      if (set.has(o)) continue;
      set.add(o);
      if (!first && o.notional >= bigUsd && (!fresh || o.notional > fresh.notional)) fresh = o;
    }
    if (fresh && s.tapeSound) {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === 'running') beep(audio.current, fresh.side === 1);
      } catch {
        // Przeglądarka bez Web Audio — taśma działa bez dźwięku
      }
    }
  });

  const toggleSound = () => {
    if (!s.tapeSound) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        // jak wyżej
      }
    }
    onChange({ tapeSound: !s.tapeSound });
  };

  return (
    <aside aria-label="Taśma zleceń" className={`flex flex-col min-h-0 bg-surface-1 border-l border-line ${className}`}>
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line shrink-0">
        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium mr-auto">Taśma zleceń</span>
        <select
          aria-label="Najmniejsza wartość zlecenia na taśmie"
          value={s.tapeMinUsd}
          onChange={(e) => onChange({ tapeMinUsd: Number(e.target.value) })}
          className="h-8 bg-page border border-line rounded-md px-1.5 font-mono text-[11px] text-ink-1"
        >
          {TAPE_MIN_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Wszystkie' : `od ${compact(v)}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={s.tapeSound ? 'Wyłącz dźwięk dużych zleceń' : 'Dźwięk dużych zleceń'}
          title={s.tapeSound ? 'Wyłącz dźwięk dużych zleceń' : `Dźwięk zleceń od ${usd(bigUsd)}`}
          aria-pressed={s.tapeSound}
          onClick={toggleSound}
          className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${s.tapeSound ? 'text-ink-1 bg-surface-3' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-2'}`}
        >
          {s.tapeSound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <button
          type="button"
          aria-label="Zamknij taśmę"
          title="Zamknij taśmę"
          onClick={() => onChange({ showTape: false })}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-[4.2rem_1fr_3.4rem_3.6rem] gap-x-1.5 px-2 py-1 border-b border-line font-mono text-[10px] text-ink-3 shrink-0">
        <span>Czas</span>
        <span className="text-right">Cena</span>
        <span className="text-right">{store.coin}</span>
        <span className="text-right">USD</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {rows.length === 0 && <p className="px-3 py-4 text-[11px] text-ink-3">Brak zleceń od tej wartości od otwarcia strony.</p>}
        {rows.map((o) => {
          const buy = o.side === 1;
          const cls = classify(o, bigUsd);
          const fill = Math.min(1, o.notional / bigUsd);
          const active = selected === o || (highlight !== '' && o.taker === highlight);
          return (
            <button
              key={`${o.time}|${o.taker}|${o.vwap}|${o.sz}`}
              type="button"
              onClick={() => onPick(o)}
              className={`relative grid w-full grid-cols-[4.2rem_1fr_3.4rem_3.6rem] gap-x-1.5 px-2 h-6 items-center font-mono text-[11px] text-left hover:bg-surface-2 ${
                active ? 'outline outline-1 -outline-offset-1 outline-warn/70' : ''
              }`}
            >
              {/* Pasek wartości zlecenia względem progu dużego */}
              <span aria-hidden="true" className={`absolute inset-y-0 right-0 ${buy ? 'bg-of-buy/15' : 'bg-of-sell/25'}`} style={{ width: `${fill * 100}%` }} />
              <span className="relative text-ink-3">{fmtHms(o.time)}</span>
              <span className={`relative text-right ${buy ? 'text-of-buy-ink' : 'text-of-sell-ink'} ${cls ? 'font-semibold' : ''}`}>{fmtPx(o.vwap)}</span>
              <span className={`relative text-right ${cls ? 'text-ink-1 font-semibold' : 'text-ink-2'}`}>{fmtVol(o.sz)}</span>
              <span className={`relative text-right ${cls === 'clash' ? 'text-warn font-semibold' : cls ? 'text-ink-1 font-semibold' : 'text-ink-2'}`}>
                {compact(o.notional)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-2 py-1.5 border-t border-line text-[10px] leading-snug text-ink-3 shrink-0">
        Zlecenia agresora złożone z wypełnień · pogrubione od {usd(bigUsd)}, <span className="text-warn">żółte</span> = bitwa z jednym makerem
      </p>
    </aside>
  );
};
