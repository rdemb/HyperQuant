/**
 * Niezależna weryfikacja dziennika: workflow `.github/workflows/ledger-verify.yml` w repo HyperQuant (harmonogram co
 * 6 h, infrastruktura GitHuba) zapisuje wynik w gałęzi `VERIFY_BRANCH` tego repo. Jeden adres dla strony, nadzoru danych,
 * strażnika i znaczka w README.
 */
export const VERIFY_BRANCH = 'weryfikacja-dziennika';
export const VERIFY_BASE = `https://raw.githubusercontent.com/rdemb/HyperQuant/${VERIFY_BRANCH}/`;
/** Podsumowanie ostatniego zakończonego przebiegu (`ok`, `at`, `run`, `commit`, `lines`) */
export const VERIFY_LATEST_URL = `${VERIFY_BASE}verify/latest.json`;
/** Znaczek shields.io (endpoint) z `badge/ledger.json` */
export const VERIFY_BADGE_URL = `https://img.shields.io/endpoint?url=${VERIFY_BASE}badge/ledger.json`;

/**
 * Świeżość wyniku: przebieg idzie co 6 h; wynik starszy niż 36 h znaczy, że weryfikacja nie kończy się albo nie
 * startuje — wtedy nadzór danych zgłasza problem, znaczek jest czerwony, a strona pokazuje ostrzeżenie. Jeden próg.
 */
export const VERIFY_MAX_AGE_MS = 36 * 3_600_000;

/** Zapas na różnicę zegarów: czas późniejszy niż „teraz” o więcej to błąd albo podróbka, nie świeży wynik */
export const CLOCK_SKEW_MS = 10 * 60_000;

/** Czy czas `t` jest z przyszłości względem `nowMs` (ponad zapas na zegar). */
export const fromFuture = (t: number, nowMs: number): boolean => t > nowMs + CLOCK_SKEW_MS;

/**
 * Czy wynik z chwili `at` jest nieaktualny w chwili `nowMs` (dokładnie 36 h — jeszcze aktualny). Czas z przyszłości
 * też jest nieaktualny — inaczej taki wynik byłby „świeży” na zawsze.
 */
export const verifyStale = (at: number, nowMs: number): boolean => fromFuture(at, nowMs) || !(nowMs - at <= VERIFY_MAX_AGE_MS);
