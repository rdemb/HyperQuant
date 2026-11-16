import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { LVA_MIN_ATR, LVA_MIN_BINS, LVN_CALIBRATION, LVN_LOCATION_MIN, LVN_MIN_UNITS, LVN_NULL_PROFILES, LVN_P_MAX, LVN_REPLICAS, type LvnLevel } from '../core/lvn';

/**
 * Teksty LVN po testach (projekt Pioniera F-B1, runda 2 po przeglądzie #295), wspólne dla profilu swingu Effort,
 * profilu tygodnia P/b i profili okresów: opis metody z wynikiem kalibracji na SIM i podpisy na wykresie. Udziału
 * replik bootstrapu nie pokazujemy (to filtr położenia, nie miara istotności).
 */

const pct = (c: number) => numLang(String(Math.round(c * 100)));
const pct1 = (c: number) => numLang((c * 100).toFixed(1));

/** Wartość p do podpisu: „0,03”, poniżej 0,01 z trzema miejscami, poniżej 0,001 „< 0,001”. */
export function fmtP(p: number): string {
  if (p < 0.001) return `< ${numLang('0.001')}`;
  return `= ${numLang(p.toFixed(p < 0.01 ? 3 : 2))}`;
}

/** Próg testu (a) do tekstów: „0,05”. */
export const LVN_P_TEXT = numLang(String(LVN_P_MAX));

/** Dopisek przy LVN: drugi test (losowe ścieżki) jeszcze nie działa. */
export const PATHS_PENDING = tr('test wobec losowych ścieżek: w przygotowaniu', 'test against random paths: in preparation');

/** Kalibracja testu (a) do opisu: najmniejszy i największy udział fałszywych pokazanych LVN w klasie oraz suma. */
function calibrationText(): { min: string; max: string; shown: number; lvn: number } {
  const rates = LVN_CALIBRATION.classes.map((c) => (c.lvn > 0 ? c.shown / c.lvn : 0));
  return {
    min: pct1(Math.min(...rates)),
    max: pct1(Math.max(...rates)),
    shown: LVN_CALIBRATION.classes.reduce((t, c) => t + c.shown, 0),
    lvn: LVN_CALIBRATION.classes.reduce((t, c) => t + c.lvn, 0),
  };
}

/** Opis metody; `blocks` — zdanie o jednostkach i blokach danego profilu. */
export function lvnMethod(blocks: { pl: string; en: string }): { pl: string; en: string } {
  const c = LVN_CALIBRATION;
  const k = calibrationText();
  const n = c.classes.length;
  const loc = pct(LVN_LOCATION_MIN);
  return {
    pl: ` LVN i LVA (MODEL, eksperymentalne): lokalne minima wygładzonego profilu (okno 5 koszyków) wewnątrz obszaru wartości, poniżej 50% POC; najwyżej 3 najtrwalsze (trwałość topologiczna: głębokość wobec niższego z dwóch otaczających maksimów). Dolina (koszyki do połowy tej głębokości) szersza niż max(${LVA_MIN_BINS} koszyków, ${numLang(String(LVA_MIN_ATR))} ATR) to LVA (obszar, pasmo), węższa to LVN (węzeł, linia). Liczba przy LVN to głębokość względna: 1 − minimum / niższe z dwóch otaczających maksimów (bez jednostek, więc porównywalna między profilami). Dwa kroki. Filtr położenia: ${LVN_REPLICAS} replik kołowego bootstrapu blokowego z blokami około ${c.blockMin} min niezależnie od interwału (1m: 15 świec, 5m: 3, od 15m: 1 świeca); LVN przechodzi, gdy w co najmniej ${loc}% replik LVN leży w ±1 koszyku (obszar: w jego dolinie). Liczby bootstrapu nie pokazujemy: mierzy stałość miejsca, a nie istotność, bo pusta dolina zostaje w każdej replice. Test szumu pomiaru: p to udział dolin z ${LVN_NULL_PROFILES} profili SIM dopasowanych do tego profilu (ta sama liczba świec i koszyków, rozpiętość świecy i rozrzut wolumenu z danych, skupiska świec ok. 15 min w losowych cenach na płaskim profilu) o głębokości co najmniej takiej jak obserwowana; rysujemy tylko LVN z p ≤ ${LVN_P_TEXT}. Kalibracja na SIM, nie na rynku: w każdej z ${n} klas profili (swingi, sesje, doby od 1m do 1h, tydzień 5m; po ${c.profiles} płaskich profili z szumem) pokazanych fałszywych LVN było od ${k.min}% do ${k.max}% (razem ${k.shown} z ${numLang(String(k.lvn))}). Test wobec losowych ścieżek ceny o tej samej zmienności i rytmie wolumenu (czy dolina jest głębsza niż na przypadkowej ścieżce) jest w przygotowaniu; do tego czasu LVN mówi, gdzie cena przeszła szybko, i że to nie szum pomiaru, ale nie, że to struktura rynku. Profil z mniej niż ${LVN_MIN_UNITS} świecami albo 4 blokami nie ma LVN („za mało świec do testu”). ${blocks.pl}`,
    en: ` LVN and LVA (MODEL, experimental): local minima of the smoothed profile (5-bin window) inside the value area, below 50% of the POC; at most the 3 most persistent ones (topological persistence: depth relative to the lower of the two surrounding maxima). A valley (the bins up to half that depth) wider than max(${LVA_MIN_BINS} bins, ${LVA_MIN_ATR} ATR) is an LVA (area, band), a narrower one an LVN (node, line). The number at an LVN is its relative depth: 1 − minimum / the lower of the two surrounding maxima (unitless, so comparable across profiles). Two steps. Location filter: ${LVN_REPLICAS} replicas of a circular moving-block bootstrap with blocks of about ${c.blockMin} min whatever the interval (1m: 15 candles, 5m: 3, 15m and up: 1 candle); an LVN passes when in at least ${loc}% of the replicas an LVN lies within ±1 bin (an area: inside its valley). The bootstrap number is not shown: it measures how stable the place is, not significance, because an empty valley stays in every replica. Measurement noise test: p is the share of valleys from ${LVN_NULL_PROFILES} SIM profiles matched to this profile (the same number of candles and bins, the candle span and volume spread from the data, candle clusters of about 15 min at random prices on a flat profile) that are at least as deep as the observed one; only LVN with p ≤ ${LVN_P_MAX} are drawn. Calibrated on SIM, not on the market: in each of ${n} profile classes (swings, sessions, days from 1m to 1h, a 5m week; ${c.profiles} flat noisy profiles each) the share of false LVN shown was ${k.min}% to ${k.max}% (${k.shown} of ${k.lvn} in total). A test against random price paths with the same volatility and volume rhythm (whether the valley is deeper than on a chance path) is in preparation; until then an LVN says where price passed quickly and that it is not measurement noise, not that it is market structure. A profile with fewer than ${LVN_MIN_UNITS} candles or 4 blocks has no LVN (“too few candles for a test”). ${blocks.en}`,
  };
}

export const PB_LVN = lvnMethod({
  pl: 'Profil tygodnia jest ze świec 5m (wolumen świecy rozłożony na jej zakres, bez taśmy), więc blok to 3 świece 5m; ATR to średni zakres świecy 5m tygodnia.',
  en: 'The weekly profile is built from 5m candles (each candle’s volume spread over its range, without the tape), so a block is 3 5m candles; the ATR is the week’s mean 5m candle range.',
});

export const EFFORT_LVN = lvnMethod({
  pl: 'Profil swingu jest z taśmy zapisanej w świecach wykresu (wiersze cen bez czasu transakcji), więc jednostką jest świeca wykresu z jej wierszami; ATR to ATR modelu stref na krańcu swingu. Testy liczą się dopiero pod kursorem nad pasmem D, raz na profil.',
  en: 'The swing profile comes from the tape stored in chart candles (price rows without trade times), so the unit is one chart candle with its rows; the ATR is the zone model’s ATR at the swing extreme. The tests run only under the crosshair over a D band, once per profile.',
});

/** Dopisek do opisu warstwy „Profile okresów” (plakietka LIVE dla profilu, MODEL dla LVN). */
export const PERIOD_LVN = lvnMethod({
  pl: 'Profile okresów: LVN bieżącego i poprzedniego okresu (sesji albo doby UTC) na stałej siatce 5 bp, niezależnej od powiększenia, ze świec zamkniętych (świeca z pełną taśmą wnosi wiersze taśmy, inna swój wolumen na zakresie), liczone po zamknięciu świecy i pamiętane; okres w toku ma dopisek „profil w budowie”. ATR to średni zakres świecy okresu.',
  en: 'Period profiles: LVN of the current and previous period (session or UTC day) on a fixed 5 bp grid that does not depend on zoom, from closed candles (a fully recorded candle adds its tape rows, another its volume over its range), computed on candle close and cached; a period in progress is marked “profile in progress”. The ATR is the period’s mean candle range.',
});

/**
 * Podpis LVN po testach: „LVN (węzeł) 65 200 · głębokość 62% · p = 0,03”, obszar „LVA (obszar) 65 100–65 300 · …”,
 * okres w toku z „· profil w budowie”; na telefonie „LVN p = 0,03”.
 */
export function lvnLabel(l: Pick<LvnLevel, 'kind' | 'px' | 'pxLo' | 'pxHi' | 'depth' | 'p'>, building: boolean, compact: boolean, fmt: (p: number) => string): string {
  const area = l.kind === 'area';
  const note = building ? tr(' · profil w budowie', ' · profile in progress') : '';
  if (compact) return `${area ? 'LVA' : 'LVN'} p ${fmtP(l.p)}${note}`;
  const name = area ? tr('LVA (obszar)', 'LVA (area)') : tr('LVN (węzeł)', 'LVN (node)');
  const px = area ? `${fmt(l.pxLo)}–${fmt(l.pxHi)}` : fmt(l.px);
  return `${name} ${px} · ${tr('głębokość', 'depth')} ${pct(l.depth)}% · p ${fmtP(l.p)}${note}`;
}
