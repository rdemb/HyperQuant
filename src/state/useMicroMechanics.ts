import { useEffect, useState } from 'react';
import { MicroMetrics, microEngine } from '../utils/microEngine';

/** Metryki mechaniki arkusza: odświeżane co 5 s, dopasowanie Hawkesa co 30 s (tylko w widocznej karcie). */
export function useMicroMechanics(): MicroMetrics {
  const [m, setM] = useState<MicroMetrics>(() => microEngine.metrics(Date.now()));
  useEffect(() => {
    let lastFit = 0;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFit >= 30_000) {
        microEngine.refit(now);
        lastFit = now;
      }
      setM(microEngine.metrics(now));
    };
    run();
    const id = window.setInterval(run, 5_000);
    return () => clearInterval(id);
  }, []);
  return m;
}
