import { ColorType, CrosshairMode, LineStyle, TickMarkType } from 'lightweight-charts';
import type { ChartOptions, DeepPartial, Time } from 'lightweight-charts';
import { C, MONO, rgba } from '../../orderflow/renderer';
import { fmtHm, fmtHms } from '../core/time';

/** Wygląd wykresu Pro: tokeny projektu (src/index.css), oś czasu w czasie lokalnym, polskie skróty miesięcy. */

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** Kolory płótna wykresu Pro (gotowe napisy z kryciem — bez budowania w pętli rysowania). */
export const PRO = {
  ...C,
  grid: rgba(C.grid, 0.7),
  cross: rgba(C.ink2, 0.5),
  buyWick: rgba(C.buy, 0.9),
  sellWick: rgba(C.sell, 0.9),
  volBuy: rgba(C.buy, 0.55),
  volSell: rgba(C.sell, 0.55),
  poc: rgba(C.ink1, 0.9),
  va: rgba(C.ink2, 0.55),
  warn: '#fab219',
  partial: rgba('#fab219', 0.85),
  cellLine: rgba(C.grid, 0.9),
  profile: rgba(C.ink3, 0.55),
  profilePoc: rgba(C.ink1, 0.75),
} as const;

export { MONO, rgba };

/** Odstęp najnowszej świecy od osi ceny (px), ten sam przy każdym zbliżeniu. */
export const RIGHT_GAP_PX = 48;

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
  const wd = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][d.getDay()];
  return `${wd} ${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}  ${fmtHm(t)}`;
}

export function chartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: C.bg },
      textColor: C.ink3,
      fontSize: 11,
      fontFamily: MONO,
      // Logo TradingView zostaje — wymaga go licencja biblioteki (link do tradingview.com)
      attributionLogo: true,
      panes: { separatorColor: C.divider, separatorHoverColor: rgba(C.ink3, 0.18), enableResize: true },
    },
    grid: {
      vertLines: { color: PRO.grid, style: LineStyle.Solid },
      horzLines: { color: PRO.grid, style: LineStyle.Solid },
    },
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
      barSpacing: 9,
      minBarSpacing: 0.6,
      // Przy największym zbliżeniu komórki footprintu z kolumnami delty i wolumenu wciąż mieszczą kilka świec
      maxBarSpacing: 240,
      tickMarkFormatter,
    },
    localization: { locale: 'pl-PL', timeFormatter: crosshairTimeFormatter },
  };
}
