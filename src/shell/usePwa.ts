import { useSyncExternalStore } from 'react';

/** Zdarzenie Chromium „beforeinstallprompt” (brak w typach DOM). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaSnapshot {
  installEvent: BeforeInstallPromptEvent | null;
  waitingWorker: ServiceWorker | null;
  online: boolean;
  standalone: boolean;
}

// Mały magazyn zewnętrzny: zdarzenia PWA przychodzą zanim React zamontuje komponenty
let snap: PwaSnapshot = {
  installEvent: null,
  waitingWorker: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  standalone: detectStandalone(),
};
const listeners = new Set<() => void>();

function set(patch: Partial<PwaSnapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** iOS/iPadOS (iPadOS 13+ udaje Maca — rozpoznajemy po ekranie dotykowym). */
function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Wstrzymaj domyślny mini-baner; pokażemy własny przycisk „Zainstaluj”
    e.preventDefault();
    set({ installEvent: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => set({ installEvent: null, standalone: true }));
  window.addEventListener('online', () => set({ online: true }));
  window.addEventListener('offline', () => set({ online: false }));
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => set({ standalone: detectStandalone() }));
}

const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * Rejestracja service workera (tylko build produkcyjny). Wersja = nazwa bundla z hashem (`index-<hash>`),
 * przekazywana w URL skryptu SW — każdy deploy to nowy URL, więc nowa instalacja i nowy cache.
 * - Strona już działa na wersji czekającego SW (nawigacja network-first) → aktywacja po cichu.
 * - Długo otwarta karta: co 30 min i po powrocie do karty sprawdzamy index.html; nowy bundle → rejestracja
 *   nowej wersji SW → baner „Dostępna nowa wersja”.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const bundle = new URL(import.meta.url).pathname.split('/').pop() ?? 'app';
  const version = bundle.replace(/\.js$/, '');
  const swUrl = (v: string) => `./sw.js?v=${encodeURIComponent(v)}`;
  const versionOf = (w: ServiceWorker) => new URL(w.scriptURL).searchParams.get('v');

  // Nowy SW czeka: ta sama wersja co strona → bez pytania; inna → baner
  const onWaiting = (worker: ServiceWorker) => {
    if (!navigator.serviceWorker.controller) return;
    if (versionOf(worker) === version) worker.postMessage({ type: 'SKIP_WAITING' });
    else set({ waitingWorker: worker });
  };

  let lastCheck = Date.now();
  const checkForDeploy = async () => {
    lastCheck = Date.now();
    try {
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const latest = html.match(/src="\.\/assets\/([^"]+)\.js"/)?.[1];
      if (latest && latest !== version) await navigator.serviceWorker.register(swUrl(latest), { scope: './' });
    } catch {
      // offline lub błąd sieci — sprawdzimy przy następnej okazji
    }
  };

  const start = () => {
    navigator.serviceWorker
      .register(swUrl(version), { scope: './' })
      .then((reg) => {
        const track = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') onWaiting(worker);
          });
        };
        if (reg.waiting) onWaiting(reg.waiting);
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));
      })
      .catch((err) => console.error('[HyperQuant] Rejestracja service workera nie powiodła się', err));

    window.setInterval(checkForDeploy, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60 * 1000) void checkForDeploy();
    });

    // Po przejęciu kontroli przez wersję zaakceptowaną w banerze — jednorazowe przeładowanie
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !snap.waitingWorker) return;
      reloaded = true;
      window.location.reload();
    });
  };
  // Rejestracja po „load”, żeby nie konkurować z pierwszym pobraniem danych
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getSnapshot = () => snap;

/** Stan PWA dla UI: instalacja, aktualizacja, tryb offline. */
export function usePwa() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    canInstall: s.installEvent !== null && !s.standalone,
    isIos: detectIos(),
    isStandalone: s.standalone,
    online: s.online,
    updateReady: s.waitingWorker !== null,
    /** Pokazuje systemowe okno instalacji (event można użyć tylko raz). */
    install: async () => {
      const ev = s.installEvent;
      if (!ev) return;
      set({ installEvent: null });
      await ev.prompt();
      await ev.userChoice.catch(() => null);
    },
    /** Aktywuje czekającą wersję SW; przeładowanie nastąpi po „controllerchange”. */
    applyUpdate: () => s.waitingWorker?.postMessage({ type: 'SKIP_WAITING' }),
  };
}
