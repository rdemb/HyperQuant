/**
 * Świeżość niezależnej weryfikacji dziennika (GitHub Actions w repo danych, `health/verify/latest.json`). Przebieg
 * idzie co najmniej raz na dobę; wynik starszy niż 36 h znaczy, że weryfikacja nie kończy się albo nie startuje —
 * wtedy nadzór danych zgłasza problem, znaczek jest czerwony, a strona pokazuje ostrzeżenie. Jeden próg dla wszystkich.
 */
export const VERIFY_MAX_AGE_MS = 36 * 3_600_000;

/** Czy wynik z chwili `at` jest nieaktualny w chwili `nowMs` (dokładnie 36 h — jeszcze aktualny). */
export const verifyStale = (at: number, nowMs: number): boolean => !(nowMs - at <= VERIFY_MAX_AGE_MS);
