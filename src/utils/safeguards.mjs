// @ts-check
/**
 * Bezpieczniki treści wspólne dla walidatora bloga (scripts/blog/posts.mjs, docs/BLOG.md „Safeguards”) i strony (tytuł
 * Klatki). Każdy wzorzec ma rodzaj, powód po polsku (komunikat walidatora bloga) i po angielsku (interfejs EN).
 * Czysty JavaScript bez importów (typy w JSDoc): blog sprawdza się i buduje także poza CI, na Node bez obsługi TS.
 * Granice słów przez \p{L}, bo \b w JS nie zna polskich liter. Każdy wzorzec dopasowuje się w czasie liniowym w długości
 * tekstu: bez dwóch sąsiednich kwantyfikatorów nad tymi samymi znakami (np. `\s*[:=]?\s*`) i z początkiem ciągu znaków
 * przez lookbehind tam, gdzie wzorzec zaczyna się od długiego ciągu (e-mail).
 */

/** @typedef {'privacy' | 'advice' | 'style'} GuardKind */

/**
 * @typedef {object} Guard
 * @property {RegExp} re
 * @property {string} why Powód po polsku (komunikat walidatora bloga).
 * @property {string} en Powód po angielsku.
 * @property {GuardKind} kind
 */

/**
 * @typedef {object} GuardHit
 * @property {Guard} guard
 * @property {string} fragment Dopasowanie z kontekstem (do 25 znaków z każdej strony), białe znaki jako spacje.
 */

/** @param {string} alts */
const word = (alts) => new RegExp(`(?<![\\p{L}\\d])(?:${alts})(?![\\p{L}\\d])`, 'iu');

/** @type {Pick<Guard, 'why' | 'en' | 'kind'>} */
const CALL = { why: 'wezwanie do transakcji', en: 'a call to trade', kind: 'advice' };

/**
 * Bezpieczniki bloga w kolejności komunikatów walidatora.
 * @type {readonly Guard[]}
 */
export const GUARDS = [
  // Prywatność: nic, co identyfikuje portfel, transakcję, serwer albo dostęp
  { re: /0x[0-9a-f]{40,}/i, why: 'adres portfela lub hash transakcji', en: 'a wallet address or transaction hash', kind: 'privacy' },
  { re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/, why: 'adres IP', en: 'an IP address', kind: 'privacy' },
  // Tylko od początku ciągu znaków lokalnej części: te same trafienia (dopasowanie najbardziej z lewej i tak zaczyna się tam)
  { re: /(?<![\w.+-])[\w.+-]+@[\w-]+\.[a-z]{2,}/i, why: 'adres e-mail', en: 'an e-mail address', kind: 'privacy' },
  {
    re: /\d{8,10}:[A-Za-z0-9_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}/,
    why: 'token lub klucz dostępu',
    en: 'a token or access key',
    kind: 'privacy',
  },
  // Analiza, nie sygnały: bez trybu rozkazującego kup/sprzedaj i bez gotowych wejść
  { re: word('kup|kupuj|kupcie|kupujcie|sprzedaj|sprzedawaj|sprzedajcie|shortuj|shortujcie|longuj|longujcie'), ...CALL },
  {
    re: word('(?:wejdź|wejdźcie|wchodź|wchodźcie|otwórz|otwórzcie|otwieraj|zajmij|zajmijcie|zamknij|zamykaj)\\s+(?:w\\s+)?(?:long\\p{L}*|short\\p{L}*|pozycj\\p{L}*)'),
    ...CALL,
  },
  { re: /(?<![\p{L}])(?:long|short)\s+(?:od|z|przy|po)\s+\d/iu, why: 'gotowe wejście (long/short od ceny)', en: 'a ready-made entry (long/short from a price)', kind: 'advice' },
  // „\s*(?:[:=]\s*)?” to ten sam język co „\s*[:=]?\s*”, bez dwóch \s* do podziału jednego ciągu spacji
  { re: /(?<![\p{L}])(?:TP|SL|take[ -]profit|stop[ -]loss)\s*(?:[:=]\s*)?\d/iu, why: 'poziom TP/SL', en: 'a TP/SL level', kind: 'advice' },
  // Styl: bez myślników i strzałek
  { re: /—|\s–\s/, why: 'myślnik', en: 'a dash', kind: 'style' },
  { re: /[→←⇒⇐➜➔↑↓]/, why: 'strzałka', en: 'an arrow', kind: 'style' },
];

/**
 * Bezpieczniki tytułu Klatki: prywatność i rady z bloga (bez reguł stylu — „—” to tam brak liczby) oraz rady, których
 * blog nie potrzebuje: angielski tryb rozkazujący (interfejs EN) i skrót wejścia bez przyimka („long 80 500”, „short @ 82000”).
 * @type {readonly Guard[]}
 */
export const TITLE_GUARDS = [
  ...GUARDS.filter((g) => g.kind !== 'style'),
  // buy/sell jako polecenie: przed słowem, które czyni z nich polecenie, albo na końcu zdania („Buy the dip”, „Sell now”);
  // „buy volume”, „buyers”, „buy-side” to opis
  {
    re: /(?<![\p{L}\d-])(?:buy|sell)(?![\p{L}\d-])(?=\s*(?:$|[.!?,;:]|(?:now|here|this|that|the|it|at|above|below|under|over|into|some|more|\d)(?![\p{L}])))/iu,
    ...CALL,
  },
  { re: word('(?:go|get|going)\\s+(?:long|short)'), ...CALL },
  { re: word('(?:enter|open|take|close)\\s+(?:an?\\s+|the\\s+|your\\s+)?(?:long|short|position)s?'), ...CALL },
  { re: word('(?:long|short)\\s+(?:here|now|tu|tutaj|teraz)'), ...CALL },
  {
    // Jak TP/SL: przyimek z własnymi spacjami za nim, bez dwóch \s* nad tym samym ciągiem
    re: /(?<![\p{L}])(?:long|short)\s*(?:(?:@|from|at|above|below|near)\s*)?\d/iu,
    why: 'gotowe wejście (long/short przy cenie)',
    en: 'a ready-made entry (long/short at a price)',
    kind: 'advice',
  },
];

/**
 * Trafienia wzorców `guards` w tekście: najwyżej jedno na wzorzec, w kolejności listy.
 * @param {string} text
 * @param {readonly Guard[]} [guards]
 * @returns {GuardHit[]}
 */
export function guardHits(text, guards = GUARDS) {
  /** @type {GuardHit[]} */
  const out = [];
  for (const g of guards) {
    const m = g.re.exec(text);
    if (!m) continue;
    const from = Math.max(0, m.index - 25);
    out.push({ guard: g, fragment: text.slice(from, m.index + m[0].length + 25).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/**
 * Wszystkie naruszenia bezpieczników w tekście (powód + fragment z kontekstem) — komunikaty walidatora bloga.
 * @param {string} text
 * @returns {string[]}
 */
export function guardViolations(text) {
  return guardHits(text).map((h) => `${h.guard.why}: „…${h.fragment}…”`);
}
