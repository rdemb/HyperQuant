import { tr } from '../../../i18n';
import { fmtFixed, fmtSigned } from '../../../ui/format';
import { PRO } from './theme';

/**
 * Częstości bazowe wskaźnika „Struktura i płynność (SMC+HL)” (etap S2): co działo się po takich elementach w historii,
 * obok tego samego dla losowej kontroli (smc-hl.md §3 i §8). Liczby policzył raz Backtester (BTCUSDT perp z Binance,
 * świece 5m od 2020, kolejność w świecy z 1m); `scripts/smc/rates.mjs` składa je w `data/smcRates.json` (tylko
 * sprawdzian 2024+, poza próbą uczenia). Plik ładuje się leniwie przy pierwszej legendzie. Wynik negatywny też jest
 * pokazany: przedział 95% obejmujący 0 to „bez wyraźnej różnicy”, a przy n < 100 „—: za mało przypadków”. To opis
 * przeszłości, bez prognozy.
 */

export const SMC_RATE_TFS = ['5m', '15m', '1h', '4h', '1d'] as const;
export type SmcRateTf = (typeof SMC_RATE_TFS)[number];

export const SMC_RATE_ELEMENTS = ['FVG', 'BOS_swing', 'CHoCH_swing', 'BOS_internal', 'CHoCH_internal', 'sweep', 'EQH_EQL'] as const;
export type SmcRateElement = (typeof SMC_RATE_ELEMENTS)[number];

type Unit = 'pct' | 'atr';

/** Miary pliku: element → miara → jednostka (ta sama lista co w skrypcie). */
export const SMC_RATE_MEASURES: Record<SmcRateElement, readonly (readonly [string, Unit])[]> = {
  FVG: [
    ['ce_24', 'pct'],
    ['fill_24', 'pct'],
  ],
  BOS_swing: [
    ['dalszy_ruch_ATR', 'atr'],
    ['powrot_24', 'pct'],
  ],
  CHoCH_swing: [
    ['dalszy_ruch_ATR', 'atr'],
    ['powrot_24', 'pct'],
  ],
  BOS_internal: [
    ['dalszy_ruch_ATR', 'atr'],
    ['powrot_24', 'pct'],
  ],
  CHoCH_internal: [
    ['dalszy_ruch_ATR', 'atr'],
    ['powrot_24', 'pct'],
  ],
  sweep: [['ponowne_wyjscie_24', 'pct']],
  EQH_EQL: [['sweep_lub_przelamanie_72', 'pct']],
};

/** Miary, przy których legenda ma pokazywać kontrolę dopasowaną do zmienności i pędu (smc-hl.md §8). */
const MATCH_EXPECTED = new Set(['BOS_swing.dalszy_ruch_ATR', 'BOS_swing.powrot_24', 'sweep.ponowne_wyjscie_24']);

/** Najmniejsze n, przy którym pokazujemy liczby. */
export const SMC_RATE_MIN_N = 100;

/** Miara: element, kontrola i różnica (w %, punktach procentowych albo ATR), przedział 95% różnicy i wniosek z niego. */
export interface SmcRate {
  n: number;
  v?: number;
  c?: number;
  d?: number;
  ci?: [number, number];
  /** 1 — element wyżej niż kontrola, −1 — niżej, 0 — przedział obejmuje 0. */
  z?: -1 | 0 | 1;
  /** Odsetek przypadków niejednoznacznych na 1m, pominiętych w n. */
  amb?: number;
  /** 1 — kontrola dopasowana do zmienności i pędu. */
  m?: 1;
}

export interface SmcRates {
  wersja: 1;
  zrodlo: { dane: string; dane_en: string; od: string; do: string; przedzial: string; definicje: string; kontrola_dopasowana: string; autor: string; wygenerowano: string };
  interwaly: Record<SmcRateTf, Record<string, SmcRate>>;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function parseRate(x: unknown, where: string): SmcRate {
  if (!isObj(x) || !isNum(x.n) || x.n < 0) throw new Error(`${where}: brak n`);
  if (x.v === undefined) return { n: x.n, ...(isNum(x.amb) ? { amb: x.amb } : {}) };
  const ci = x.ci;
  if (!isNum(x.v) || !isNum(x.c) || !isNum(x.d) || !Array.isArray(ci) || ci.length !== 2 || !ci.every(isNum) || ci[0] > ci[1]) throw new Error(`${where}: niepełna miara`);
  if (x.z !== -1 && x.z !== 0 && x.z !== 1) throw new Error(`${where}: zły wniosek`);
  if (x.amb !== undefined && !isNum(x.amb)) throw new Error(`${where}: zły odsetek niejednoznacznych`);
  if (x.m !== undefined && x.m !== 1) throw new Error(`${where}: złe m`);
  return x as unknown as SmcRate;
}

/** Sprawdzenie pliku na granicy (kształt, wszystkie interwały i miary); błąd z miejscem. */
export function parseSmcRates(x: unknown): SmcRates {
  if (!isObj(x) || x.wersja !== 1 || !isObj(x.zrodlo) || !isObj(x.interwaly)) throw new Error('smcRates: zły nagłówek');
  for (const k of ['dane', 'dane_en', 'od', 'do', 'przedzial', 'definicje', 'kontrola_dopasowana', 'autor', 'wygenerowano'])
    if (typeof x.zrodlo[k] !== 'string' || !x.zrodlo[k]) throw new Error(`smcRates: brak zrodlo.${k}`);
  for (const tf of SMC_RATE_TFS) {
    const t = x.interwaly[tf];
    if (!isObj(t)) throw new Error(`smcRates: brak interwału ${tf}`);
    for (const el of SMC_RATE_ELEMENTS) for (const [m] of SMC_RATE_MEASURES[el]) parseRate(t[`${el}.${m}`], `smcRates ${tf} ${el}.${m}`);
  }
  return x as unknown as SmcRates;
}

let cache: SmcRates | null = null;
let failed = false;
let pending: Promise<SmcRates> | null = null;

/** Leniwe wczytanie pliku (osobny kawałek paczki); ponowne wywołania zwracają ten sam wynik. */
export function loadSmcRates(): Promise<SmcRates> {
  pending ??= import('../data/smcRates.json').then(
    (mod) => (cache = parseSmcRates(mod.default)),
    (e: unknown) => {
      failed = true;
      throw e;
    }
  );
  return pending;
}

/** Plik, jeśli już wczytany; inaczej zaczyna wczytywanie i zwraca null. */
export function smcRatesNow(): SmcRates | null {
  if (!cache && !failed) loadSmcRates().catch(() => {});
  return cache;
}

const TF_OF_MS: Record<number, SmcRateTf> = { 300_000: '5m', 900_000: '15m', 3_600_000: '1h', 14_400_000: '4h', 86_400_000: '1d' };
const TF_LABEL: Record<SmcRateTf, string> = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4H', '1d': '1D' };

/** Interwał częstości dla interwału wykresu (tylko 5m, 15m, 1h, 4H i 1D). */
export const smcRateTf = (ms: number): SmcRateTf | null => TF_OF_MS[ms] ?? null;

interface ElementText {
  head: string;
  short: string;
  /** Kontrola w mianowniku i porównanie („niż po …”). */
  ctl: string;
  than: string;
}

function elementText(el: SmcRateElement): ElementText {
  const brk = (kind: string, swing: boolean): ElementText => ({
    head: swing ? tr(`${kind}, skala swingowa`, `${kind}, swing scale`) : tr(`${kind}, skala wewnętrzna`, `${kind}, internal scale`),
    short: swing ? tr(`${kind} swing.`, `${kind} swing`) : tr(`${kind} wewn.`, `${kind} internal`),
    ctl: tr('losowy poziom', 'random level'),
    than: tr('niż po losowym poziomie', 'than after a random level'),
  });
  switch (el) {
    case 'FVG':
      return { head: 'FVG', short: 'FVG', ctl: tr('losowa luka', 'random gap'), than: tr('niż przy losowej luce', 'than with a random gap') };
    case 'BOS_swing':
      return brk('BOS', true);
    case 'CHoCH_swing':
      return brk('CHoCH', true);
    case 'BOS_internal':
      return brk('BOS', false);
    case 'CHoCH_internal':
      return brk('CHoCH', false);
    case 'sweep':
      return { head: 'sweep', short: 'sweep', ctl: tr('losowy knot', 'random wick'), than: tr('niż po losowym knocie', 'than after a random wick') };
    case 'EQH_EQL':
      return {
        head: tr('EQH i EQL', 'EQH and EQL'),
        short: 'EQ',
        ctl: tr('pojedynczy szczyt lub dołek', 'single high or low'),
        than: tr('niż pojedynczy szczyt lub dołek', 'than a single high or low'),
      };
  }
}

/** Opis miary: pełny podpis (krzyż) i krótki z kierunkiem (legenda). */
function measureText(m: string, z: -1 | 1): { label: string; short: string; dir: string } {
  const more = z > 0;
  switch (m) {
    case 'ce_24':
      return {
        label: tr('środek luki (CE) dotknięty w 24 świecach', 'gap midpoint (CE) touched within 24 candles'),
        short: more ? tr('środek luki dotykany częściej', 'midpoint touched more often') : tr('środek luki dotykany rzadziej', 'midpoint touched less often'),
        dir: more ? tr('częściej', 'more often') : tr('rzadziej', 'less often'),
      };
    case 'fill_24':
      return {
        label: tr('cała luka wypełniona w 24 świecach', 'whole gap filled within 24 candles'),
        short: more ? tr('wypełniana częściej', 'filled more often') : tr('wypełniana rzadziej', 'filled less often'),
        dir: more ? tr('częściej', 'more often') : tr('rzadziej', 'less often'),
      };
    case 'dalszy_ruch_ATR':
      return {
        label: tr('dalszy ruch do pierwszego powrotu', 'further move until the first return'),
        short: more ? tr('dalszy ruch większy', 'further move larger') : tr('dalszy ruch mniejszy', 'further move smaller'),
        dir: more ? tr('większy', 'larger') : tr('mniejszy', 'smaller'),
      };
    case 'powrot_24':
      return {
        label: tr('powrót za poziom w 24 świecach', 'back beyond the level within 24 candles'),
        short: more ? tr('powrót za poziom częściej', 'back beyond the level more often') : tr('powrót za poziom rzadziej', 'back beyond the level less often'),
        dir: more ? tr('częściej', 'more often') : tr('rzadziej', 'less often'),
      };
    case 'ponowne_wyjscie_24':
      return {
        label: tr('ponownie za poziomem w 24 świecach', 'beyond the level again within 24 candles'),
        short: more ? tr('częściej ponownie za poziomem', 'more often beyond the level again') : tr('rzadziej ponownie za poziomem', 'less often beyond the level again'),
        dir: more ? tr('częściej', 'more often') : tr('rzadziej', 'less often'),
      };
    default:
      return {
        label: tr('zebrane albo przełamane w 72 świecach', 'swept or broken within 72 candles'),
        short: more ? tr('zebrane albo przełamane częściej', 'swept or broken more often') : tr('zebrane albo przełamane rzadziej', 'swept or broken less often'),
        dir: more ? tr('częściej', 'more often') : tr('rzadziej', 'less often'),
      };
  }
}

const unitOf = (el: SmcRateElement, m: string): Unit => SMC_RATE_MEASURES[el].find(([k]) => k === m)?.[1] ?? 'pct';
const digits = (u: Unit) => (u === 'atr' ? 2 : 1);
const val = (x: number, u: Unit) => (u === 'atr' ? `${fmtFixed(x, 2)} ATR` : `${fmtFixed(x, 1)}%`);
const diff = (x: number, u: Unit) => fmtSigned(x, digits(u), u === 'atr' ? ' ATR' : ' pp');
const ci = (r: readonly [number, number], u: Unit) => `[${fmtFixed(r[0], digits(u))}; ${fmtFixed(r[1], digits(u))}]`;
const count = (n: number) => fmtFixed(n, 0);
const years = (s: SmcRates) => `${s.zrodlo.od.slice(0, 4)}–${s.zrodlo.do.slice(0, 4)}`;

/** Dopisek o kontroli: dopasowana do zmienności i pędu albo (gdzie powinna być, a jej nie ma) zwykła. */
function ctlNote(key: string, r: SmcRate): string {
  if (r.m === 1) return tr(' przy tej samej zmienności i pędzie', ' at the same volatility and momentum');
  return MATCH_EXPECTED.has(key) ? tr(' (bez dopasowania do zmienności)', ' (not matched for volatility)') : '';
}

const nText = (r: SmcRate) =>
  r.amb !== undefined && r.amb > 0 ? tr(`n = ${count(r.n)} bez ${count(r.amb)}% niejednoznacznych na 1m`, `n = ${count(r.n)} without ${count(r.amb)}% ambiguous on 1m`) : `n = ${count(r.n)}`;

const shown = (r: SmcRate): r is Required<Pick<SmcRate, 'v' | 'c' | 'd' | 'ci' | 'z'>> & SmcRate => r.v !== undefined && r.n >= SMC_RATE_MIN_N;

/**
 * Pełny opis jednej miary pod krzyżem (§3): „BOS, skala swingowa (BTC 1h, 2024–2026, n = …): dalszy ruch … · losowy
 * poziom … · różnica +… [a; b] · wniosek”.
 */
export function smcRateText(s: SmcRates, tf: SmcRateTf, el: SmcRateElement, m: string): string {
  const key = `${el}.${m}`;
  const r = s.interwaly[tf][key];
  const t = elementText(el);
  const u = unitOf(el, m);
  const where = `BTC ${TF_LABEL[tf]}, ${years(s)}`;
  if (!r || !shown(r)) {
    const label = measureText(m, 1).label;
    return tr(`${t.head} (${where}): ${label}: —: za mało przypadków (n = ${count(r?.n ?? 0)})`, `${t.head} (${where}): ${label}: —: too few cases (n = ${count(r?.n ?? 0)})`);
  }
  const mt = measureText(m, r.z === 0 ? 1 : r.z);
  const note = ctlNote(key, r);
  const verdict = r.z === 0 ? tr('bez wyraźnej różnicy', 'no clear difference') : `${mt.dir} ${t.than}`;
  return `${t.head} (${where}, ${nText(r)}): ${mt.label} ${val(r.v, u)} · ${t.ctl}${note} ${val(r.c, u)} · ${tr('różnica', 'difference')} ${diff(r.d, u)} ${ci(r.ci, u)} · ${verdict}`;
}

/** Krótki wpis w legendzie: wynik z przedziałem, „bez wyraźnej różnicy” albo „za mało przypadków”, zawsze z n. */
function shortText(s: SmcRates, tf: SmcRateTf, el: SmcRateElement, m: string): { text: string; quiet: boolean } {
  const key = `${el}.${m}`;
  const r = s.interwaly[tf][key];
  const t = elementText(el);
  if (!shown(r)) return { text: tr(`${t.short}: —: za mało przypadków (n = ${count(r.n)})`, `${t.short}: —: too few cases (n = ${count(r.n)})`), quiet: true };
  const u = unitOf(el, m);
  const plain = r.m !== 1 && MATCH_EXPECTED.has(key) ? tr(', kontrola bez dopasowania do zmienności', ', control not matched for volatility') : '';
  if (r.z === 0) return { text: tr(`${t.short}: bez wyraźnej różnicy (n = ${count(r.n)}${plain})`, `${t.short}: no clear difference (n = ${count(r.n)}${plain})`), quiet: true };
  return { text: `${t.short}: ${measureText(m, r.z).short}, ${diff(r.d, u)} ${ci(r.ci, u)} (n = ${count(r.n)}${plain})`, quiet: false };
}

type LegendPart = { text: string; color: string };

/** Miary w krótkiej linii legendy: najwyraźniejszy ślad (BOS swing., sweep) i dwa elementy bez niego (FVG CE, EQ). */
const LINE: readonly (readonly [SmcRateElement, string])[] = [
  ['BOS_swing', 'dalszy_ruch_ATR'],
  ['sweep', 'ponowne_wyjscie_24'],
  ['FVG', 'ce_24'],
  ['EQH_EQL', 'sweep_lub_przelamanie_72'],
];

/** Linia legendy z częstościami bazowymi interwału wykresu (albo powód braku). */
export function smcRatesLine(ms: number, s: SmcRates | null = smcRatesNow()): LegendPart[] {
  const tf = smcRateTf(ms);
  if (!tf) return [{ text: tr('· częstości bazowe: —: brak częstości dla tego interwału', '· base rates: —: no base rates for this interval'), color: PRO.ink3 }];
  if (!s) return [{ text: failed ? tr('· częstości bazowe: —: nie udało się wczytać', '· base rates: —: failed to load') : tr('· częstości bazowe: wczytuję…', '· base rates: loading…'), color: PRO.ink3 }];
  const head = tr(
    `· częstości bazowe (BTC ${TF_LABEL[tf]}, ${years(s)}, wobec losowej kontroli, BOS i sweep przy tej samej zmienności):`,
    `· base rates (BTC ${TF_LABEL[tf]}, ${years(s)}, against a random control, BOS and sweep at the same volatility):`
  );
  const items = LINE.map(([el, m]) => shortText(s, tf, el, m));
  return [{ text: head, color: PRO.ink3 }, ...items.map((x, i) => ({ text: `${i ? '· ' : ''}${x.text}`, color: x.quiet ? PRO.ink3 : PRO.ink2 }))];
}

/** Opis pod krzyżem nad elementem: wszystkie miary jego typu dla interwału wykresu (pusty bez pliku albo interwału). */
export function smcRatesHover(ms: number, el: SmcRateElement, s: SmcRates | null = smcRatesNow()): LegendPart[] {
  const tf = smcRateTf(ms);
  if (!tf || !s) return [];
  return SMC_RATE_MEASURES[el].map(([m]) => ({ text: `· ${smcRateText(s, tf, el, m)}`, color: PRO.ink2 }));
}

/**
 * Podsumowanie do karty, opisu i rodowodu danych (smc-hl.md §8). Liczby sprawdza test z plikiem częstości.
 */
export const SMC_RATES_SUMMARY = tr(
  'Częstości bazowe (BTCUSDT perp z Binance, świece 5m od 2020 r., kolejność w świecy z 1m; sprawdzian 2024–2026 poza próbą; wobec losowej kontroli, przy BOS i sweepie dopasowanej do zmienności i pędu): elementy prawie nie różnią się od losowych poziomów. Po BOS na skali swingowej dalszy ruch jest większy o ok. 0,3 ATR (5m i 15m; 1h w granicach szumu), a powrót za poziom bez wyraźnej różnicy. Po sweepie cena rzadziej (o ok. 2 pp) ponownie wychodzi za poziom niż po losowym knocie. Środek luki FVG (CE) dotykany tak samo często jak środek losowej luki (5m: +1,7 pp). EQH i EQL bez przewagi nad pojedynczym szczytem lub dołkiem. CHoCH i przełamania na skali wewnętrznej różnią się mało albo wcale. Na 1D za mało przypadków. To opis przeszłości, nie prognoza.',
  'Base rates (Binance BTCUSDT perp, 5m candles since 2020, order within the candle from 1m; out-of-sample check 2024–2026; against a random control, for BOS and sweeps matched for volatility and momentum): the elements barely differ from random levels. After a swing-scale BOS the further move is larger by about 0.3 ATR (5m and 15m; 1h within noise), and the return beyond the level shows no clear difference. After a sweep the price goes beyond the level again less often (by about 2 pp) than after a random wick. The FVG midpoint (CE) is touched as often as the midpoint of a random gap (5m: +1.7 pp). EQH and EQL have no edge over a single high or low. CHoCH and internal-scale breaks differ little or not at all. On 1D there are too few cases. A description of the past, not a forecast.'
);
