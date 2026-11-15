import { layout } from './render.mjs';

/**
 * Strona „Prywatność” (prywatnosc/, en/privacy/): zasada „bez kont i bez danych o ludziach”, co zostaje na urządzeniu,
 * z kim łączy się przeglądarka, alarmy 24/7 (Web Push przez skrzynkę Cloudflare) i tematy publiczne 24/7 (nasz serwer
 * ntfy: widzi technicznie adres IP subskrybenta, nie zapisuje go; bez przekazywania do ntfy.sh, więc na iOS opóźnienie).
 */

export const PRIVACY_PATHS = { pl: 'prywatnosc/', en: 'en/privacy/' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const T = {
  pl: {
    title: 'Prywatność · HyperQuant',
    h1: 'Prywatność',
    lead: 'HyperQuant nie ma kont i nie zbiera danych o ludziach. Zapisujemy tylko techniczne minimum potrzebne funkcji, którą sam włączysz, i kasujemy je automatycznie.',
    sections: [
      ['Na Twoim urządzeniu', 'Ustawienia, układy wykresów, alarmy, strażnicy wyspy i ich dziennik zapisują się w pamięci przeglądarki (localStorage) na tym urządzeniu. Nie wysyłamy ich nigdzie. Nie używamy plików cookie ani narzędzi analityki.'],
      ['Z kim łączy się przeglądarka', 'Stronę hostuje GitHub Pages. Dane rynku przeglądarka pobiera bezpośrednio z publicznego API Hyperliquid, a pliki danych HyperQuant z GitHuba. Strumienie Binance, Bybit, OKX i Coinbase są wyłączone, dopóki ich nie włączysz w ustawieniach. Niektóre panele pobierają publiczne dane z innych serwisów (pełna lista w zakładce Źródła). Każdy z tych serwisów widzi adres IP przeglądarki, jak przy każdej stronie internetowej.'],
      ['Alarmy 24/7 (powiadomienia push)', 'Po włączeniu „Powiadomień 24/7” skrzynka HyperQuant (Cloudflare) przechowuje adres usługi push Twojej przeglądarki, klucze szyfrowania, do 30 alarmów, język i zdarzenia z 7 dni. Urządzenie to losowy identyfikator, bez konta, e-maila i adresu IP. Wyłączenie przełącznika usuwa urządzenie; nieużywane 30 dni znika samo. Limit rejestracji liczy tylko skrót adresu z solą, kasowany po 2 godzinach.'],
      ['Tematy publiczne 24/7 (ntfy)', 'Tematy publiczne to powiadomienia o stanie rynku BTC (np. przecięcie wczorajszego szczytu albo otwarcie sesji), wysyłane z naszego serwera ntfy. Subskrybujesz je w aplikacji ntfy albo w przeglądarce, bez konta. Nasz serwer technicznie widzi adres IP subskrybenta, bo bez tego nie da się dostarczyć powiadomienia, ale go nie zapisuje: serwer i proxy nie prowadzą dziennika dostępu, a adres służy tylko do limitu zapytań w pamięci. Wiadomości są przechowywane najwyżej godzinę, żeby telefon bez sieci mógł je odebrać. Nie przekazujemy niczego do ntfy.sh, dlatego na iOS powiadomienia z naszego serwera mogą przychodzić z opóźnieniem; na Androidzie i w przeglądarce przychodzą od razu. Nazwy tematów podamy po uruchomieniu serwera.'],
      ['Serwer MCP i agenci AI', 'Serwer MCP HyperQuant działa na Twoim komputerze i czyta tylko dane publiczne. Nie widzimy Twoich pytań ani odpowiedzi agenta.'],
      ['Kontakt', 'Kod strony i serwera jest otwarty: github.com/rdemb/HyperQuant. Pytania i zgłoszenia przez zgłoszenia (issues) w repozytorium.'],
    ],
  },
  en: {
    title: 'Privacy · HyperQuant',
    h1: 'Privacy',
    lead: 'HyperQuant has no accounts and does not collect data about people. We keep only the technical minimum a feature you turn on needs, and delete it automatically.',
    sections: [
      ['On your device', 'Settings, chart layouts, alerts, the island guards and their log are saved in the browser storage (localStorage) on this device. We do not send them anywhere. We use no cookies and no analytics.'],
      ['Who your browser connects to', 'The site is hosted on GitHub Pages. The browser fetches market data directly from the public Hyperliquid API and the HyperQuant data files from GitHub. The Binance, Bybit, OKX and Coinbase streams stay off until you turn them on in settings. Some panels fetch public data from other services (the full list is in the Sources tab). Each of these services sees the browser’s IP address, as with any website.'],
      ['24/7 alerts (push notifications)', 'When you turn on “24/7 notifications”, the HyperQuant mailbox (Cloudflare) stores your browser’s push service address, encryption keys, up to 30 alerts, the language and events from 7 days. A device is a random identifier, with no account, email or IP address. Turning the switch off deletes the device; one unused for 30 days disappears on its own. The registration limit counts only a salted hash of the address, deleted after 2 hours.'],
      ['Public 24/7 topics (ntfy)', 'Public topics are notifications about the BTC market state (for example a cross of yesterday’s high or a session open) sent from our ntfy server. You subscribe in the ntfy app or in a browser, without an account. Our server technically sees the subscriber’s IP address, because a notification cannot be delivered without it, but does not store it: the server and the proxy keep no access log, and the address is used only for an in-memory request limit. Messages are kept for at most one hour so a phone without network can still receive them. We pass nothing to ntfy.sh, so on iOS notifications from our server may arrive late; on Android and in a browser they arrive at once. We will publish the topic names once the server is running.'],
      ['MCP server and AI agents', 'The HyperQuant MCP server runs on your computer and reads public data only. We do not see your questions or your agent’s answers.'],
      ['Contact', 'The site and server code is open: github.com/rdemb/HyperQuant. Questions and reports through issues in the repository.'],
    ],
  },
};

/** `disclaimer` — wspólne zastrzeżenie stron serwisu (pages.mjs, footSite). */
export function privacyPage(site, lang, disclaimer) {
  const t = T[lang];
  const path = PRIVACY_PATHS[lang];
  const root = '../'.repeat(path.split('/').filter(Boolean).length);
  const main = `<article class="page page--privacy">
<h1>${esc(t.h1)}</h1>
<p class="lead">${esc(t.lead)}</p>
${t.sections.map(([h, p]) => `<section><h2>${esc(h)}</h2><p>${esc(p)}</p></section>`).join('\n')}
</article>`;
  return {
    path,
    lang,
    alternates: Object.entries(PRIVACY_PATHS).map(([l, p]) => ({ lang: l, url: `${site.url}${p}` })),
    html: layout(site, {
      title: t.title,
      description: t.lead,
      url: `${site.url}${path}`,
      root,
      image: `${site.url}og.png`,
      imageAlt: `HyperQuant: ${t.h1}`,
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: t.title, inLanguage: lang },
      main,
      lang,
      current: null,
      alternates: Object.entries(PRIVACY_PATHS).map(([l, p]) => ({ lang: l, url: `${site.url}${p}` })),
      disclaimer,
    }),
  };
}
