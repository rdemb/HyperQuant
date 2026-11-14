import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { tr } from '../../i18n';

/**
 * Animacja poglądowa przepływu (SIM): komórki footprintu wypełniane świeca po świecy, bąble dużych zleceń agresorów,
 * jasna ściana w księdze częściowo zjedzona przez transakcje. Bez liczb i bez kierunku. Pętla 9 s w CSS (kompozytor GPU),
 * przy prefers-reduced-motion stan końcowy bez ruchu.
 */
const ROWS = 30;
const RH = 20;
const CYCLE = 9;
const MIDS = [15, 13, 14, 12, 11, 8, 10];
const SPANS = [6, 7, 6, 8, 7, 6, 7];
const EMBER = ['#3A1F1E', '#6A2A24', '#9C3127', '#CA3829'];
const AZURE = ['#1A2D45', '#20477A', '#2964B0', '#3280DD'];
const HEAT = ['#2A3442', '#424E5E', '#647386', '#879AB1', '#B4C6DB'];
const BUBBLES: [number, number, number, boolean][] = [[4, 9, 30, false], [4, 13, 18, true], [5, 6, 44, false], [5, 10, 22, true], [6, 8, 16, false], [6, 12, 34, true], [3, 11, 14, true], [6, 9, 24, false]];

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

export const FlowReel: React.FC = () => {
  const t = tr;
  const reduce = useReducedMotion();
  const anim = (name: string, delay: number, ease = 'var(--ease-out)') => (reduce ? undefined : `${name} ${CYCLE}s ${ease} ${delay.toFixed(2)}s infinite both`);

  // Scena 800 × 600 skalowana do szerokości karty (telefon: cała scena widoczna, bez przewijania w bok)
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const fit = () => setScale(Math.min(1, box.clientWidth / 800));
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    return () => ro.disconnect();
  }, []);
  const { heat, cells } = useMemo(() => {
    const r = rng(20261114);
    const heat = Array.from({ length: ROWS }, (_, row) => {
      const lvl = Math.min(HEAT.length - 1, Math.floor(r() ** 2.4 * HEAT.length));
      return { row, x0: Math.floor(r() * 240), color: HEAT[lvl], op: 0.16 + lvl * 0.09 };
    }).filter((h) => h.row !== 7);
    const cells: { x: number; row: number; bid: string; ask: string; poc: boolean; delay: number }[] = [];
    MIDS.forEach((mid, c) => {
      const top = mid - Math.floor(SPANS[c] / 2);
      for (let k = 0; k < SPANS[c]; k++) {
        const row = top + k;
        const near = 1 - Math.abs(row - mid) / SPANS[c];
        const lv = () => Math.max(0, Math.min(3, Math.round(near * 3.4 - r() * 1.3)));
        cells.push({ x: 96 + c * 96, row, bid: EMBER[lv()], ask: AZURE[lv()], poc: row === mid, delay: c + k * 0.06 });
      }
    });
    return { heat, cells };
  }, []);

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div data-theme="dark" className="overflow-hidden rounded-xl border border-line-strong bg-of-bg text-[#edeef0]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#13233a] px-4 py-3">
          <span className="text-[13px] font-semibold text-[#a9aeb6]">
            <span className="display mr-2 text-[15px] font-bold text-[#edeef0]">{t('Kokpit', 'Cockpit')}</span>footprint · {t('heatmapa', 'heatmap')} · {t('bąble', 'bubbles')}
          </span>
          <span className="rounded-sm border border-dashed border-[#e9b04f] px-2 py-1 text-[11px] font-bold text-[#e9b04f]">
            {t('SIM · animacja poglądowa, bez danych rynkowych', 'SIM · illustrative animation, no market data')}
          </span>
        </div>
        <div ref={boxRef} className="overflow-hidden" style={{ height: 600 * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }} role="img" aria-label={t('Animacja poglądowa: komórki footprintu wypełniają się świeca po świecy, pojawiają się bąble dużych zleceń agresorów, jasna ściana w księdze zostaje częściowo zjedzona.', 'Illustrative animation: footprint cells fill candle by candle, large aggressor orders appear as bubbles, a bright book wall is partly eaten.')} className="relative h-[600px] w-[800px]">
            {heat.map((h) => (
              <span key={h.row} className="absolute right-0 rounded-[2px]" style={{ left: h.x0, top: h.row * RH + 4, height: RH - 8, background: h.color, opacity: h.op }} />
            ))}
            <span className="absolute right-0 left-0 h-3.5 origin-left rounded-[2px] bg-of-heat-3" style={{ top: 7 * RH + 3, animation: anim('hq-eat', 0) }} />
            {cells.map((c, i) => (
              <span key={i} className="absolute" style={{ left: c.x - 2, top: c.row * RH - 1, width: 76, height: RH + 2, animation: anim('hq-cell', c.delay) }}>
                <span className="absolute top-0.5 left-0.5 rounded-l-[3px]" style={{ width: 35, height: RH - 2, background: c.bid }} />
                <span className="absolute top-0.5 left-[39px] rounded-r-[3px]" style={{ width: 35, height: RH - 2, background: c.ask }} />
                {c.poc && <span className="absolute inset-0 rounded-[4px] border-[1.5px] border-of-poc" />}
              </span>
            ))}
            {BUBBLES.map(([c, row, d, sell], i) => (
              <span
                key={i}
                className="absolute rounded-full border-[1.5px]"
                style={{ left: 96 + c * 96 + 36 - d / 2, top: row * RH + RH / 2 - d / 2, width: d, height: d, borderColor: sell ? '#F68771' : '#82BCFC', background: sell ? '#F6877138' : '#82BCFC38', animation: anim('hq-bubble', c + 0.4 + (i % 3) * 0.22, 'cubic-bezier(.34,1.56,.64,1)') }}
              />
            ))}
            <span className="absolute inset-y-0 left-[760px] w-px bg-[#cfea5b]" />
            <Note left={520} top={104} anim={anim('hq-note-c', 0)} swatch={<span className="h-1 w-2.5 bg-of-heat-3" />}>
              {t('Ściana zjedzona przez transakcje', 'Wall eaten by trades')}
            </Note>
            <Note left={150} top={376} anim={anim('hq-note-b', 0)} swatch={<span className="size-2.5 rounded-[2px] border-[1.5px] border-of-poc" />}>
              {t('POC: najwięcej wolumenu w świecy', 'POC: most volume in the candle')}
            </Note>
            <Note left={520} top={304} anim={anim('hq-note-a', 0)} swatch={<span className="size-2.5 rounded-full border-[1.5px] border-[#82BCFC]" />}>
              {t('Bąbel: duże zlecenie agresora', 'Bubble: a large aggressor order')}
            </Note>
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2">
        <span className="flex items-center gap-2"><span aria-hidden className="size-3 rounded-[2px] bg-of-buy" />Ask: {t('agresywny zakup', 'aggressive buying')}</span>
        <span className="flex items-center gap-2"><span aria-hidden className="size-3 rounded-[2px] bg-of-sell" />Bid: {t('agresywna sprzedaż', 'aggressive selling')}</span>
        <span className="flex items-center gap-2"><span aria-hidden className="size-3 rounded-[2px] border-[1.5px] border-of-poc" />POC</span>
        <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-6 rounded-[1px] bg-linear-to-r from-of-heat-1 to-of-heat-3" />{t('Płynność w księdze', 'Book liquidity')}</span>
      </figcaption>
    </figure>
  );
};

function Note({ left, top, anim, swatch, children }: { left: number; top: number; anim?: string; swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="absolute flex items-center gap-2 rounded-md border border-[#343a42] bg-[#0c0d0f]/90 px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style={{ left, top, animation: anim }}>
      <span aria-hidden className="flex">{swatch}</span>
      {children}
    </span>
  );
}
