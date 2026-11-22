/**
 * Szkło łapie światło: elementy z klasą `hq-spot` dostają pozycję kursora (--sx, --sy), a CSS rozjaśnia ich krawędź
 * w tym miejscu. Jeden pasywny nasłuch na dokumencie, tylko przy precyzyjnym wskaźniku i bez ograniczonego ruchu.
 */
let zainstalowane = false;

export function zainstalujSwiatloSzkla(): void {
  if (zainstalowane || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  zainstalowane = true;
  const precyzyjny = window.matchMedia('(hover: hover) and (pointer: fine)');
  const ograniczony = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!precyzyjny.matches || ograniczony.matches || document.documentElement.dataset.motion === 'reduced') return;
      const cel = (e.target as Element | null)?.closest?.<HTMLElement>('.hq-spot');
      if (!cel) return;
      const r = cel.getBoundingClientRect();
      cel.style.setProperty('--sx', `${Math.round(e.clientX - r.left)}px`);
      cel.style.setProperty('--sy', `${Math.round(e.clientY - r.top)}px`);
    },
    { passive: true }
  );
}
