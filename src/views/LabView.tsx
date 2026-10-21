import React, { Suspense, lazy, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useDesk, usePrefillFromSignal } from '../state/DeskContext';
import { EASE_IN, EASE_OUT, EmptyState, Segmented } from '../ui';
import { SCENES, SceneId } from './lab/scenes';
import { SceneInfo } from './lab/SceneInfo';

// Sceny 3D ładowane leniwie — three.js trafia do osobnego chunku i nie spowalnia ekranu Desk
const ThreeQuantViewport = lazy(() => import('../components/ThreeQuantViewport').then((m) => ({ default: m.ThreeQuantViewport })));
const ThreeOrderflowVortex3D = lazy(() => import('../components/ThreeOrderflowVortex3D').then((m) => ({ default: m.ThreeOrderflowVortex3D })));
const ThreeDeltaFluidField3D = lazy(() => import('../components/ThreeDeltaFluidField3D').then((m) => ({ default: m.ThreeDeltaFluidField3D })));
const ThreeQuantumRiskHeatmap3D = lazy(() => import('../components/ThreeQuantumRiskHeatmap3D').then((m) => ({ default: m.ThreeQuantumRiskHeatmap3D })));
const OptionVolatilitySurface3D = lazy(() => import('../components/OptionVolatilitySurface3D').then((m) => ({ default: m.OptionVolatilitySurface3D })));

/**
 * Lab 3D: jedna scena naraz (jeden kontekst WebGL). Przejście = krótkie przenikanie krycia;
 * AnimatePresence mode="wait" odmontowuje poprzednią scenę (i zwalnia GPU) przed zamontowaniem kolejnej.
 */
const LabView: React.FC = () => {
  const { feed, shaakuni, heatmap, quant, ofi } = useDesk();
  const reduceMotion = useReducedMotion();
  const [scene, setScene] = useState<SceneId>('liquidity');
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const onFluid = usePrefillFromSignal('Lab · Delta Fluid');
  const onMagnet = usePrefillFromSignal('Lab · Liquidation Risk (szacunek)');
  const latestBar = feed.latestBar;
  const meta = SCENES.find((s) => s.id === scene) ?? SCENES[0];

  // ←/→ przy fokusie na przełączniku: poprzednia/następna scena, fokus podąża za wyborem
  const onSwitcherKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = SCENES.findIndex((s) => s.id === scene);
    const next = SCENES[(i + (e.key === 'ArrowRight' ? 1 : -1) + SCENES.length) % SCENES.length];
    setScene(next.id);
    requestAnimationFrame(() => {
      const btns = switcherRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      btns?.[SCENES.indexOf(next)]?.focus();
    });
  };

  const fade = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: reduceMotion ? 0.12 : 0.2, ease: EASE_OUT } },
    exit: { opacity: 0, transition: { duration: reduceMotion ? 0.08 : 0.12, ease: EASE_IN } },
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={switcherRef} onKeyDown={onSwitcherKey} className="overflow-x-auto max-w-full -mx-1 px-1 py-1">
        <Segmented<SceneId>
          ariaLabel="Scena 3D (strzałki ←/→ przełączają)"
          value={scene}
          onChange={setScene}
          options={SCENES.map((s) => ({
            value: s.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {s.icon}
                {s.label}
              </span>
            ),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div
          className={`lg:col-span-9 min-w-0 ${
            meta.autoHeight ? '' : 'h-[60vh] min-h-[340px] lg:h-[min(72vh,760px)] lg:min-h-[480px]'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={scene} className="h-full" {...fade}>
              <Suspense fallback={<EmptyState title="Ładowanie sceny 3D…" className="h-full bg-surface-1 border border-line rounded-xl" />}>
                {scene === 'liquidity' && (
                  <ThreeQuantViewport bars={feed.bars} shaakuni={shaakuni} heatmap={heatmap} quant={quant} bids={feed.bids} asks={feed.asks} isExpanded />
                )}
                {scene === 'vortex' &&
                  (latestBar ? (
                    <ThreeOrderflowVortex3D latestBar={latestBar} shaakuni={shaakuni} quant={quant} backendTelemetry={feed.backendTelemetry} isExpanded />
                  ) : (
                    <EmptyState title="Czekam na pierwszą świecę" detail="Scena potrzebuje bieżącej świecy Hyperliquid." className="h-full bg-surface-1 border border-line rounded-xl" />
                  ))}
                {scene === 'fluid' && (
                  <ThreeDeltaFluidField3D
                    bars={feed.bars}
                    trades={feed.trades}
                    shaakuni={shaakuni}
                    quant={quant}
                    ofiSummary={ofi}
                    currentPrice={feed.currentPrice}
                    isExpanded
                    onTriggerFluidSignal={onFluid}
                  />
                )}
                {scene === 'risk' && (
                  <ThreeQuantumRiskHeatmap3D
                    currentPrice={feed.currentPrice}
                    shaakuni={shaakuni}
                    quant={quant}
                    heatmap={heatmap}
                    bids={feed.bids}
                    asks={feed.asks}
                    isExpanded
                    onTriggerMagnetSignal={onMagnet}
                  />
                )}
                {scene === 'options' && (
                  <OptionVolatilitySurface3D currentPrice={feed.currentPrice} shaakuni={shaakuni} quant={quant} backendTelemetry={feed.backendTelemetry} isExpanded />
                )}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="lg:col-span-3 min-w-0">
          <SceneInfo scene={meta} />
        </div>
      </div>
    </div>
  );
};
export default LabView;
