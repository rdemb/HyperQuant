import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { fmtCompact } from '../../../ui/format';
import type { Candle } from '../hl/parse';
import type { FootprintBar } from '../core/footprintBar';
import type { VwapPoint } from '../core/indicators';
import type { PlayerSplit } from '../core/players';
import { fmtDuration } from '../draw/model';
import { fmtPx } from './layout';
import { lang, tr } from '../../../i18n';

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
const dec = (v: number, d: number) => (lang === 'en' ? Math.abs(v).toFixed(d) : Math.abs(v).toFixed(d).replace('.', ','));
const signed = (v: number, d: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${dec(v, d)}${unit}`;
/**
 * Liczba z formatera wykresu (przecinek tysięcy, kropka dziesiętna) zapisem języka strony: po polsku spacja tysięcy
 * i przecinek dziesiętny, jak „+0,6σ” obok — bez przecinka w dwóch znaczeniach w jednym zdaniu.
 */
const loc = (s: string) => (lang === 'en' ? s : s.replace(/,/g, '\u00a0').replace(/\./g, ','));
const px = (v: number) => loc(fmtPx(v));
const vol = (v: number) => loc(fmtVol(v));
const svol = (v: number) => loc(fmtSignedVol(v));
const usd = (v: number) => `${loc(fmtCompact(v).replace(/\.0([KMB])$/, '$1'))} USD`;
/** „świeca”, „świece”, „świec” po liczbie. */
const bars = (n: number) =>
  lang === 'en' ? (n === 1 ? 'candle' : 'candles') : n === 1 ? 'świeca' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'świece' : 'świec';

function vwapFact(x: StateInput, close: number): StateFact | null {
  const v = x.vwap;
  if (!v || !(v.sd > 0)) return null;
  const z = round((close - v.vwap) / v.sd, 1);
  const a = Math.abs(z);
  const name = tr(`VWAP ${x.vwapPeriod}`, `${x.vwapPeriod} VWAP`);
  const where =
    a < VWAP_NEAR_SD
      ? tr('przy', 'at')
      : `${a >= VWAP_FAR_SD ? tr('daleko ', 'far ') : ''}${z > 0 ? tr('nad', 'above') : tr('pod', 'below')}`;
  return {
    key: 'vwap',
    label: 'VWAP',
    text: tr(`cena ${where} ${name} (${signed(z, 1, 'σ')})`, `price ${where} the ${name} (${signed(z, 1, 'σ')})`),
    why: tr(
      `Zamknięcie ${px(close)}, ${name} ${px(v.vwap)}, odchylenie σ ${px(v.sd)}: ${signed(z, 1, 'σ')}. Do 0,5σ „przy”, do 2σ „nad” albo „pod”, dalej „daleko”.`,
      `Close ${px(close)}, ${name} ${px(v.vwap)}, deviation σ ${px(v.sd)}: ${signed(z, 1, 'σ')}. Up to 0.5σ “at”, up to 2σ “above” or “below”, beyond that “far”.`
    ),
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
  const word = dir > 0 ? tr('rośnie', 'rising') : tr('spada', 'falling');
  const text =
    dir === 0
      ? tr('CVD bez wyraźnego kierunku', 'CVD with no clear direction')
      : run >= 2
        ? tr(`CVD ${word} od ${fmtDuration(x.now - from)}`, `CVD ${word} for ${fmtDuration(x.now - from)}`)
        : `CVD ${word}`;
  const runWhy =
    dir !== 0 && run > 0
      ? tr(` Z rzędu ${run} ${bars(run)} z deltą ${dir > 0 ? 'dodatnią' : 'ujemną'}.`, ` ${run} ${bars(run)} in a row with ${dir > 0 ? 'positive' : 'negative'} delta.`)
      : '';
  return {
    fact: {
      key: 'cvd',
      label: 'CVD',
      text,
      why: tr(
        `Delta ${tape.length} ${bars(tape.length)} z taśmy: ${svol(d)} ${x.unit} (${signed(share * 100, 0, '%')} wolumenu), ${up} z ${tape.length} na plus.${runWhy} Poniżej 5% wolumenu — bez kierunku.`,
        `Delta of ${tape.length} ${bars(tape.length)} from the tape: ${svol(d)} ${x.unit} (${signed(share * 100, 0, '%')} of volume), ${up} of ${tape.length} positive.${runWhy} Below 5% of volume — no direction.`
      ),
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
  const names = list.map((l) => l.name).join(tr(' i ', ' and '));
  const text = list.every((l) => l.same)
    ? tr(`${names} w tę samą stronę`, `${names} in the same direction`)
    : list.every((l) => !l.same)
      ? tr(`${names} w przeciwną stronę`, `${names} in the opposite direction`)
      : list.map((l) => tr(`${l.name} w ${l.same ? 'tę samą stronę' : 'przeciwną'}`, `${l.name} in the ${l.same ? 'same direction' : 'opposite one'}`)).join(', ');
  const parts = [`Hyperliquid ${svol(cvd.delta)}`, ...list.map((l) => `${l.label} ${svol(l.sum)}`)];
  const skipped = sums
    .filter((g) => g.have < n)
    .map((g) => tr(` ${g.name} pominięty: delta tylko z ${g.have} z ${n} świec.`, ` ${g.name} skipped: delta only from ${g.have} of ${n} candles.`))
    .join('');
  return {
    key: 'venues',
    label: tr('Giełdy', 'Exchanges'),
    text,
    why: tr(
      `Delta w tych samych ${n} świecach z taśmy: ${parts.join(', ')} ${x.unit}. „Ta sama strona” — znak delty jak na Hyperliquid.${skipped}`,
      `Delta in the same ${n} candles from the tape: ${parts.join(', ')} ${x.unit}. “Same direction” — the delta sign as on Hyperliquid.${skipped}`
    ),
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
    label: tr('Otwarte pozycje', 'Open interest'),
    text:
      dir === 0
        ? tr('otwarte pozycje bez większej zmiany', 'open interest without a major change')
        : tr(`otwarte pozycje ${dir > 0 ? 'rosną' : 'spadają'}`, `open interest ${dir > 0 ? 'rising' : 'falling'}`),
    why: tr(
      `Otwarte pozycje Hyperliquid ${vol(o0)} → ${vol(o1)} ${x.unit} (${signed(p, 2, '%')}) od początku ostatnich ${win.length} ${bars(win.length)}. Poniżej 0,1% — bez większej zmiany.`,
      `Hyperliquid open interest ${vol(o0)} → ${vol(o1)} ${x.unit} (${signed(p, 2, '%')}) since the start of the last ${win.length} ${bars(win.length)}. Below 0.1% — no major change.`
    ),
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
  const word = (s: number) => (s > 0 ? tr('kupna', 'buying') : tr('sprzedaży', 'selling'));
  const text = !(p.bigUsd > 0)
    ? tr('bez wejść dużych graczy', 'no entries from large players')
    : b === 0
      ? tr('duzi gracze bez przewagi', 'large players without an edge')
      : tr(
          `duzi gracze po stronie ${word(b)}${r === -b ? `, reszta po stronie ${word(r)}` : ''}`,
          `large players on the ${word(b)} side${r === -b ? `, the rest on the ${word(r)} side` : ''}`
        );
  return {
    key: 'players',
    label: tr('Duzi gracze', 'Large players'),
    text,
    why: tr(
      `Duzi gracze (konta od ${usd(x.bigPlayerUsd)} wejść w godzinie UTC): delta ${svol(p.big)} ${x.unit}, ` +
        `${dec(p.bigShare ?? 0, 0)}% wartości wejść, przewaga ${signed(bigImb * 100, 0, '%')}. Reszta: delta ${svol(p.rest)} ${x.unit}, ` +
        `przewaga ${signed(restImb * 100, 0, '%')}. Przewaga = delta × cena / wartość wejść grupy; poniżej 10% — bez przewagi.` +
        (p.complete ? '' : ' Konta biorców tylko z części okna: nagrywanie zaczęło się albo przerwało w jego trakcie.'),
      `Large players (accounts with ${usd(x.bigPlayerUsd)} of entries in a UTC hour): delta ${svol(p.big)} ${x.unit}, ` +
        `${dec(p.bigShare ?? 0, 0)}% of entry value, edge ${signed(bigImb * 100, 0, '%')}. The rest: delta ${svol(p.rest)} ${x.unit}, ` +
        `edge ${signed(restImb * 100, 0, '%')}. Edge = delta × price / the group's entry value; below 10% — no edge.` +
        (p.complete ? '' : ' Taker accounts cover only part of the window: recording started or broke off during it.')
    ),
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
    label: tr('Arkusz', 'Book'),
    text:
      tone > 0
        ? tr('w arkuszu przewaga bidów', 'bids dominate the book')
        : tone < 0
          ? tr('w arkuszu przewaga asków', 'asks dominate the book')
          : tr('arkusz w równowadze', 'book in balance'),
    why: tr(
      `Bliski arkusz Hyperliquid: bidy ${vol(b.bid)}, aski ${vol(b.ask)} ${x.unit}, ${Math.round(s * 100)}% po stronie bidów. Od 60% po jednej stronie — przewaga.`,
      `Near Hyperliquid book: bids ${vol(b.bid)}, asks ${vol(b.ask)} ${x.unit}, ${Math.round(s * 100)}% on the bid side. From 60% on one side — dominance.`
    ),
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
