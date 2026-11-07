/** Krawędzie przewijanego w bok rzędu, za którymi jest jeszcze treść. */
export type FadeEdge = 'none' | 'left' | 'right' | 'both';

/** Które krawędzie rzędu mają jeszcze treść do przewinięcia (zapas 1 px na zaokrąglenia szerokości). */
export function fadeEdge(scrollLeft: number, clientWidth: number, scrollWidth: number): FadeEdge {
  const left = scrollLeft > 1;
  const right = scrollLeft + clientWidth < scrollWidth - 1;
  return left && right ? 'both' : left ? 'left' : right ? 'right' : 'none';
}

/**
 * Odwołanie (ref) rzędu przewijanego w bok, np. pasek narzędzi wykresu na telefonie: ustawia `data-fade`, a klasa
 * `hq-fade-x` (index.css) wygasza krawędź, za którą jest jeszcze treść — widać, że rząd się przewija. Liczone przy
 * przewinięciu, zmianie szerokości rzędu albo jego elementów i zmianie listy elementów. Stała funkcja: React 19 woła
 * zwrócone sprzątanie przy odpięciu elementu.
 */
export function scrollFadeRef(el: HTMLElement | null): (() => void) | undefined {
  if (!el || typeof ResizeObserver === 'undefined') return undefined;
  const set = () => {
    el.dataset.fade = fadeEdge(el.scrollLeft, el.clientWidth, el.scrollWidth);
  };
  const ro = new ResizeObserver(set);
  const watch = () => {
    ro.disconnect();
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    set();
  };
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch);
  mo?.observe(el, { childList: true });
  el.addEventListener('scroll', set, { passive: true });
  watch();
  return () => {
    ro.disconnect();
    mo?.disconnect();
    el.removeEventListener('scroll', set);
  };
}
