/**
 * Szkło łapie światło: elementy z klasą `hq-spot` dostają pozycję kursora (--sx, --sy), a CSS rozjaśnia ich krawędź
 * w tym miejscu. Jeden pasywny nasłuch na dokumencie, tylko przy precyzyjnym wskaźniku i bez ograniczonego ruchu.
 *
 * Ten sam nasłuch (23.11.2026) prowadzi dwa efekty:
 *  - `[data-tilt]`: karta przechyla się w 3D za kursorem (--tx, --ty od −1 do 1), z odblaskiem w miejscu kursora;
 *  - `.hq-przycisk-lume`: przycisk główny lekko „przyciąga się” do kursora (--mx, --my, najwyżej 5 px).
 * Po wyjściu kursora wartości wracają do zera (sprężyste przejście w CSS).
 */
let zainstalowane = false;

export function zainstalujSwiatloSzkla(): void {
  if (zainstalowane || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  zainstalowane = true;
  const precyzyjny = window.matchMedia('(hover: hover) and (pointer: fine)');
  const ograniczony = window.matchMedia('(prefers-reduced-motion: reduce)');
  let przechylona: HTMLElement | null = null;
  let magnes: HTMLElement | null = null;
  const zeruj = (el: HTMLElement | null, a: string, b: string) => {
    el?.style.setProperty(a, '0');
    el?.style.setProperty(b, '0');
  };
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!precyzyjny.matches || ograniczony.matches || document.documentElement.dataset.motion === 'reduced') return;
      const t = e.target as Element | null;
      const cel = t?.closest?.<HTMLElement>('.hq-spot');
      if (cel) {
        const r = cel.getBoundingClientRect();
        cel.style.setProperty('--sx', `${Math.round(e.clientX - r.left)}px`);
        cel.style.setProperty('--sy', `${Math.round(e.clientY - r.top)}px`);
      }
      const tilt = t?.closest?.<HTMLElement>('[data-tilt]') ?? null;
      if (tilt !== przechylona) {
        zeruj(przechylona, '--tx', '--ty');
        przechylona = tilt;
      }
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        tilt.style.setProperty('--tx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
        tilt.style.setProperty('--ty', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        if (!cel || cel !== tilt) {
          tilt.style.setProperty('--sx', `${Math.round(e.clientX - r.left)}px`);
          tilt.style.setProperty('--sy', `${Math.round(e.clientY - r.top)}px`);
        }
      }
      const lat = t?.closest?.<HTMLElement>('[data-latarka]');
      if (lat) {
        const r = lat.getBoundingClientRect();
        lat.style.setProperty('--lx', `${Math.round(e.clientX - r.left)}px`);
        lat.style.setProperty('--ly', `${Math.round(e.clientY - r.top)}px`);
      }
      const m = t?.closest?.<HTMLElement>('.hq-przycisk-lume') ?? null;
      if (m !== magnes) {
        zeruj(magnes, '--mx', '--my');
        magnes = m;
      }
      if (m) {
        const r = m.getBoundingClientRect();
        m.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(1)}px`);
        m.style.setProperty('--my', `${(((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(1)}px`);
      }
    },
    { passive: true }
  );
  // Fala światła po kliknięciu przycisku głównego (od miejsca kliknięcia); na dotyku też, bez ograniczonego ruchu
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (ograniczony.matches || document.documentElement.dataset.motion === 'reduced') return;
      const b = (e.target as Element | null)?.closest?.<HTMLElement>('.hq-przycisk-lume');
      if (!b) return;
      const r = b.getBoundingClientRect();
      const f = document.createElement('span');
      f.className = 'hq-klik-fala';
      f.setAttribute('aria-hidden', 'true');
      f.style.left = `${e.clientX - r.left}px`;
      f.style.top = `${e.clientY - r.top}px`;
      b.appendChild(f);
      window.setTimeout(() => f.remove(), 700);
    },
    { passive: true }
  );
  document.addEventListener(
    'pointerleave',
    () => {
      zeruj(przechylona, '--tx', '--ty');
      zeruj(magnes, '--mx', '--my');
      przechylona = magnes = null;
    },
    { passive: true }
  );
}
