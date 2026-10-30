-- Skrzynka alarmów HyperQuant (Cloudflare D1). Wykonywane przy każdym wdrożeniu: tylko IF NOT EXISTS / OR IGNORE.

-- Urządzenie z włączonymi powiadomieniami 24/7: adres i klucze subskrypcji push, język, alarmy (JSON).
-- `token` to SHA-256 tokenu urządzenia (sam token zna tylko przeglądarka). `version` rośnie przy każdej zmianie,
-- serwer powiadomień pobiera tylko zmienione wiersze. Usunięte urządzenie zostaje na 2 dni jako pusty wiersz `deleted`,
-- żeby serwer zdążył je wypisać. `seen` — ostatni kontakt przeglądarki (albo chwila usunięcia).
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lang TEXT NOT NULL,
  rules TEXT NOT NULL,
  seen INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_version ON devices (version, id);
CREATE INDEX IF NOT EXISTS devices_endpoint ON devices (endpoint);

-- Zdarzenia z serwera (7 dni): uruchomienie, wygaśnięcie, anulowanie (historia w przeglądarce) i start alarmu z łańcucha.
CREATE TABLE IF NOT EXISTS events (
  device TEXT NOT NULL,
  rule TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_device ON events (device, at);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('version', 0);
-- Losowa sól skrótów limitu rejestracji (raz, przy pierwszym wdrożeniu; nie opuszcza bazy; 53 bity, liczba całkowita JS)
INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', abs(random() % 9007199254740991));

-- Limit rejestracji z jednego adresu: `k` = skrót (sól, adres IP, godzina), bez samego adresu; wiersze starsze niż
-- 2 h znikają przy kolejnej rejestracji, najpóźniej przy codziennym sprzątaniu.
CREATE TABLE IF NOT EXISTS regs (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  at INTEGER NOT NULL
);

-- Urządzenia bez pierwszej synchronizacji z przeglądarki (PUT po rejestracji); bez niej znikają po 7 dniach.
CREATE TABLE IF NOT EXISTS fresh (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
