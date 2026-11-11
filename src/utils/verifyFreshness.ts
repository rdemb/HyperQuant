/**
 * Świeżość niezależnej weryfikacji dziennika (GitHub Actions w repo danych, `health/verify/latest.json`). Przebieg
 * idzie co najmniej raz na dobę; wynik starszy niż 36 h znaczy, że weryfikacja nie kończy się albo nie startuje —
 * wtedy nadzór danych zgłasza problem, znaczek jest czerwony, a strona pokazuje ostrzeżenie. Jeden próg dla wszystkich.
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
