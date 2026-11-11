#!/usr/bin/env bash
# Instalacja / aktualizacja skanera i serwera powiadomień HyperQuant na serwerze z Ubuntu (uruchamiać jako root).
# Idempotentny: tworzy użytkownika i katalogi, instaluje Node z oficjalnego archiwum (weryfikacja SHA-256),
# pobiera kod z publicznego repo i (re)startuje usługę. Nie zawiera żadnych danych konkretnego serwera.
# Tryb podpisanych tagów (plik /etc/hyperquant/allowed_signers): TAG=<tag> bash install.sh — patrz STRAZNIK.md.
# Całość w funkcji main wywoływanej na końcu — ucięte pobranie skryptu (curl | bash) nie wykona się częściowo.
set -euo pipefail

# Katalog tymczasowy globalnie — sprzątany przy każdym wyjściu (także po błędzie)
TMP_DIR=""
trap 'if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi' EXIT

# Strażnik restartuje usługi przez regułę polkit w JavaScript (polkit 0.106 i nowszy). Bez niej tylko alarmuje,
# więc instalacja zatrzymuje się, chyba że operator zgodzi się na to jawnie (HQ_WATCHDOG_NO_POLKIT=1).
check_polkit() {
  local pk
  pk="$(pkaction --version 2>/dev/null | sed -n 's/^pkaction version //p')" || pk=""
  if [ -n "$pk" ] && printf '0.106\n%s\n' "$pk" | sort -V -C; then
    return 0
  fi
  if [ "${HQ_WATCHDOG_NO_POLKIT:-}" = "1" ]; then
    echo "UWAGA: polkit ${pk:-brak} (potrzebny 0.106 lub nowszy) — strażnik tylko alarmuje, bez restartów usług." >&2
    return 0
  fi
  echo "polkit ${pk:-brak}: strażnik potrzebuje 0.106 lub nowszego (apt-get install polkitd), żeby restartować usługi." >&2
  echo "Instalacja bez restartów (strażnik tylko alarmuje): HQ_WATCHDOG_NO_POLKIT=1 bash install.sh. Szczegóły: STRAZNIK.md." >&2
  return 1
}

# Ostatnia wartość zmiennej z pliku środowiska (bez cudzysłowów i spacji); pusto = brak.
env_value() {
  sed -n "s/^$1=//p" "$2" | tail -n 1 | tr -d "\"' "
}

main() {
  local NODE_VERSION="${NODE_VERSION:-v24.22.1}"
  local REPO_URL="${REPO_URL:-https://github.com/rdemb/HyperQuant.git}"
  local BRANCH="${BRANCH:-main}"
  local PREFIX=/opt/hyperquant
  local STATE=/var/lib/hyperquant
  # Plik zaufanych kluczy podpisu (format allowed_signers ssh): jest → tryb podpisanych tagów (instalacja z TAG=)
  local SIGNERS=/etc/hyperquant/allowed_signers
  local TAG="${TAG:-}"

  if [ "$(id -u)" -ne 0 ]; then
    echo "Uruchom jako root." >&2
    exit 1
  fi

  local arch
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *)
      echo "Nieobsługiwana architektura: $(uname -m)" >&2
      exit 1
      ;;
  esac
  # Przed jakąkolwiek zmianą na serwerze
  check_polkit || exit 1

  id hyperquant >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin hyperquant
  # Strażnik: osobny użytkownik (nie root, nie użytkownik skanera); katalog stanu tworzy systemd (StateDirectory)
  id hyperquant-watchdog >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/hyperquant-watchdog --shell /usr/sbin/nologin hyperquant-watchdog
  install -d -o root -g root -m 0755 "$PREFIX" "$PREFIX/bin" "$PREFIX/watchdog"
  install -d -o hyperquant -g hyperquant -m 0750 "$STATE" "$STATE/state" "$STATE/out"
  install -d -o root -g root -m 0700 /etc/hyperquant

  # Node z nodejs.org, sprawdzony sumą z SHASUMS256.txt; rozpakowany jako root:root (archiwum ma obcego właściciela)
  if [ ! -x "$PREFIX/node/bin/node" ] || [ "$("$PREFIX/node/bin/node" -v)" != "$NODE_VERSION" ]; then
    local file tmp
    TMP_DIR="$(mktemp -d)"
    tmp="$TMP_DIR"
    file="node-$NODE_VERSION-linux-$arch.tar.xz"
    curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
    rm -rf "$PREFIX/node.new" && mkdir -p "$PREFIX/node.new"
    tar --no-same-owner -xJf "$tmp/$file" -C "$PREFIX/node.new" --strip-components=1
    chown -R root:root "$PREFIX/node.new"
    chmod -R go-w "$PREFIX/node.new"
    rm -rf "$PREFIX/node" && mv "$PREFIX/node.new" "$PREFIX/node"
  fi

  # Kod (tylko odczyt dla usługi). Tryb gałęzi: dokładnie stan zdalnej gałęzi. Tryb podpisanych tagów: tylko
  # wskazany tag z ważnym podpisem zaufanego klucza — z niego pochodzą też kopie strażnika i skryptu aktualizacji.
  if [ -s "$SIGNERS" ]; then
    if [ -z "$TAG" ]; then
      echo "Tryb podpisanych tagów ($SIGNERS): podaj tag, np. TAG=v2.5.0 bash install.sh" >&2
      exit 1
    fi
    [ -d "$PREFIX/app/.git" ] || git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$PREFIX/app"
    git -C "$PREFIX/app" fetch --quiet --tags --force origin
    if [ "$(git -C "$PREFIX/app" for-each-ref --format='%(objecttype) %(tag)' "refs/tags/$TAG")" != "tag $TAG" ] ||
      ! git -C "$PREFIX/app" -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-tag "refs/tags/$TAG"; then
      echo "Tag $TAG nie ma ważnego podpisu zaufanego klucza — instalacja przerwana, kod bez zmian." >&2
      exit 1
    fi
    git -C "$PREFIX/app" checkout --quiet -B "$BRANCH" "refs/tags/$TAG^{commit}"
    git -C "$PREFIX/app" reset --quiet --hard
  elif [ -d "$PREFIX/app/.git" ]; then
    git -C "$PREFIX/app" fetch --quiet origin "$BRANCH"
    git -C "$PREFIX/app" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    git -C "$PREFIX/app" reset --quiet --hard "origin/$BRANCH"
  else
    git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$PREFIX/app"
  fi
  chown -R root:root "$PREFIX/app"

  # Kopie poza katalogiem aktualizowanym co 15 min (root, tylko odczyt dla usług): skrypt aktualizacji i strażnik.
  # Push do repo ich nie zmienia — tylko ponowny install.sh.
  install -o root -g root -m 0755 "$PREFIX/app/backend/deploy/hyperquant-update.sh" "$PREFIX/bin/hyperquant-update"
  install -o root -g root -m 0644 "$PREFIX/app/scripts/watchdog.mjs" "$PREFIX/app/scripts/check-data-health.mjs" "$PREFIX/watchdog/"

  # Konfiguracja z szablonu tylko przy pierwszej instalacji; sekrety R2 wpisuje właściciel.
  # systemd czyta EnvironmentFile jako root — plik należy do root i ma 0600 przy każdym uruchomieniu.
  if [ ! -f /etc/hyperquant/scanner.env ]; then
    install -m 0600 "$PREFIX/app/backend/deploy/scanner.env.example" /etc/hyperquant/scanner.env
  fi
  chown root:root /etc/hyperquant/scanner.env
  chmod 0600 /etc/hyperquant/scanner.env

  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-scanner.service" /etc/systemd/system/hyperquant-scanner.service
  # Strażnik (co 15 min, użytkownik hyperquant-watchdog, własny katalog stanu z StateDirectory): restart zawieszonego
  # skanera i alarm w gałęzi `health`
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-watchdog.service" /etc/systemd/system/hyperquant-watchdog.service
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-watchdog.timer" /etc/systemd/system/hyperquant-watchdog.timer
  # Środowisko strażnika: tylko zmienne, które czyta (repo danych, katalogi usług), wyprowadzane z pliku skanera przy
  # każdej instalacji — bez sekretów R2 i reszty konfiguracji skanera
  local var val
  {
    echo "# Tworzony przez install.sh z /etc/hyperquant/scanner.env — zmiany tam i ponowny install.sh"
    for var in HQ_GIT_REMOTE HQ_OUT_DIR HQ_STATE_DIR; do
      val="$(env_value "$var" /etc/hyperquant/scanner.env)"
      if [ -n "$val" ]; then printf '%s=%s\n' "$var" "$val"; fi
    done
  } >/etc/hyperquant/watchdog.env.tmp
  install -o root -g root -m 0600 /etc/hyperquant/watchdog.env.tmp /etc/hyperquant/watchdog.env
  rm -f /etc/hyperquant/watchdog.env.tmp
  # Klucz wdrożeniowy repo danych dla strażnika: systemd czyta plik skanera i podaje kopię tylko strażnikowi
  # (LoadCredential); bez klucza drop-in znika (strażnik bez alarmów w repo danych, samonaprawa działa)
  local key dropin=/etc/systemd/system/hyperquant-watchdog.service.d
  key="$(env_value HQ_GIT_SSH_KEY /etc/hyperquant/scanner.env)"
  if [ -n "$key" ] && [ -f "$key" ]; then
    if ! printf '%s' "$key" | grep -Eq '^/[A-Za-z0-9._/-]+$'; then
      echo "HQ_GIT_SSH_KEY: ścieżka bezwzględna bez spacji i znaków specjalnych, a jest: $key" >&2
      exit 1
    fi
    install -d -o root -g root -m 0755 "$dropin"
    printf '[Service]\nLoadCredential=deploy_key:%s\n' "$key" >"$dropin/deploy-key.conf"
    chmod 0644 "$dropin/deploy-key.conf"
  else
    rm -f "$dropin/deploy-key.conf"
  fi
  # Restart dwóch usług bez root: reguła polkit (tylko restart skanera i serwera powiadomień)
  # (katalog pakietu polkit zostaje z jego prawami; bez polkit reguła czeka na jego instalację)
  [ -d /etc/polkit-1/rules.d ] || install -d -o root -g root -m 0755 /etc/polkit-1/rules.d
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-watchdog.rules" /etc/polkit-1/rules.d/50-hyperquant-watchdog.rules
  # Dawny stan strażnika (gdy działał jako root) przechodzi na jego użytkownika; systemd robi to też sam przy starcie
  if [ -d /var/lib/hyperquant-watchdog ]; then
    chown -R hyperquant-watchdog:hyperquant-watchdog /var/lib/hyperquant-watchdog
  fi
  # Aktualizacja (co 15 min, root, skrypt z $PREFIX/bin): gałąź zdalna albo podpisane tagi, restart tylko po zmianie
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-update.service" /etc/systemd/system/hyperquant-update.service
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-update.timer" /etc/systemd/system/hyperquant-update.timer
  # Serwer powiadomień o alarmach (Web Push): klucze tworzy sam przy pierwszym starcie w $STATE/state
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-alerts.service" /etc/systemd/system/hyperquant-alerts.service
  systemctl daemon-reload
  systemctl enable --quiet hyperquant-scanner
  systemctl restart hyperquant-scanner
  systemctl enable --quiet hyperquant-alerts
  systemctl restart hyperquant-alerts
  systemctl enable --now --quiet hyperquant-watchdog.timer
  systemctl enable --now --quiet hyperquant-update.timer
  systemctl --no-pager --lines=5 status hyperquant-scanner || true
  systemctl --no-pager --lines=5 status hyperquant-alerts || true
}

main "$@"
