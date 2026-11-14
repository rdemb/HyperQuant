/**
 * Uczciwość liczb w pustym stanie: widok nowego wyglądu bez danych pokazuje „—” z powodem, nie wartości.
 * Zasada odwrócona (bez heurystyki i bez listy stałych makiety): elementy z liczbą, która jest etykietą, a nie wartością
 * („Obrót 24 h”, „Paliwo ±1%”, numer kroku, zegar), mają atrybut `data-etykieta`. Test usuwa ich tekst, a w reszcie
 * tekstu widoku nie może być żadnej cyfry ani NaN / Infinity. Używane przez `ui:check` (przebieg „Pusty stan”).
 */

/** Fragmenty z cyfrą (z otoczeniem do komunikatu) albo NaN / Infinity; pusta lista = w porządku. */
export function cyfryPozaEtykietami(tekst) {
  const out = [];
  if (/\b(?:NaN|Infinity)\b/.test(tekst)) out.push('NaN/Infinity');
  for (const m of tekst.matchAll(/.{0,14}\d.{0,14}/g)) out.push(m[0].replace(/\s+/g, ' ').trim());
  return [...new Set(out)].slice(0, 10);
}

/**
 * Pomiar pustego stanu w stronie (wynik: { tekst, paski, dlugieEtykiety } albo null bez [data-view-root]):
 * - tekst: klon [data-view-root] bez [data-etykieta], skryptów i stylów, razem z wartościami atrybutów, które niosą
 *   liczby poza treścią (aria-valuenow, aria-valuetext, aria-label, title, value);
 * - paski: elementy poza [data-etykieta] z wymiarem w procentach > 0 w stylu inline (wartość narysowana szerokością);
 * - dlugieEtykiety: elementy [data-etykieta] dłuższe niż 40 znaków z cyframi (do raportu dla recenzenta).
 */
export const POMIAR_PUSTEGO = `(() => {
  const r = document.querySelector('[data-view-root]');
  if (!r) return null;
  const etykieta = (e) => !!e.closest('[data-etykieta]');
  const paski = [...r.querySelectorAll('[style]')]
    .filter((e) => !etykieta(e))
    .map((e) => e.getAttribute('style') || '')
    .filter((st) => /(?:^|;|\\s)(?:width|height|inline-size|block-size)\\s*:\\s*(?:calc\\()?\\s*0*[1-9][\\d.]*\\s*%/.test(st) || /(?:^|;|\\s)(?:width|height)\\s*:\\s*0*\\.\\d*[1-9]\\d*\\s*%/.test(st))
    .slice(0, 10);
  const dlugieEtykiety = [...r.querySelectorAll('[data-etykieta]')]
    .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
    .filter((t) => t.length > 40 && /\\d/.test(t))
    .map((t) => t.slice(0, 80));
  const c = r.cloneNode(true);
  c.querySelectorAll('[data-etykieta], script, style').forEach((e) => e.remove());
  const atrybuty = [...c.querySelectorAll('[aria-valuenow], [aria-valuetext], [aria-label], [title], [value]')]
    .map((e) => ['aria-valuenow', 'aria-valuetext', 'aria-label', 'title', 'value'].map((a) => e.getAttribute(a) || '').join(' '))
    .join(' ');
  return { tekst: (c.textContent || '') + ' ' + atrybuty, paski, dlugieEtykiety };
})()`;

/**
 * Klucze rejestru NOWE_WIDOKI z treści src/nowy/widoki.ts (widoki w nowym wyglądzie). Liczba `import(` w bloku musi się
 * równać liczbie kluczy: inny zapis klucza nie może cicho wypaść z testu.
 */
export function noweWidoki(zrodlo) {
  const blok = (zrodlo.match(/NOWE_WIDOKI[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const klucze = [...blok.matchAll(/^\s*['"]?([a-z]+)['"]?\s*:/gm)].map((m) => m[1]);
  const importy = (blok.match(/import\(/g) ?? []).length;
  if (importy !== klucze.length) throw new Error(`src/nowy/widoki.ts: ${importy} import() wobec ${klucze.length} odczytanych kluczy (${klucze.join(', ')})`);
  return klucze;
}

/** Gniazdo bez danych (przebieg „Pusty stan”): połączenie od razu kończy się błędem, nic nie przychodzi. */
export const MARTWE_GNIAZDO = `(() => {
  class MartweGniazdo extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 3;
        const err = new Event('error');
        this.onerror?.(err);
        this.dispatchEvent(err);
        const close = new CloseEvent('close', { code: 1006 });
        this.onclose?.(close);
        this.dispatchEvent(close);
      }, 0);
    }
    send() {}
    close() {}
  }
  MartweGniazdo.CONNECTING = 0;
  MartweGniazdo.OPEN = 1;
  MartweGniazdo.CLOSING = 2;
  MartweGniazdo.CLOSED = 3;
  window.WebSocket = MartweGniazdo;
})();`;

/** Pliki aplikacji z tej samej strony, które przechodzą w pustym stanie (reszta, np. lekcje i powtórki, to dane). */
export const PLIKI_APLIKACJI = /^\/(?:$|index\.html$|assets\/|fonts\/|sw\.js|manifest|icons\/|favicon|robots\.txt)/;
