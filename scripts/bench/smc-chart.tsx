import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CandlestickSeries, createChart, type UTCTimestamp } from 'lightweight-charts';
import '../../src/index.css';
import { lang, tr } from '../../src/i18n';
import { SmcLayer } from '../../src/charts/pro/chart/smcLayer';
import { SmcOrderflowPanel } from '../../src/charts/pro/chart/SmcOrderflowPanel';
import { flowId } from '../../src/charts/pro/chart/smcOrderflowAdapter';
import { ObservationJournal } from '../../src/charts/pro/core/smcObservation';
import { PRO } from '../../src/charts/pro/chart/theme';

const ms = 300000, end = 25 * ms, now = 35 * ms + 170000;
const bars = Array.from({ length: 36 }, (_, i) => {
  const c = i < 22 ? 100 : i === 22 ? 98 : i === 23 ? 100 : i === 24 ? 102 : 101.6;
  const t = i * ms;
  const active = i >= 25;
  return { t, candle: { t, o: c, c, h: active ? 103 : c + .5, l: active ? 99 : c - .5, v: 60, n: 60 } };
});
const full = { alpha: 1, width: 1, internalLen: 3, swingLen: 10, higher: -1, defense: true, anchored: true, memory: true, initiative: true, formation: true };
const journal = new ObservationJournal('BTC');
journal.open(0, 0);
for (let t = 0; t < end; t += 5000) {
  const base = bars[Math.floor(t / ms)].candle.c, origin = t >= 22 * ms, sz = origin ? 1 : 10;
  journal.trades([{ time: t, tid: t, px: base, sz: origin ? 100 : 1, side: 1 }], t);
  journal.book({ time: t, bids: [1, 2, 3, 4].map(d => ({ px: base - d, sz })), asks: [1, 2, 3, 4].map(d => ({ px: base + d, sz })) }, t, 1);
}
document.documentElement.lang = lang;

function Preview() {
  const host = useRef<HTMLDivElement>(null);
  const layerRef = useRef<SmcLayer | null>(null);
  const [opts, setOpts] = useState(full);
  const config = useRef({ opts, measure: true });
  config.current.opts = opts;
  const [id, select] = useState<string | null>(null);
  const [defaultId, setDefaultId] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [bench, setBench] = useState<object | null>(null);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const chart = createChart(root, { autoSize: true, layout: { background: { color: PRO.bg }, textColor: PRO.ink2 }, timeScale: { timeVisible: true } });
    const series = chart.addSeries(CandlestickSeries);
    series.setData(bars.map(({ t, candle: c }) => ({ time: t / 1000 as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    const layer = new SmcLayer(() => config.current.measure ? config.current.opts : {
      ...config.current.opts, defense: false, formation: false, initiative: false, anchored: false,
    });
    layerRef.current = layer;
    layer.setObservations(journal);
    layer.setPhone(innerWidth < 600);
    series.attachPrimitive(layer);
    layer.setData(bars.slice(0, 26), ms, end);
    const f = layer.selection()?.fvgs.find(v => v.f.known === end)?.f;
    if (f) setDefaultId(flowId('fvg', f.t, f.known, f.dir));
    for (let t = end + 10000; t <= now; t += 10000) {
      const offset = t - end;
      const px = offset < 510000 ? 100.9 : offset < 1200000 ? 102.4 : offset < 1750000 ? 100.4 : offset < 2900000 ? 102.8 : 100.6;
      journal.trades([{ time: t, tid: t, px, sz: 1 + offset % 3, side: px > 102 ? 1 : -1 }], t);
      layer.setData(bars.slice(0, Math.min(bars.length, Math.floor(t / ms) + 1)), ms, t);
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => { root.dataset.range = JSON.stringify(range); });
    chart.timeScale().setVisibleLogicalRange({ from: 19, to: 39 });
    const click: Parameters<typeof chart.subscribeClick>[0] = p => {
      if (!p.point) return;
      const picked = layer.pickObservationLabel(p.point.x, p.point.y) ?? layer.pickObservationAtPoint(p.point.x, p.point.y);
      if (picked) { select(picked); setAt(null); }
    };
    chart.subscribeClick(click);
    const resize = new ResizeObserver(() => layer.setPhone(root.clientWidth < 600));
    resize.observe(root);
    const bench = () => {
      const width = chart.paneSize(0).width, height = chart.paneSize(0).height;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      const target = { useMediaCoordinateSpace: (draw: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void) =>
        draw({ context, mediaSize: { width, height } }) };
      const render = (measure: boolean) => {
        config.current.measure = measure;
        const start = performance.now();
        layer.updateAllViews();
        for (const view of layer.paneViews()) {
          const renderer = view.renderer();
          renderer?.draw(target as unknown as Parameters<NonNullable<typeof renderer>['draw']>[0]);
        }
        return performance.now() - start;
      };
      const pairs = Array.from({ length: 240 }, (_, i) => {
        if (i % 2) { const base = render(false); return { base, full: render(true) }; }
        const full = render(true); return { base: render(false), full };
      }).slice(40);
      config.current.measure = true;
      layer.updateAllViews();
      const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
      const points = f ? layer.observationModel()?.trajectory(flowId('fvg', f.t, f.known, f.dir)).length : 0;
      setBench({ width, height, pairs: pairs.length, points, baseP95: p95(pairs.map(p => p.base)), fullP95: p95(pairs.map(p => p.full)), extraP95: p95(pairs.map(p => p.full - p.base)) });
    };
    root.addEventListener('measure-smc', bench);
    return () => { root.removeEventListener('measure-smc', bench); resize.disconnect(); chart.unsubscribeClick(click); chart.remove(); layerRef.current = null; };
  }, []);
  useEffect(() => { layerRef.current?.setObservationView(id, opts.memory ? at : null); }, [opts, id, at]);
  const model = layerRef.current?.observationModel();
  return <main data-theme="dark" className="min-h-dvh bg-page p-2 text-ink-1">
    <header className="mx-auto pb-2 text-sm font-semibold" style={{ maxWidth: 1152 }}>SIM · {tr('Obserwacje SMC na wykresie', 'SMC observations on the chart')}</header>
    <div className="relative mx-auto" style={{ maxWidth: 1152 }}>
      <div ref={host} data-fixture-chart className="w-full" style={{ height: '66dvh' }} />
      {open && model && id && <SmcOrderflowPanel model={model} selected={id} replay={at} onReplay={setAt} opts={opts} unit="BTC"
        onSelect={x => { select(x); setAt(null); }} onOption={(key, on) => { setOpts(o => ({ ...o, [key]: on })); if (key === 'memory' && !on) setAt(null); }}
        onClose={() => setOpen(false)} />}
    </div>
    <div className="mx-auto flex flex-wrap gap-2 py-2 text-xs" style={{ maxWidth: 1152 }}>
      <button className="min-h-11 rounded border border-line px-3" onClick={() => { select(id ?? defaultId); setOpen(true); }}>SMC · {tr('obserwacje', 'observations')}</button>
      {id && <button className="min-h-11 rounded border border-line px-3" onClick={() => { select(null); setAt(null); setOpen(false); }}>{tr('Odznacz', 'Clear selection')}</button>}
      {at !== null && <button className="min-h-11 rounded border border-line px-3" onClick={() => setAt(null)}>{tr('Teraz', 'Now')}</button>}
      <button className="min-h-11 rounded border border-line px-3" onClick={() => {
        select(defaultId); setAt(null);
        requestAnimationFrame(() => requestAnimationFrame(() => host.current?.dispatchEvent(new Event('measure-smc'))));
      }}>{tr('Zmierz nakładkę', 'Measure overlay')}</button>
    </div>
    <output className="ml-2 font-mono text-xs" data-fixture-info>{id ?? ''} {at ?? ''}</output>
    {bench && <pre className="mx-auto max-w-6xl overflow-auto text-xs" data-fixture-benchmark>{JSON.stringify(bench)}</pre>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
