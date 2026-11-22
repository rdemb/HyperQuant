function loadScript(source: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Nie wczytano ${source}`));
    document.head.append(script);
  });
}

function loadStyle(link: HTMLLinkElement) {
  return new Promise<HTMLLinkElement>((resolve, reject) => {
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`Nie wczytano ${link.href}`));
    document.head.append(link);
  });
}

/** Główny adres używa tego samego dokumentu Przekroju co /nowy/, z jego własnymi stylami i skryptami. */
export async function mountPortal() {
  const portalUrl = new URL('nowy/index.html', document.baseURI);
  const response = await fetch(portalUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const portal = new DOMParser().parseFromString(await response.text(), 'text/html');
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
  const originalTheme = document.documentElement.dataset.theme;
  const styles = [...portal.querySelectorAll('link[rel="stylesheet"]')].map((source) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = resolve(source.getAttribute('href')!);
    return link;
  });
  const HQ = { portalBase: portalUrl.href, readyQueue: [] as Array<() => void> };
  Object.assign(window, { HQ });
  try {
    await Promise.all(styles.map(loadStyle));
    if (new URLSearchParams(location.search).get('ziarno') === '1') document.documentElement.dataset.grain = '1';
    document.documentElement.dataset.palette = 'zorza';
    document.body.replaceWith(portal.body);
    for (const script of portal.querySelectorAll('script[src]')) {
      await loadScript(resolve(script.getAttribute('src')!));
    }
    for (const run of HQ.readyQueue) run();
    const anchor = location.hash.slice(1);
    if (anchor && anchor !== 'start') document.getElementById(anchor)?.scrollIntoView();
  } catch (error) {
    document.body.replaceWith(originalBody);
    document.documentElement.dataset.theme = originalTheme;
    styles.forEach((link) => link.remove());
    throw error;
  }
}
