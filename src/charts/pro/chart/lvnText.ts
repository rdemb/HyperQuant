import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { LVA_MIN_ATR, LVA_MIN_BINS, LVN_CALIBRATION, LVN_MIN_CONFIDENCE, LVN_MIN_UNITS, LVN_REPLICAS, type LvnPrice } from '../core/lvnConfidence';

/**
 * Teksty LVN z pewnością (projekt Pioniera F-B1, runda 2), wspólne dla profilu swingu Effort, profilu tygodnia P/b
 * i profili okresów: opis metody z wynikiem kalibracji na SIM i podpisy na wykresie.
 */

const pct = (c: number) => numLang(String(Math.round(c * 100)));
const pct1 = (c: number) => numLang((c * 100).toFixed(1));

/** Próg pokazania w procentach (z kalibracji SIM). */
export const LVN_THRESHOLD_PCT = pct(LVN_MIN_CONFIDENCE);

/** Opis metody; `blocks` — zdanie o jednostkach i blokach danego profilu. */
export function lvnMethod(blocks: { pl: string; en: string }): { pl: string; en: string } {
  const c = LVN_CALIBRATION;
  const th = LVN_THRESHOLD_PCT;
  const rate = pct1(c.pass / c.lvn);
  const worst = pct1(c.worst);
  const walk = pct1(c.walkPass / c.walkLvn);
  return {
    pl: ` LVN i LVA (MODEL, eksperymentalne): lokalne minima wygładzonego profilu (okno 5 koszyków) wewnątrz obszaru wartości, poniżej 50% POC; najwyżej 3 najtrwalsze, czyli najgłębsze wobec niższego z dwóch otaczających maksimów (trwałość topologiczna), a nie po prostu najniższe. Dolina (koszyki do połowy tej głębokości) szersza niż max(${LVA_MIN_BINS} koszyków, ${numLang(String(LVA_MIN_ATR))} ATR) to LVA (obszar, pasmo), węższa to LVN (węzeł, linia). Pewność: ${LVN_REPLICAS} replik kołowego bootstrapu blokowego z blokami około ${c.blockMin} min niezależnie od interwału (1m: 15 świec, 5m: 3, od 15m: 1 świeca; koło, żeby brzegi okresu nie były rzadziej losowane), profil na tej samej siatce koszyków i LVN tą samą regułą; węzeł trafia, gdy LVN repliki leży w ±1 koszyku, a obszar, gdy leży gdziekolwiek w jego dolinie. Ziarno jest stałe, więc ten sam profil ma tę samą pewność przy każdym rysowaniu. Profil z mniej niż ${LVN_MIN_UNITS} świecami albo 4 blokami nie ma LVN („za mało świec do pewności”). Próg ${th}% ustalony na SIM, nie na rynku, po wyborze bloku: na ${numLang(String(c.profiles))} płaskich profilach z szumem (skupiska świec do około 15 min w losowych cenach, 10 klas: swingi, sesje, doby od 1m do 1h, tydzień 5m) przepuścił ${c.pass} z ${numLang(String(c.lvn))} fałszywych LVN (${rate}%, w najgorszej klasie ${worst}%); każdy niższy próg z siatki 70–99,5% przepuszczał ponad 5% w co najmniej jednej klasie. Bootstrap nie dokłada wolumenu tam, gdzie go nie było, więc pusta dolina zostaje w każdej replice; stąd tak wysoki próg. Na błądzeniu losowym (zależność ceny na godziny) próg przepuszcza ${walk}% fałszywych dolin: LVN opisuje, gdzie cena przeszła szybko, a nie twierdzi, że rynek odrzuci to miejsce. LVN poniżej progu nie rysujemy (legenda podaje ich liczbę), bo blada linia i tak zajęłaby miejsce poziomu. ${blocks.pl}`,
    en: ` LVN and LVA (MODEL, experimental): local minima of the smoothed profile (5-bin window) inside the value area, below 50% of the POC; at most the 3 most persistent ones, i.e. the deepest relative to the lower of the two surrounding maxima (topological persistence), not simply the lowest. A valley (the bins up to half that depth) wider than max(${LVA_MIN_BINS} bins, ${LVA_MIN_ATR} ATR) is an LVA (area, band), a narrower one an LVN (node, line). Confidence: ${LVN_REPLICAS} replicas of a circular moving-block bootstrap with blocks of about ${c.blockMin} min whatever the interval (1m: 15 candles, 5m: 3, 15m and up: 1 candle; circular so the period edges are not drawn less often), the profile rebuilt on the same bin grid and LVN found with the same rule; a node counts when a replica LVN lies within ±1 bin, an area when it lies anywhere in its valley. The seed is fixed, so the same profile has the same confidence on every redraw. A profile with fewer than ${LVN_MIN_UNITS} candles or 4 blocks has no LVN (“too few candles for a confidence”). The ${th}% threshold was set on SIM, not on the market, after choosing the block: on ${c.profiles} flat noisy profiles (candle clusters of up to about 15 min at random prices, 10 classes: swings, sessions, days from 1m to 1h, a 5m week) it let through ${c.pass} of ${c.lvn} false LVN (${rate}%, ${worst}% in the worst class); every lower threshold on the 70–99.5% grid let through more than 5% in at least one class. The bootstrap cannot add volume where there was none, so an empty valley stays in every replica; hence the high threshold. On a random walk (price dependence over hours) the threshold lets through ${walk}% of false valleys: an LVN describes where price passed quickly, it does not claim the market will reject the place. LVN below the threshold are not drawn (the legend gives their number), because a faint line would still take a level’s place. ${blocks.en}`,
  };
}

export const PB_LVN = lvnMethod({
  pl: 'Profil tygodnia jest ze świec 5m (wolumen świecy rozłożony na jej zakres, bez taśmy), więc blok to 3 świece 5m; ATR to średni zakres świecy 5m tygodnia.',
  en: 'The weekly profile is built from 5m candles (each candle’s volume spread over its range, without the tape), so a block is 3 5m candles; the ATR is the week’s mean 5m candle range.',
});

export const EFFORT_LVN = lvnMethod({
  pl: 'Profil swingu jest z taśmy zapisanej w świecach wykresu (wiersze cen bez czasu transakcji), więc jednostką jest świeca wykresu z jej wierszami; ATR to ATR modelu stref na krańcu swingu. Pewność liczy się dopiero pod kursorem nad pasmem D, raz na profil.',
  en: 'The swing profile comes from the tape stored in chart candles (price rows without trade times), so the unit is one chart candle with its rows; the ATR is the zone model’s ATR at the swing extreme. The confidence is computed only under the crosshair over a D band, once per profile.',
});

/** Dopisek do opisu warstwy „Profile okresów” (plakietka LIVE dla profilu, MODEL dla LVN). */
export const PERIOD_LVN = lvnMethod({
  pl: 'Profile okresów: LVN bieżącego i poprzedniego okresu (sesji albo doby UTC) na stałej siatce 5 bp, niezależnej od powiększenia, ze świec zamkniętych (świeca z pełną taśmą wnosi wiersze taśmy, inna swój wolumen na zakresie), liczone po zamknięciu świecy i pamiętane; okres w toku ma dopisek „profil w budowie”. ATR to średni zakres świecy okresu.',
  en: 'Period profiles: LVN of the current and previous period (session or UTC day) on a fixed 5 bp grid that does not depend on zoom, from closed candles (a fully recorded candle adds its tape rows, another its volume over its range), computed on candle close and cached; a period in progress is marked “profile in progress”. The ATR is the period’s mean candle range.',
});

/**
 * Podpis LVN profilu okresu na wykresie: „LVN (węzeł) 65 200 · pewność 100%”, obszar „LVA (obszar) 65 100–65 300 ·
 * pewność 100%”, okres w toku z „· profil w budowie”; na telefonie bez słów w nawiasie i bez cen.
 */
export function lvnLabel(l: LvnPrice & { confidence: number }, building: boolean, compact: boolean, fmt: (p: number) => string): string {
  const area = l.kind === 'area';
  const note = building ? tr(' · profil w budowie', ' · profile in progress') : '';
  if (compact) return `${area ? 'LVA' : 'LVN'} ${pct(l.confidence)}%${note}`;
  const name = area ? tr('LVA (obszar)', 'LVA (area)') : tr('LVN (węzeł)', 'LVN (node)');
  const px = area ? `${fmt(l.pxLo)}–${fmt(l.pxHi)}` : fmt(l.px);
  return `${name} ${px} · ${tr('pewność', 'confidence')} ${pct(l.confidence)}%${note}`;
}
