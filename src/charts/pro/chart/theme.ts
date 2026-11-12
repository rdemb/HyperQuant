import { ColorType, CrosshairMode, LineStyle, TickMarkType } from 'lightweight-charts';
import type { ChartOptions, DeepPartial, Time } from 'lightweight-charts';
import type { HeatRamp } from '../../orderflow/heatColor';
import { C, MONO, rgba } from '../../orderflow/renderer';
import { fmtHm, fmtHms } from '../core/time';
import { locale, tr } from '../../../i18n';

/** Wygląd wykresu Pro: tokeny projektu (src/index.css), oś czasu w czasie lokalnym, polskie skróty miesięcy. */

const MONTHS = tr(
  ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
);

/**
 * Kolory kategorii (kohorty, giełdy, źródła danych, stałe linie wskaźników) — zdefiniowane raz, w stałej kolejności:
 * turkus, złoto, fiolet, szary (docs/STYLEGUIDE.md §2), i zieleń series-3 z kategorycznej palety strony.
 */
const CAT = { teal: '#059583', gold: '#B18E15', violet: '#A878DB', grey: '#7A889C', green: '#199E70' } as const;
/** POC: ramka w świecy, linia profilu i źródło „arkusz dokładny” na pasku pokrycia. */
const POC = '#F1C45E';

/**
 * Kolory płótna wykresu Pro: paleta „Głębia” (kupujący to lazur, sprzedający to żar, na tle „otchłani”). Te same wartości
 * są tokenami `of-*` w src/index.css (legenda i menu). Gotowe napisy z kryciem — bez budowania w pętli rysowania.
 */
const GLEBIA = {
  bg: '#05101E',
  axisText: '#c3ccd8',
  // Świece: korpusy i knoty
  buy: '#3280DD',
  sell: '#CA3829',
  buyWick: '#3280DD',
  sellWick: '#CA3829',
  // Kierunek przepływu w liczbach, opisach, likwidacjach i wielorybach
  buyInk: '#82BCFC',
  sellInk: '#F68771',
  volBuy: rgba('#3280DD', 0.5),
  volSell: rgba('#CA3829', 0.6),
  priceLine: '#3fc6dd',
  vwap: '#E2E9F0',
  svwap: '#C1B3F2',
  /** Strefa ceny z linku powtórki (token zone, fiolet kategorii). */
  zone: CAT.violet,
  // Footprint: kafle komórek od grafitu (mały wolumen) do nasyconego koloru strony; delta wiersza w tych samych kolorach.
  // Strona bidu to sprzedaż agresorów (żar), strona asku to kupno agresorów (lazur).
  fpNeutral: '#2a3446',
  fpBidRamp: ['#1E2A3A', '#4A333B', '#733939', '#9E3B34', '#CA3829'],
  fpAskRamp: ['#1E2A3A', '#253E5F', '#2A5387', '#2F69B1', '#3280DD'],
  fpDeltaPosRamp: ['#1E2A3A', '#253E5F', '#2A5387', '#2F69B1', '#3280DD'],
  fpDeltaNegRamp: ['#1E2A3A', '#4A333B', '#733939', '#9E3B34', '#CA3829'],
  fpText: '#0b1019',
  fpTextLight: '#eef2f7',
  fpTextProfile: '#c9d4df',
  fpRowLine: '#1b2533',
  // Nierównowagi: rozjaśnione kolory stron
  imbBuy: '#A2CFFF',
  imbSell: '#FFA28A',
  pocFrame: POC,
  volBar: '#46576C',
  deltaPosBar: '#3280DD',
  deltaNegBar: '#CA3829',
  // Profile wolumenu: obszar wartości grafitowy, reszta przygaszona, POC złoty, nagi POC szary
  profileVa: '#34425a',
  profileOut: '#1f2b3d',
  profilePoc: POC,
  nakedPoc: CAT.grey,
  domBid: '#3280DD',
  domAsk: '#CA3829',
  domText: '#e4e8ee',
  // Góra lodowa przy ścianie arkusza (romb i podpis „ICE”): lodowy błękit jaśniejszy niż kolory stron i linia ceny
  ice: '#7FE7FF',
  // Biel podpisów na bąblach i zaznaczenia, ciemny tusz na jasnym tle rysunku
  white: '#FFFFFF',
  inkOnLight: '#0B0B12',
  // Panel podniesiony (token surface-2 strony): tło etykiet ramki zrzutu
  surface2: '#101826',
  // Pasek pokrycia danych pod osią czasu: źródło w kolorze kategorii (taśma w turkusie Hyperliquid, znaczniki TWAP w akcencie
  // jak w taśmie, arkusz i arkusz dokładny w złocie, OI w szarości), wiersz „wszystkie” w tuszu
  coverTape: CAT.teal,
  coverAccounts: CAT.violet,
  coverTwap: C.accent,
  coverBook: CAT.gold,
  coverExact: POC,
  coverOi: CAT.grey,
  // Bąble agresji: środek, brzeg i obrys kuli
  bubbleBuy: ['#3280DD', '#82BCFC', '#A2CFFF'],
  bubbleSell: ['#CA3829', '#F68771', '#FFA28A'],
  // Kategorie (giełdy w panelach „CVD giełd” i „ΔOI giełd”, kohorty): turkus, złoto, fiolet
  venueHl: CAT.teal,
  venueBinance: CAT.gold,
  venueBybit: CAT.violet,
  // Poziomy mapy z bloga (tekst autora): turkus z palety kategorii — na wykresie ceny nic innego go nie używa, nie jest
  // kolorem strony (kupno/sprzedaż), POC, VWAP ani IB
  blogMap: CAT.teal,
  // Initial balance sesji (linie, rozszerzenia i podpisy): zieleń spoza kolorów stron, VWAP, POC, poziomów i mapy z bloga
  ib: '#56DB8F',
  // Stałe linie wskaźników, które nie są stroną: druga linia złota (sygnał MACD, %D, p90, Kijun), trzecia zielona series-3
  // (p99; fiolet kategorii leżał przy dawnym kolorze instancji #b388ff, ΔE 6), baza i Chikou szare; animatorzy rynku
  // w turkusie kohorty. Linie strony to buyInk i sellInk, słupki strony buy i sell.
  indSecond: CAT.gold,
  indThird: CAT.green,
  cohortMm: CAT.teal,
  cohortRest: CAT.grey,
};

export const PRO = {
  ...C,
  cross: rgba(C.ink2, 0.5),
  va: rgba(C.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  /** Świeca niepełna (luka w taśmie) w panelach delty i CVD: wyszarzona jak niepełny footprint */
  incomplete: rgba(C.ink2, 0.45),
  // Grupa „Kto handluje” w Tablicy liczb: neutralna jasna (to nie giełda, nie bierze koloru z palety giełd)
  players: '#e4e8ee',
  ...GLEBIA,
} as const;

/** Konwersja sRGB ↔ OKLab (Ottosson) do mieszania stopni rampy bez brudnych środków. */
const toLin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)));

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const ch = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + ch.map((x) => fromLin(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Kolor w punkcie t ∈ [0, 1] rampy `stops` równo rozłożonych, mieszany w OKLab. */
function oklabAt(stops: readonly string[], t: number): string {
  const u = t * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(u));
  const f = u - k;
  const a = toOklab(stops[k]);
  const b = toOklab(stops[k + 1]);
  return fromOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** „Światło księżyca”: pięć stopni od grafitu do bieli (kolejność: jasność rośnie). */
const MOON = ['#424E5E', '#647386', '#879AB1', '#B4C6DB', '#EFF6FD'];

/**
 * Rampa mapy ciepła arkusza „Głębia”: przezroczysty → grafit (półprzezroczysty, świece widać przez niego) → błękitna
 * szarość → biel (ściany). Kolory z rampy `MOON` w OKLab, pozycje i krycie stopni stałe.
 */
export const LIQ_RAMP: HeatRamp = [
  [0, 0],
  [0.12, 0.45],
  [0.28, 0.65],
  [0.42, 0.8],
  [0.55, 0.9],
  [0.68, 1],
  [0.8, 1],
  [0.9, 1],
  [1, 1],
].map(([t, alpha]) => ({ t, color: t === 0 ? MOON[0] : t === 1 ? MOON[4] : oklabAt(MOON, t), alpha }));

/** Odległość dwóch kolorów #rrggbb w OKLab (×100, jak ΔE walidatora palet): poniżej ok. 10 trudno je odróżnić na wykresie. */
export function colorDistance(a: string, b: string): number {
  const x = toOklab(a);
  const y = toOklab(b);
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rampa n + 1 nieprzezroczystych kolorów przez równo rozłożone punkty `stops` (bez budowania napisów w pętli rysowania). */
export function mixRamp(stops: readonly string[], n: number): string[] {
  const rgb = stops.map(hexRgb);
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = (i / n) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(u));
    const f = u - k;
    const m = (c: number) => Math.round(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f);
    return `rgb(${m(0)},${m(1)},${m(2)})`;
  });
}

/** Jasność względna koloru `rgb(r,g,b)` albo `#rrggbb` (WCAG) — wybór ciemnych albo jasnych liczb na kaflu. */
export function luminance(color: string): number {
  const v = color.startsWith('#') ? hexRgb(color) : (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
}

export { MONO, rgba };

/** Odstęp najnowszej świecy od osi ceny (px), ten sam przy każdym zbliżeniu. */
export const RIGHT_GAP_PX = 48;
/** Szerokość drabiny DOM (arkusz na żywo) przy prawej krawędzi panelu ceny, gdy mapa ciepła jest włączona. */
export const DOM_W_PX = 64;

const unix = (time: Time) => (time as number) * 1000;

/** Etykiety osi czasu (czas lokalny przeglądarki). */
export function tickMarkFormatter(time: Time, type: TickMarkType): string {
  const t = unix(time);
  const d = new Date(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    case TickMarkType.TimeWithSeconds:
      return fmtHms(t);
    default:
      return fmtHm(t);
  }
}

/** Etykieta czasu na krzyżu (czas lokalny). */
export function crosshairTimeFormatter(time: Time): string {
  const t = unix(time);
  const d = new Date(t);
  const wd = tr(['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[d.getDay()];
  return `${wd} ${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}  ${fmtHm(t)}`;
}

export function chartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: PRO.bg },
      textColor: PRO.axisText,
      fontSize: 11,
      fontFamily: MONO,
      // Bez logo na wykresie (zasłaniało panel CVD): licencja wymaga noty z pliku NOTICE i linku do tradingview.com na
      // stronie — są w „Źródłach” (Attributions) i w stopce strony
      attributionLogo: false,
      panes: { separatorColor: C.divider, separatorHoverColor: rgba(C.ink3, 0.18), enableResize: true },
    },
    // Bez siatki: poziomy wyznaczają komórki footprintu i wskaźniki
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: C.tip },
      horzLine: { color: PRO.cross, style: LineStyle.Solid, width: 1, labelBackgroundColor: C.tip },
    },
    rightPriceScale: { borderColor: C.grid, scaleMargins: { top: 0.06, bottom: 0.06 } },
    timeScale: {
      borderColor: C.grid,
      timeVisible: true,
      secondsVisible: false,
      rightOffsetPixels: RIGHT_GAP_PX,
      // Zbliżenie kółkiem zachowuje odstęp najnowszej świecy od osi (inaczej rośnie razem z odstępem świec)
      rightBarStaysOnScroll: true,
      barSpacing: 9,
      minBarSpacing: 0.6,
      // Przy największym zbliżeniu komórki footprintu z kolumnami delty i wolumenu wciąż mieszczą kilka świec
      maxBarSpacing: 240,
      tickMarkFormatter,
    },
    localization: { locale, timeFormatter: crosshairTimeFormatter },
  };
}
