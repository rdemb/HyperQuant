import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiquidityProfileBucket, QuantMathMetrics, ShaakuniState } from '../types/trading';
import { Badge, Panel, Stat, DASH, fmtCompact, fmtPct, fmtPrice, fmtSigned } from '../ui';
import { PrefillButtons } from './QuantSignalDesk';

type Direction = 'LONG' | 'SHORT';

// Kolory tokenów (docs/STYLEGUIDE.md §2) — canvas nie czyta klas Tailwind
const C = {
  surface: '#0b1019',
  surface2: '#101826',
  surface3: '#16202f',
  line: '#1b2533',
  ink1: '#eef2f7',
  ink2: '#a9b4c4',
  ink3: '#7a889c',
  accent: '#3fc6dd',
  buy: '#19a88e',
  sell: '#d9582e',
  level: '#e0a045',
  zone: '#9085e9',
};

const TOP_PAD = 26;
const BOTTOM_PAD = 8;

interface ProfileLayout {
  width: number;
  height: number;
  axisW: number;
  splitX: number;
  rowH: number;
}

function layoutFor(width: number, height: number, rows: number): ProfileLayout {
  const axisW = width < 420 ? 52 : 64;
  return {
    width,
    height,
    axisW,
    splitX: axisW + (width - axisW) * 0.52,
    rowH: (height - TOP_PAD - BOTTOM_PAD) / Math.max(1, rows),
  };
}

/** Bohater widoku Mikrostruktura: profil wolumenu (LIVE) + szacowane paliwo likwidacyjne i krzywa U(p) (MODEL). */
export const LiquidityMicrostructureLab: React.FC<{
  quant: QuantMathMetrics;
  shaakuni: ShaakuniState;
  currentPrice: number;
}> = ({ quant, shaakuni, currentPrice }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Profil od najwyższej ceny (góra) do najniższej (dół)
  const profile = useMemo(() => [...quant.liquidityProfile].sort((a, b) => b.price - a.price), [quant.liquidityProfile]);
  const maxFuel = useMemo(() => Math.max(0, ...profile.map((p) => p.liquidationPoolUsd)), [profile]);

  // Rozmiar płótna śledzony ResizeObserverem (obrót telefonu, zmiana kolumn siatki)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 50 || size.h < 50 || profile.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const L = layoutFor(size.w, size.h, profile.length);
    const { width, height, axisW, splitX, rowH } = L;
    const volColW = splitX - axisW - 44;
    const fuelColW = width - splitX - 16;
    const maxVol = Math.max(1, ...profile.map((p) => p.totalVolumeUsd));
    const barH = Math.max(3, Math.min(16, rowH - 4));
    const midY = (i: number) => TOP_PAD + i * rowH + rowH / 2;

    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, width, height);

    // Nagłówki kolumn (ink-3, eyebrow)
    ctx.fillStyle = C.ink3;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('CENA', 6, 12);
    ctx.fillText('WOLUMEN K/S', axisW + 6, 12);
    ctx.fillText(width < 420 ? 'PALIWO · U(p)' : 'PALIWO (SZACUNEK) · U(p)', splitX + 8, 12);

    // Hairline: separator nagłówka i kolumn (ciągłe)
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TOP_PAD - 4.5);
    ctx.lineTo(width, TOP_PAD - 4.5);
    ctx.moveTo(axisW + 0.5, TOP_PAD - 4);
    ctx.lineTo(axisW + 0.5, height);
    ctx.moveTo(splitX + 0.5, TOP_PAD - 4);
    ctx.lineTo(splitX + 0.5, height);
    ctx.stroke();

    // LVN oznaczamy tylko jako lukę wewnątrz zakresu handlu (między poziomami z wolumenem), nie na pustych brzegach
    const traded = profile.map((b, i) => (b.isLVN ? -1 : i)).filter((i) => i >= 0);
    const firstTraded = traded.length ? traded[0] : 0;
    const lastTraded = traded.length ? traded[traded.length - 1] : -1;

    const gravityPts: { x: number; y: number }[] = [];
    profile.forEach((b, i) => {
      const y0 = TOP_PAD + i * rowH;
      const y = midY(i);
      if (i === hoverIdx) {
        ctx.fillStyle = C.surface3;
        ctx.fillRect(0, y0, width, rowH);
      } else if (b.isValueArea) {
        ctx.fillStyle = C.surface2;
        ctx.fillRect(axisW + 1, y0, splitX - axisW - 1, rowH);
      }

      // Etykieta ceny (POC wyróżniony wagą, nie kolorem)
      ctx.textAlign = 'left';
      ctx.font = b.isPOC ? '700 10px "IBM Plex Mono", monospace' : '500 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = b.isPOC ? C.ink1 : C.ink2;
      ctx.fillText(fmtPrice(b.price, 0), 6, y);

      // Słupek wolumenu: kupno (buy) + sprzedaż (sell), zaokrąglony koniec
      const totW = Math.max(2, (b.totalVolumeUsd / maxVol) * volColW);
      const buyW = b.totalVolumeUsd > 0 ? totW * (b.buyVolumeUsd / b.totalVolumeUsd) : 0;
      const x0 = axisW + 6;
      ctx.fillStyle = C.buy;
      ctx.fillRect(x0, y - barH / 2, buyW, barH);
      ctx.fillStyle = C.sell;
      ctx.beginPath();
      ctx.roundRect(x0 + buyW, y - barH / 2, Math.max(1, totW - buyW), barH, [0, 3, 3, 0]);
      ctx.fill();

      const isGap = b.isLVN && i > firstTraded && i < lastTraded;
      const tag = b.isPOC ? 'POC' : b.price === quant.vahPrice ? 'VAH' : b.price === quant.valPrice ? 'VAL' : isGap ? 'LVN' : '';
      if (tag) {
        ctx.font = '600 9px "IBM Plex Mono", monospace';
        ctx.fillStyle = tag === 'LVN' ? C.ink3 : tag === 'POC' ? C.ink1 : C.ink2;
        ctx.fillText(tag, x0 + totW + 5, y);
      }

      // Słupek szacowanego paliwa likwidacyjnego (strefa modelu)
      const isMagnet = b.price === quant.primaryMagnetPrice;
      const fuelW = maxFuel > 0 ? (b.liquidationPoolUsd / maxFuel) * fuelColW * 0.8 : 0;
      if (fuelW > 0.5) {
        ctx.globalAlpha = isMagnet ? 0.95 : 0.45;
        ctx.fillStyle = C.zone;
        ctx.beginPath();
        ctx.roundRect(splitX + 8, y - barH / 2, fuelW, barH, [0, 3, 3, 0]);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      gravityPts.push({ x: splitX + 8 + b.gravityPotential * fuelColW * 0.9, y });
    });

    // Krzywa przyciągania U(p): linia 2 px w kolorze akcentu
    if (gravityPts.length > 1) {
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      gravityPts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      const mIdx = profile.findIndex((b) => b.price === quant.primaryMagnetPrice);
      if (mIdx >= 0) {
        const m = gravityPts[mIdx];
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = C.surface;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = C.ink1;
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.textAlign = m.x > width - 70 ? 'right' : 'left';
        ctx.fillText('magnes', m.x + (m.x > width - 70 ? -8 : 8), m.y);
      }
    }

    // Poziomy PDH/PDL (level) i bieżąca cena — mapowanie liniowe po środkach kubełków
    const maxP = profile[0].price;
    const minP = profile[profile.length - 1].price;
    const priceToY = (p: number) => midY(0) + ((maxP - p) / Math.max(1, maxP - minP)) * (midY(profile.length - 1) - midY(0));
    const hline = (p: number | null, color: string, label: string, alpha: number) => {
      if (p === null || !Number.isFinite(p)) return;
      const y = Math.round(priceToY(p)) + 0.5;
      if (y < TOP_PAD || y > height - BOTTOM_PAD) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisW, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = C.surface;
      ctx.fillRect(width - tw - 10, y - 7, tw + 8, 14);
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(label, width - 6, y);
    };
    hline(shaakuni.pdh, C.level, 'PDH', 0.6);
    hline(shaakuni.pdl, C.level, 'PDL', 0.6);
    hline(currentPrice > 0 ? currentPrice : null, C.ink1, `cena ${fmtPrice(currentPrice, 0)}`, 0.7);
  }, [profile, size, hoverIdx, maxFuel, quant.vahPrice, quant.valPrice, quant.primaryMagnetPrice, shaakuni.pdh, shaakuni.pdl, currentPrice]);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const L = layoutFor(rect.width, rect.height, profile.length);
    const idx = Math.floor((e.clientY - rect.top - TOP_PAD) / L.rowH);
    setHoverIdx(idx >= 0 && idx < profile.length ? idx : null);
    setHoverX(e.clientX - rect.left);
  };

  const hovered: LiquidityProfileBucket | null = hoverIdx !== null ? profile[hoverIdx] ?? null : null;
  const L = layoutFor(size.w, size.h, profile.length);
  const magnetDistPct = currentPrice > 0 ? ((quant.primaryMagnetPrice - currentPrice) / currentPrice) * 100 : null;
  const fuelTotal = quant.shortSqueezeFuelUsd + quant.longCascadeFuelUsd;
  const fuelAboveShare = fuelTotal > 0 ? quant.shortSqueezeFuelUsd / fuelTotal : null;
  const depthTotal = quant.bookDepthAskUsd + quant.bookDepthBidUsd;
  const bidShare = depthTotal > 0 ? quant.bookDepthBidUsd / depthTotal : null;

  return (
    <Panel
      hero
      title="Profil płynności"
      eyebrow="80 świec · 24 poziomy · pole U(p)"
      className="h-full"
      actions={
        <>
          <Badge tone="live" title="Wolumen świec Hyperliquid; podział kupno/sprzedaż z WebSocket tam, gdzie dostępny">LIVE</Badge>
          <Badge tone="model" title="Paliwo likwidacyjne i U(p) to heurystyczny szacunek">MODEL</Badge>
        </>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
        <Stat
          label="Magnes"
          source={{ tone: 'model', label: 'MODEL', title: 'Heurystyka: paliwo + masa OB + wolumen, ważone odległością od ceny' }}
          value={fmtPrice(quant.primaryMagnetPrice, 0)}
          hint={
            magnetDistPct !== null ? (
              <>
                najsilniejsze U(p) · <span aria-hidden="true">{magnetDistPct >= 0 ? '▲' : '▼'}</span>{' '}
                {fmtPct(Math.abs(magnetDistPct), 2, false)} {magnetDistPct >= 0 ? 'nad ceną' : 'pod ceną'}
              </>
            ) : (
              DASH
            )
          }
        />
        <Stat
          label="Wolumen"
          source={{ tone: 'live', label: 'LIVE', title: 'Wolumen ostatnich 80 świec Hyperliquid rozłożony na 24 poziomy' }}
          value={`POC ${fmtPrice(quant.pocPrice, 0)}`}
          hint={`VA 70%: ${fmtPrice(quant.valPrice, 0)} – ${fmtPrice(quant.vahPrice, 0)}`}
        />
        <Stat
          label="Paliwo"
          source={{ tone: 'model', label: 'SZAC.', title: 'Szacunek z wolumenu przy założonych dźwigniach 5/20/100× i pul przy PDH/PDL/PWH/PWL — nie realne pozycje' }}
          value={
            fuelAboveShare !== null ? (
              <span className="text-base">
                <span aria-hidden="true">▲</span> {(fuelAboveShare * 100).toFixed(0)}% <span className="text-ink-3">/</span>{' '}
                <span aria-hidden="true">▼</span> {((1 - fuelAboveShare) * 100).toFixed(0)}%
              </span>
            ) : (
              DASH
            )
          }
          hint="likwidacje (szac.) nad / pod ceną"
        />
        <Stat
          label="Arkusz L2"
          source={depthTotal > 0 ? { tone: 'live', label: 'LIVE', title: 'Suma płynności 12 poziomów arkusza Hyperliquid' } : { tone: 'stale', label: 'BRAK', title: 'Brak arkusza' }}
          value={
            <span className="text-base">
              {fmtCompact(quant.bookDepthBidUsd, '$')} <span className="text-ink-3">/</span> {fmtCompact(quant.bookDepthAskUsd, '$')}
            </span>
          }
          hint={
            bidShare !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="relative h-1.5 w-16 rounded-full bg-sell/70 overflow-hidden" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 bg-buy" style={{ width: `${(bidShare * 100).toFixed(0)}%` }} />
                </span>
                BID {(bidShare * 100).toFixed(0)}% · 12 poz.
              </span>
            ) : (
              'czekam na arkusz'
            )
          }
        />
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-[400px] sm:min-h-[460px] rounded-lg overflow-hidden border border-line">
        {profile.length === 0 ? (
          <div className="p-4 text-sm text-ink-3">Za mało świec do zbudowania profilu.</div>
        ) : (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Profil wolumenu na 24 poziomach; POC ${fmtPrice(quant.pocPrice, 0)}, najsilniejsze przyciąganie ${fmtPrice(quant.primaryMagnetPrice, 0)}`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHoverIdx(null)}
            className="block w-full h-full cursor-crosshair touch-pan-y"
          />
        )}
        {hovered && hoverIdx !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-[11px] shadow-xl w-[200px]"
            style={{
              top: Math.max(4, Math.min(size.h - 136, TOP_PAD + hoverIdx * L.rowH + L.rowH + 6)),
              left: Math.max(4, Math.min(size.w - 204, hoverX - 100)),
            }}
          >
            <div className="font-mono tabular-nums text-ink-1 font-semibold">
              {fmtPrice(hovered.price, 0)}
              <span className="text-ink-3 font-sans font-normal">
                {hovered.isPOC ? ' · POC' : ''}
                {hovered.isValueArea ? ' · VA' : ''}
                {hovered.isLVN ? ' · LVN' : ''}
              </span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
              <dt className="text-ink-3 font-sans">Kupno</dt>
              <dd className="text-right text-ink-1">
                <span className="text-buy-ink" aria-hidden="true">▲ </span>
                {fmtCompact(hovered.buyVolumeUsd, '$')}
              </dd>
              <dt className="text-ink-3 font-sans">Sprzedaż</dt>
              <dd className="text-right text-ink-1">
                <span className="text-sell-ink" aria-hidden="true">▼ </span>
                {fmtCompact(hovered.sellVolumeUsd, '$')}
              </dd>
              <dt className="text-ink-3 font-sans">Delta</dt>
              <dd className="text-right text-ink-1">{fmtCompact(hovered.deltaUsd, '$')}</dd>
              <dt className="text-ink-3 font-sans">Paliwo (szac.)</dt>
              <dd className="text-right text-ink-1">{maxFuel > 0 ? `${((hovered.liquidationPoolUsd / maxFuel) * 100).toFixed(0)}% maks.` : DASH}</dd>
              <dt className="text-ink-3 font-sans">U(p)</dt>
              <dd className="text-right text-ink-1">{(hovered.gravityPotential * 100).toFixed(0)}%</dd>
            </dl>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-2">
        <LegendSwatch className="bg-buy" label="Wolumen kupna" />
        <LegendSwatch className="bg-sell" label="Wolumen sprzedaży" />
        <LegendSwatch className="bg-zone/60" label="Paliwo likwidacyjne (szacunek)" />
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded-full bg-accent" aria-hidden="true" /> Krzywa U(p)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-px bg-level" aria-hidden="true" /> PDH / PDL
        </span>
        <LegendSwatch className="bg-surface-2 border border-line-strong" label="Value Area 70%" />
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed max-w-prose">
        Paliwo likwidacyjne to szacunek z wolumenu świec przy założonych dźwigniach (5/20/100×) oraz pul przy PDH/PDL/PWH/PWL —
        Hyperliquid nie publikuje mapy likwidacji, więc to nie są realne pozycje. U(p) porządkuje poziomy wg heurystycznej
        „siły przyciągania”; nie mówi, czy i kiedy cena tam dotrze.
      </p>
    </Panel>
  );
};

const LegendSwatch: React.FC<{ className: string; label: string }> = ({ className, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`w-2.5 h-2.5 rounded-sm ${className}`} aria-hidden="true" />
    {label}
  </span>
);

interface Method {
  id: string;
  title: string;
  subtitle: string;
  formula: string;
  idea: string;
  check: string;
  metricLabel: string;
  metricValue: string;
}

/** Edukacyjny opis metod mikrostruktury — hipotezy do weryfikacji, bez rekomendacji kierunku. */
export const MicrostructureMethods: React.FC<{
  quant: QuantMathMetrics;
  shaakuni: ShaakuniState;
  currentPrice: number;
  onPrefillPlan?: (dir: Direction, title?: string, reason?: string) => void;
}> = ({ quant, shaakuni, currentPrice, onPrefillPlan }) => {
  const [selectedId, setSelectedId] = useState('gravity');
  const magnetPct = currentPrice > 0 ? ((quant.primaryMagnetPrice - currentPrice) / currentPrice) * 100 : null;

  const methods: Method[] = [
    {
      id: 'gravity',
      title: 'Pole przyciągania U(p)',
      subtitle: 'Szacowane pule likwidacji, strefy OB i wolumen ważone odległością od ceny',
      formula: 'U(p) = Σ (1,4·Paliwoᵢ + Masa_OBᵢ + 0,18·Wolᵢ) / |p − pᵢ|^0,55',
      idea:
        'Hipoteza: cena szybciej przechodzi przez obszary niskiego wolumenu (LVN) w stronę skupisk zleceń stop i likwidacji. Model jedynie porządkuje takie obszary według heurystycznej wagi — nie przewiduje, czy i kiedy cena do nich dotrze. Skuteczność nie została zmierzona.',
      check:
        'Zapisuj poziom najsilniejszego U(p) i sprawdzaj, jak często cena dotyka go w ciągu N świec — w porównaniu z losowym poziomem w tej samej odległości.',
      metricLabel: 'Najsilniejsze U(p)',
      metricValue: `${fmtPrice(quant.primaryMagnetPrice, 0)}${magnetPct !== null ? ` (${fmtPct(magnetPct, 2)})` : ''}`,
    },
    {
      id: 'vpin',
      title: 'VPIN — jednostronność przepływu',
      subtitle: 'Nierównowaga kupna i sprzedaży w kubełkach wolumenowych (BVC)',
      formula: 'VPIN = Σ |V_kupno − V_sprzedaż| / (n · V_kubełka)',
      idea:
        'VPIN (Easley, López de Prado, O’Hara 2012) opisuje, jak jednostronny jest przepływ. Jego zdolność przewidywania jest sporna (Andersen & Bondarenko 2014), dlatego traktuj go jako opis bieżącego przepływu, a nie sygnał. Dywergencja spot/perp jest liczona tylko przy włączonych źródłach CEX.',
      check: 'Porównuj bieżący VPIN z jego rozkładem z ostatnich sesji — wysoki percentyl oznacza przepływ nietypowo jednostronny.',
      metricLabel: 'VPIN · dywergencja spot/perp',
      metricValue: `${(quant.vpinToxicity * 100).toFixed(1)}% · ${quant.cvdDivergenceScore !== 0 ? fmtSigned(quant.cvdDivergenceScore * 100, 1, '%') : 'n/a (bez CEX)'}`,
    },
    {
      id: 'kyle',
      title: 'λ Kyle’a i asymetria arkusza',
      subtitle: 'Wpływ przepływu na cenę (OLS) + głębokość 12 poziomów L2',
      formula: 'ΔPₜ = λ · Qₜ + ε   ·   A = (D_bid − D_ask) / (D_bid + D_ask)',
      idea:
        'λ mierzy, o ile przesuwa się cena na jednostkę netto przepływu agresora — im wyżej, tym rynek mniej płynny. Asymetria pokazuje, po której stronie 12 najbliższych poziomów stoi mniej zleceń. Arkusz to migawka: zlecenia mogą zniknąć w ułamku sekundy.',
      check: 'Porównuj λ o różnych porach dnia i przed publikacjami makro; rosnące λ oznacza rynek łatwiejszy do przesunięcia.',
      metricLabel: 'λ · głębokość BID / ASK',
      metricValue: `${quant.kyleLambdaPer1M !== null ? `$${quant.kyleLambdaPer1M.toFixed(2)} / $1M` : 'n/a'} · ${fmtCompact(quant.bookDepthBidUsd, '$')} / ${fmtCompact(quant.bookDepthAskUsd, '$')}`,
    },
    {
      id: 'hawkes',
      title: 'Proces Hawkesa — grupowanie transakcji',
      subtitle: 'Samowzbudzająca się intensywność agresywnych transakcji',
      formula: 'λ(t) = μ + Σ α · e^(−β(t − tᵢ))',
      idea:
        'Agresywne transakcje grupują się w czasie: każda zwiększa szansę następnej. Tutaj μ, α i β są stałe (nieestymowane), więc intensywność opisuje tempo przepływu. Współczynnik rozgałęzienia η wymaga estymacji MLE i nie jest liczony.',
      check: 'Obserwuj skoki intensywności przy testach PDH/PDL i notuj, czy ruch był kontynuowany, czy wygasł.',
      metricLabel: 'λ kupno / sprzedaż · η',
      metricValue: `${quant.hawkesBuyIntensity.toFixed(2)} / ${quant.hawkesSellIntensity.toFixed(2)} · η = ${quant.hawkesBranchingRatio ?? 'n/a'}`,
    },
    {
      id: 'ou',
      title: 'Powrót do średniej (Ornstein-Uhlenbeck)',
      subtitle: 'Tempo powrotu do kotwicy 0,65·D-EQ + 0,35·W-EQ',
      formula: 'dXₜ = θ(EQ − Xₜ)dt + σ dWₜ   ·   t½ = ln 2 / θ',
      idea:
        'OU opisuje, jak szybko cena wraca do kotwicy; Z-score mówi, jak daleko od niej jesteśmy w odchyleniach standardowych. Parametry z krótkiej historii są niestabilne, a duże |Z| bywa początkiem trendu, nie okazją.',
      check: 'Czytaj t½ razem z Hurstem: H > 0,6 przy dużym |Z| przemawia przeciw założeniu powrotu.',
      metricLabel: 'Z · t½',
      metricValue: `Z ${fmtSigned(quant.ouZScore, 2)}σ · t½ ${Number.isFinite(quant.ouHalfLifeBars) ? `${quant.ouHalfLifeBars.toFixed(1)} świec` : '∞'} · D-EQ ${fmtPrice(shaakuni.deq, 0)}`,
    },
  ];
  const sel = methods.find((m) => m.id === selectedId) ?? methods[0];

  return (
    <Panel
      title="Metody — jak czytać metryki"
      eyebrow="Edukacyjnie · hipotezy do weryfikacji"
      actions={<Badge tone="neutral" title="Opis metod, nie rekomendacje">EDU</Badge>}
      className="h-full"
      bodyClassName="p-4 grid grid-cols-1 md:grid-cols-12 gap-4"
    >
      <div className="md:col-span-5 flex flex-col gap-1" role="tablist" aria-label="Metoda" aria-orientation="vertical">
        {methods.map((m, i) => {
          const active = m.id === sel.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedId(m.id)}
              className={`text-left px-3 py-2 min-h-11 rounded-lg border transition-colors duration-150 ${
                active ? 'bg-surface-3 border-line-strong text-ink-1' : 'border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink-1'
              }`}
            >
              <span className="text-[13px] font-medium">
                <span className="font-mono text-ink-3 mr-1.5">0{i + 1}</span>
                {m.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="md:col-span-7 flex flex-col gap-3 min-w-0" role="tabpanel">
        <div>
          <h3 className="text-[15px] font-semibold text-ink-1 leading-tight">{sel.title}</h3>
          <p className="text-xs text-ink-3 mt-0.5">{sel.subtitle}</p>
        </div>
        <div className="px-3 py-2 bg-page border border-line rounded-lg font-mono text-xs text-ink-2 overflow-x-auto whitespace-nowrap">{sel.formula}</div>
        <p className="text-[13px] text-ink-2 leading-relaxed">{sel.idea}</p>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Jak to sprawdzić</div>
          <p className="text-[13px] text-ink-2 leading-relaxed mt-0.5">{sel.check}</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 pt-3 border-t border-line mt-auto">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{sel.metricLabel}</div>
            <div className="font-mono tabular-nums text-sm text-ink-1 break-words">{sel.metricValue}</div>
          </div>
          {onPrefillPlan && (
            <PrefillButtons onPick={(dir) => onPrefillPlan(dir, `Mikrostruktura · ${sel.title}`, `${sel.metricLabel}: ${sel.metricValue}`)} />
          )}
        </div>
      </div>
    </Panel>
  );
};
