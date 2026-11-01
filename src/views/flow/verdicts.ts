import { compact } from '../../charts/pro/chart/FlowPanels';
import { fmtPx } from '../../charts/pro/chart/layout';
import type { WallFate, WallVerdict } from '../../charts/pro/core/wallFates';
import { tr } from '../../i18n';

/** Podpisy werdyktów losu ściany (drabina i lista ścian). */
export const VERDICT: Record<WallVerdict, { icon: string; cls: string; short: () => string; desc: () => string; title: (f: WallFate) => string }> = {
  eaten: {
    icon: '●',
    cls: 'text-warn',
    short: () => tr('zjedzona', 'eaten'),
    desc: () => tr('Ubytek ściany pokryły transakcje na jej cenie', 'Trades at its price covered the drop of the wall'),
    title: (f) =>
      tr(
        `Ściana ${compact(f.peakUsd)} USD na ${fmtPx(f.px)} zjedzona: ubytek pokryły transakcje na tej cenie (${compact(f.eatenUsd)} USD).`,
        `Wall of ${compact(f.peakUsd)} USD at ${fmtPx(f.px)} eaten: trades at this price covered the drop (${compact(f.eatenUsd)} USD).`
      ),
  },
  moved: {
    icon: '↕',
    cls: 'text-ink-2',
    short: () => tr('przesunięta', 'moved'),
    desc: () => tr('Tyle samo przybyło obok w tej samej migawce (zwykle przestawione kwotowanie)', 'As much appeared nearby in the same snapshot (usually a requote)'),
    title: (f) =>
      tr(
        `Ściana ${compact(f.peakUsd)} USD na ${fmtPx(f.px)} przesunięta: w tej samej migawce tyle samo przybyło na sąsiednich poziomach (zwykle animator rynku przestawia kwotowanie; bywa też przypadkiem).`,
        `Wall of ${compact(f.peakUsd)} USD at ${fmtPx(f.px)} moved: in the same snapshot as much appeared on nearby levels (usually a market maker requoting; can also be chance).`
      ),
  },
  pulled: {
    icon: '✕',
    cls: 'text-ink-1',
    short: () => tr('zdjęta', 'pulled'),
    desc: () => tr('Zniknęła bez transakcji i bez przeniesienia obok', 'Vanished without trades and without moving nearby'),
    title: (f) =>
      tr(
        `Ściana ${compact(f.peakUsd)} USD na ${fmtPx(f.px)} zdjęta: zniknęła bez transakcji na tej cenie${f.touched ? ' (poza drobnymi)' : ''} i bez przeniesienia obok.`,
        `Wall of ${compact(f.peakUsd)} USD at ${fmtPx(f.px)} pulled: it vanished without trades at this price${f.touched ? ' (apart from small ones)' : ''} and without moving nearby.`
      ),
  },
};
