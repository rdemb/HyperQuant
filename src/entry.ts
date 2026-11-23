import { mountPortal } from './shell/mountPortal';
import { moveOut } from './shell/originMove';
import { sluchajBledowLadowania } from './shell/preloadError';
import { registerServiceWorker } from './shell/usePwa';

const PORTAL_HASH = /^(?:#(?:start|top|main|linia|poznaj|przekroj|obserwacja|terminal|dzien|onchain|dowod|pochodzenie|wszedzie|final|tour-[a-z]+))?$/;

function isPortal(hash: string) {
  return hash === '#' || PORTAL_HASH.test(hash);
}

const portal = isPortal(location.hash);
window.addEventListener('hashchange', (event) => {
  // Zachowaj adres i historię. Zmiana dokumentu usuwa subskrypcje i arkusze poprzedniej powierzchni.
  if (event.newURL === location.href && isPortal(location.hash) !== portal) location.reload();
});

sluchajBledowLadowania();
if (import.meta.env.PROD) registerServiceWorker();
void moveOut(window);

if (portal) {
  mountPortal().catch((error: unknown) => {
    console.error('[HyperQuant] Przekrój niedostępny', error);
    import('./main');
  });
} else {
  import('./main');
}
