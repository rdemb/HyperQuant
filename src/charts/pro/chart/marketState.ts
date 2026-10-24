import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { fmtCompact } from '../../../ui/format';
import type { Candle } from '../hl/parse';
import type { FootprintBar } from '../core/footprintBar';
import type { VwapPoint } from '../core/indicators';
import type { PlayerSplit } from '../core/players';
import { fmtDuration } from '../draw/model';
import { fmtPx } from './layout';

/**
 * Stan rynku: jedno zdanie o bieżącej sytuacji złożone ze stałych reguł — położenie ceny względem VWAP w σ, kierunek
 * i czas trwania CVD, zgodność Binance i Bybit (gdy ich dane są włączone), zmiana otwartych pozycji, saldo dużych graczy
 * i nierównowaga bliskiego arkusza. Każdy fakt ma liczby, z których wynika („skąd?”). To opis, nie sygnał: bez ocen,
 * celów i zaleceń. Brak danych dla faktu — fakt pomijamy, nie zgadujemy.
 */

/** Okno faktów: tyle ostatnich świec wykresu (z bieżącą). */
export const STATE_BARS = 10;
/** Najdłuższy liczony ciąg świec z deltą w jedną stronę (tyle świec dostaje funkcja). */
export const STATE_RUN_MAX = 60;

/** Progi reguł (opisane w „skąd?” każdego faktu). */
const VWAP_NEAR_SD = 0.5;
const VWAP_FAR_SD = 2;
/** Delta okna poniżej tej części wolumenu z taśmy — CVD bez kierunku. */
const FLOW_EVEN = 0.05;
/** Zmiana otwartych pozycji poniżej tylu % — bez większej zmiany. */
const OI_FLAT_PCT = 0.1;
/** Przewaga strony: |delta × cena| / wartość wejść grupy poniżej tego — bez przewagi. */
const PLAYERS_EVEN = 0.1;
/** Udział jednej strony bliskiego arkusza od tego progu — przewaga. */
const BOOK_SIDE = 0.6;

export type StateKey = 'vwap' | 'cvd' | 'venues' | 'oi' | 'players' | 'book';

export interface StateFact {
  key: StateKey;
  /** Nazwa faktu w rozwinięciu. */
  label: string;
  /** Fragment zdania. */
  text: string;
  /** Liczby i reguła, z których wynika fragment. */
  why: string;
  /** Kierunek do znacznika w rozwinięciu: 1 kupno albo wzrost, −1 sprzedaż albo spadek, 0 bez przewagi. */
  tone: -1 | 0 | 1;
}

export interface StateBar {
  t: number;
  candle: Candle;
  fp: FootprintBar | null;
}

export interface StateInput {
  /** Jednostka rynku (BTC, ETH…). */
  unit: string;
  /** Ostatnie świece rosnąco, z bieżącą (najwyżej STATE_RUN_MAX). */
  bars: readonly StateBar[];
  ms: number;
  now: number;
  /** VWAP okresu na ostatniej świecy i nazwa okresu („dnia”, „tygodnia”). */
  vwap: VwapPoint | null;
  vwapPeriod: string;
  oiAt: (t: number) => number | null;
  /** Wejścia dużych graczy i reszty od początku okna do teraz. */
  players: PlayerSplit | null;
  bigPlayerUsd: number;
  /** Delta Binance perp i Bybit w świecy o początku `t` (null bez danych); null — dane giełd wyłączone. */
  venues: { binance: (t: number) => number | null; bybit: (t: number) => number | null } | null;
  /** Wielkość bidów i asków bliskiego arkusza (jednostki rynku); null bez świeżej migawki. */
  book: { bid: number; ask: number } | null;
}

const sign = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** Zaokrąglenie do `d` miejsc: progi reguł porównujemy z liczbą, którą widać w „skąd?”. */
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const dec = (v: number, d: number) => Math.abs(v).toFixed(d).replace('.', ',');
const signed = (v: number, d: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${dec(v, d)}${unit}`;
const usd = (v: number) => `${fmtCompact(v).replace(/\.0([KMB])$/, '$1')} USD`;
/** „świeca”, „świece”, „świec” po liczbie. */
const bars = (n: number) => (n === 1 ? 'świeca' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'świece' : 'świec');

function vwapFact(x: StateInput, close: number): StateFact | null {
  const v = x.vwap;
  if (!v || !(v.sd > 0)) return null;
  const z = round((close - v.vwap) / v.sd, 1);
  const a = Math.abs(z);
  const name = `VWAP ${x.vwapPeriod}`;
  const where = a < VWAP_NEAR_SD ? 'przy' : `${a >= VWAP_FAR_SD ? 'daleko ' : ''}${z > 0 ? 'nad' : 'pod'}`;
  return {
    key: 'vwap',
    label: 'VWAP',
    text: `cena ${where} ${name} (${signed(z, 1, 'σ')})`,
    why: `Zamknięcie ${fmtPx(close)}, ${name} ${fmtPx(v.vwap)}, odchylenie σ ${fmtPx(v.sd)}: ${signed(z, 1, 'σ')}. Do 0,5σ „przy”, do 2σ „nad” albo „pod”, dalej „daleko”.`,
    tone: a < VWAP_NEAR_SD ? 0 : sign(z),
  };
}

function cvdFact(x: StateInput, win: readonly StateBar[]): { fact: StateFact; dir: -1 | 0 | 1; delta: number; tape: StateBar[] } | null {
  const tape = win.filter((b) => b.fp);
  if (tape.length < 2) return null;
  let d = 0;
  let vol = 0;
  let up = 0;
  for (const b of tape) {
    d += b.fp!.delta;
    vol += b.fp!.buyVol + b.fp!.sellVol;
    if (b.fp!.delta > 0) up++;
  }
  const share = vol > 0 ? round(d / vol, 2) : 0;
  const dir = Math.abs(share) < FLOW_EVEN ? 0 : sign(share);
  // Ciąg świec z deltą w stronę okna, od najnowszej wstecz; bieżąca świeca w przeciwną stronę jeszcze trwa — pomijamy ją
  let run = 0;
  let from = Number.NaN;
  if (dir !== 0) {
    let i = x.bars.length - 1;
    if (i >= 0 && x.bars[i].t + x.ms > x.now && sign(x.bars[i].fp?.delta ?? 0) !== dir) i--;
    for (; i >= 0; i--) {
      const fp = x.bars[i].fp;
      if (!fp || sign(fp.delta) !== dir) break;
      run++;
      from = x.bars[i].t;
    }
  }
  const word = dir > 0 ? 'rośnie' : 'spada';
  const text = dir === 0 ? 'CVD bez wyraźnego kierunku' : run >= 2 ? `CVD ${word} od ${fmtDuration(x.now - from)}` : `CVD ${word}`;
  const runWhy = dir !== 0 && run > 0 ? ` Z rzędu ${run} ${bars(run)} z deltą ${dir > 0 ? 'dodatnią' : 'ujemną'}.` : '';
  return {
    fact: {
      key: 'cvd',
      label: 'CVD',
      text,
      why: `Delta ${tape.length} ${bars(tape.length)} z taśmy: ${fmtSignedVol(d)} ${x.unit} (${signed(share * 100, 0, '%')} wolumenu), ${up} z ${tape.length} na plus.${runWhy} Poniżej 5% wolumenu — bez kierunku.`,
      tone: dir,
    },
    dir,
    delta: d,
    tape,
  };
}

/**
 * Zgodność giełd w tych samych świecach co CVD Hyperliquid (świece z taśmy). Giełda bez delty w którejś z nich (Bybit ma
 * taśmę tylko od otwarcia strony) jest pominięta — suma z części świec porównywałaby inne okresy.
 */
function venuesFact(x: StateInput, cvd: { dir: -1 | 0 | 1; delta: number; tape: readonly StateBar[] }): StateFact | null {
  const v = x.venues;
  if (!v || cvd.dir === 0) return null;
  const n = cvd.tape.length;
  const sums = (['binance', 'bybit'] as const).map((k) => {
    let sum = 0;
    let have = 0;
    for (const b of cvd.tape) {
      const d = v[k](b.t);
      if (d === null) continue;
      sum += d;
      have++;
    }
    return { name: k === 'binance' ? 'Binance' : 'Bybit', label: k === 'binance' ? 'Binance perp' : 'Bybit', sum, have };
  });
  const list = sums.filter((g) => g.have === n).map((g) => ({ ...g, same: sign(g.sum) === cvd.dir }));
  if (list.length === 0) return null;
  const names = list.map((l) => l.name).join(' i ');
  const text = list.every((l) => l.same)
    ? `${names} w tę samą stronę`
    : list.every((l) => !l.same)
      ? `${names} w przeciwną stronę`
      : list.map((l) => `${l.name} w ${l.same ? 'tę samą stronę' : 'przeciwną'}`).join(', ');
  const parts = [`Hyperliquid ${fmtSignedVol(cvd.delta)}`, ...list.map((l) => `${l.label} ${fmtSignedVol(l.sum)}`)];
  const skipped = sums
    .filter((g) => g.have < n)
    .map((g) => ` ${g.name} pominięty: delta tylko z ${g.have} z ${n} świec.`)
    .join('');
  return {
    key: 'venues',
    label: 'Giełdy',
    text,
    why: `Delta w tych samych ${n} świecach z taśmy: ${parts.join(', ')} ${x.unit}. „Ta sama strona” — znak delty jak na Hyperliquid.${skipped}`,
    tone: list.every((l) => l.same) ? cvd.dir : 0,
  };
}

function oiFact(x: StateInput, win: readonly StateBar[]): StateFact | null {
  const o0 = x.oiAt(win[0].t);
  const o1 = x.oiAt(x.now);
  if (o0 === null || o1 === null || !(o0 > 0)) return null;
  const p = round((o1 / o0 - 1) * 100, 2);
  const dir = Math.abs(p) < OI_FLAT_PCT ? 0 : sign(p);
  return {
    key: 'oi',
    label: 'Otwarte pozycje',
    text: dir === 0 ? 'otwarte pozycje bez większej zmiany' : `otwarte pozycje ${dir > 0 ? 'rosną' : 'spadają'}`,
    why: `Otwarte pozycje Hyperliquid ${fmtVol(o0)} → ${fmtVol(o1)} ${x.unit} (${signed(p, 2, '%')}) od początku ostatnich ${win.length} ${bars(win.length)}. Poniżej 0,1% — bez większej zmiany.`,
    tone: dir,
  };
}

function playersFact(x: StateInput, price: number): StateFact | null {
  const p = x.players;
  if (!p || !(p.usd > 0) || !(price > 0)) return null;
  const restUsd = p.usd - p.bigUsd;
  const bigImb = p.bigUsd > 0 ? round((p.big * price) / p.bigUsd, 2) : 0;
  const restImb = restUsd > 0 ? round((p.rest * price) / restUsd, 2) : 0;
  const side = (imb: number) => (Math.abs(imb) < PLAYERS_EVEN ? 0 : sign(imb));
  const b = side(bigImb);
  const r = side(restImb);
  const word = (s: number) => (s > 0 ? 'kupna' : 'sprzedaży');
  const text = !(p.bigUsd > 0)
    ? 'bez wejść dużych graczy'
    : b === 0
      ? 'duzi gracze bez przewagi'
      : `duzi gracze po stronie ${word(b)}${r === -b ? `, reszta po stronie ${word(r)}` : ''}`;
  return {
    key: 'players',
    label: 'Duzi gracze',
    text,
    why:
      `Duzi gracze (konta od ${usd(x.bigPlayerUsd)} wejść w godzinie UTC): delta ${fmtSignedVol(p.big)} ${x.unit}, ` +
      `${dec(p.bigShare ?? 0, 0)}% wartości wejść, przewaga ${signed(bigImb * 100, 0, '%')}. Reszta: delta ${fmtSignedVol(p.rest)} ${x.unit}, ` +
      `przewaga ${signed(restImb * 100, 0, '%')}. Przewaga = delta × cena / wartość wejść grupy; poniżej 10% — bez przewagi.` +
      (p.complete ? '' : ' Konta biorców tylko z części okna: nagrywanie zaczęło się albo przerwało w jego trakcie.'),
    tone: b,
  };
}

function bookFact(x: StateInput): StateFact | null {
  const b = x.book;
  if (!b || !(b.bid + b.ask > 0)) return null;
  const s = round(b.bid / (b.bid + b.ask), 2);
  const tone = s >= BOOK_SIDE ? 1 : s <= 1 - BOOK_SIDE ? -1 : 0;
  return {
    key: 'book',
    label: 'Arkusz',
    text: tone > 0 ? 'w arkuszu przewaga bidów' : tone < 0 ? 'w arkuszu przewaga asków' : 'arkusz w równowadze',
    why: `Bliski arkusz Hyperliquid: bidy ${fmtVol(b.bid)}, aski ${fmtVol(b.ask)} ${x.unit}, ${Math.round(s * 100)}% po stronie bidów. Od 60% po jednej stronie — przewaga.`,
    tone,
  };
}

/** Fakty w stałej kolejności zdania; fakt bez danych pominięty. */
export function marketState(x: StateInput): StateFact[] {
  const n = x.bars.length;
  if (n === 0) return [];
  const win = x.bars.slice(-STATE_BARS);
  const close = x.bars[n - 1].candle.c;
  const cvd = cvdFact(x, win);
  return [vwapFact(x, close), cvd?.fact ?? null, cvd ? venuesFact(x, cvd) : null, oiFact(x, win), playersFact(x, close), bookFact(x)].filter(
    (f): f is StateFact => f !== null
  );
}

/** Zdanie z faktów: wielka litera na początku, fakty po przecinku, kropka na końcu. */
export function stateSentence(facts: readonly StateFact[]): string {
  if (facts.length === 0) return '';
  const s = facts.map((f) => f.text).join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
