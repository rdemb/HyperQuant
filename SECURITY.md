# Bezpieczeństwo

HyperQuant to statyczna strona (GitHub Pages) korzystająca wyłącznie z publicznych API. Nie przechowuje kluczy, haseł ani danych użytkowników po stronie serwera — plany, dziennik i ustawienia są tylko w `localStorage` przeglądarki.

## Zgłaszanie podatności

Nie zgłaszaj podatności w publicznych issue. Użyj prywatnego zgłoszenia na GitHubie: zakładka **Security → Report a vulnerability** w repozytorium [rdemb/HyperQuant](https://github.com/rdemb/HyperQuant/security/advisories/new).

Opisz, co i gdzie (plik, widok, adres), jak odtworzyć problem i jaki może mieć skutek. Odpowiedź w ciągu kilku dni roboczych.

## Zakres

- kod w tym repozytorium i strona https://rdemb.github.io/HyperQuant/,
- workflow GitHub Actions i pobieranie danych publicznych (`scripts/fetch-public-data.mjs`).

Poza zakresem: dostępność i dane zewnętrznych API (Hyperliquid, giełdy, źródła publiczne).
