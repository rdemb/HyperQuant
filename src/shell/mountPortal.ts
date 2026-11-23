function loadResource(
  element: HTMLLinkElement | HTMLScriptElement,
  url: string,
  signal: AbortSignal,
  start = () => document.head.append(element),
) {
  return new Promise<void>((resolve, reject) => {
    const finish = (settle: () => void) => {
      signal.removeEventListener('abort', abort);
      element.onload = element.onerror = null;
      settle();
    };
    const abort = () => finish(() => reject(signal.reason));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    element.onload = () => finish(resolve);
    element.onerror = () => finish(() => reject(new Error(`Nie wczytano ${url}`)));
    start();
  });
}

async function loadPortalStyle(link: HTMLLinkElement, signal: AbortSignal) {
  try {
    await loadResource(link, link.href, signal);
  } catch (error) {
    if (signal.aborted || !link.isConnected) throw error;
    const retry = new URL(link.href);
    retry.searchParams.set('hq-retry', '1');
    // Zmieniamy adres w miejscu, aby zachować kolejność arkuszy w kaskadzie.
    await loadResource(link, retry.href, signal, () => { link.href = retry.href; });
  }
}

async function readPortalHtml(url: URL, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Główny adres używa tego samego dokumentu Przekroju co /nowy/, z jego własnymi stylami i skryptami. */
export async function mountPortal() {
  const portalUrl = new URL('nowy/index.html', document.baseURI);
  // Wspólny limit obejmuje dokument, równoległe style i skrypty w kolejności ich zależności.
  const signal = AbortSignal.timeout(8_000);
  const firstAttempt = AbortSignal.timeout(2_500);
  let html: string;
  try {
    html = await readPortalHtml(portalUrl, { signal: firstAttempt });
  } catch (error) {
    // Po zawieszeniu pobierania jedna próba w pozostałym czasie startu.
    if (!firstAttempt.aborted || signal.aborted) throw error;
    html = await readPortalHtml(portalUrl, { signal, cache: 'reload' });
  }
  const portal = new DOMParser().parseFromString(html, 'text/html');
  if (!portal.querySelector('#cinema-title')) throw new Error('Brak strony Przekroju');

  const resolve = (url: string) => new URL(url, portalUrl).href;
  const attributes = ['href', 'src', 'srcset', 'data-src', 'data-webm', 'data-mp4', 'data-webm-portrait', 'data-mp4-portrait'];
  for (const attribute of attributes) {
    for (const el of portal.body.querySelectorAll(`[${attribute}]`)) {
      const url = el.getAttribute(attribute);
      if (url && !url.startsWith('#')) el.setAttribute(attribute, resolve(url));
    }
  }
  const originalBody = document.body;
  const preferences = document.documentElement.dataset;
  const originalTheme = preferences.theme;
  const originalPalette = preferences.palette;
  const originalGrain = preferences.grain;
  const styles = [...portal.querySelectorAll('link[rel="stylesheet"]')].map((source) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = resolve(source.getAttribute('href')!);
    return link;
  });
  const scripts: HTMLScriptElement[] = [];
  const HQ = { portalBase: portalUrl.href, readyQueue: [] as Array<() => void> };
  Object.assign(window, { HQ });
  try {
    await Promise.all(styles.map((link) => loadPortalStyle(link, signal)));
    if (new URLSearchParams(location.search).get('ziarno') === '1') document.documentElement.dataset.grain = '1';
    preferences.palette = 'zorza';
    try {
      if (localStorage.getItem('hqp.palette') === 'ton') preferences.palette = 'ton';
    } catch {
      // The default palette also works without browser storage.
    }
    document.body.replaceWith(portal.body);
    for (const source of portal.querySelectorAll('script[src]')) {
      const script = document.createElement('script');
      script.src = resolve(source.getAttribute('src')!);
      scripts.push(script);
      await loadResource(script, script.src, signal);
    }
    for (const run of HQ.readyQueue) run();
    const anchor = location.hash.slice(1);
    if (anchor && anchor !== 'start') document.getElementById(anchor)?.scrollIntoView();
  } catch (error) {
    document.body.replaceWith(originalBody);
    if (originalTheme !== undefined) preferences.theme = originalTheme;
    else delete preferences.theme;
    if (originalPalette !== undefined) preferences.palette = originalPalette;
    else delete preferences.palette;
    if (originalGrain !== undefined) preferences.grain = originalGrain;
    else delete preferences.grain;
    styles.forEach((link) => link.remove());
    scripts.forEach((script) => script.remove());
    throw error;
  }
}
