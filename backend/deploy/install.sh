#!/usr/bin/env bash
# Instalacja / aktualizacja skanera HyperQuant na serwerze z Ubuntu (uruchamiać jako root).
# Idempotentny: tworzy użytkownika i katalogi, instaluje Node z oficjalnego archiwum (weryfikacja SHA-256),
# pobiera kod z publicznego repo i (re)startuje usługę. Nie zawiera żadnych danych konkretnego serwera.
# Całość w funkcji main wywoływanej na końcu — ucięte pobranie skryptu (curl | bash) nie wykona się częściowo.
set -euo pipefail

# Katalog tymczasowy globalnie — sprzątany przy każdym wyjściu (także po błędzie)
TMP_DIR=""
trap 'if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi' EXIT

main() {
  local NODE_VERSION="${NODE_VERSION:-v24.22.1}"
  local REPO_URL="${REPO_URL:-https://github.com/rdemb/HyperQuant.git}"
  local BRANCH="${BRANCH:-main}"
  local PREFIX=/opt/hyperquant
  local STATE=/var/lib/hyperquant

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

  id hyperquant >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin hyperquant
  install -d -o root -g root -m 0755 "$PREFIX"
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

  # Kod (tylko odczyt dla usługi); aktualizacja zawsze dokładnie do stanu zdalnej gałęzi
  if [ -d "$PREFIX/app/.git" ]; then
    git -C "$PREFIX/app" fetch --quiet origin "$BRANCH"
    git -C "$PREFIX/app" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    git -C "$PREFIX/app" reset --quiet --hard "origin/$BRANCH"
  else
    git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$PREFIX/app"
  fi
  chown -R root:root "$PREFIX/app"

  # Konfiguracja z szablonu tylko przy pierwszej instalacji; sekrety R2 wpisuje właściciel.
  # systemd czyta EnvironmentFile jako root — plik należy do root i ma 0600 przy każdym uruchomieniu.
  if [ ! -f /etc/hyperquant/scanner.env ]; then
    install -m 0600 "$PREFIX/app/backend/deploy/scanner.env.example" /etc/hyperquant/scanner.env
  fi
  chown root:root /etc/hyperquant/scanner.env
  chmod 0600 /etc/hyperquant/scanner.env

  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-scanner.service" /etc/systemd/system/hyperquant-scanner.service
  # Strażnik (co 15 min, root, własny katalog stanu z StateDirectory): restart zawieszonego skanera i alarm w gałęzi `health`
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-watchdog.service" /etc/systemd/system/hyperquant-watchdog.service
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-watchdog.timer" /etc/systemd/system/hyperquant-watchdog.timer
  # Aktualizacja (co 15 min, root): kod do stanu gałęzi zdalnej i restart skanera tylko po zmianie
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-update.service" /etc/systemd/system/hyperquant-update.service
  install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-update.timer" /etc/systemd/system/hyperquant-update.timer
  systemctl daemon-reload
  systemctl enable --quiet hyperquant-scanner
  systemctl restart hyperquant-scanner
  systemctl enable --now --quiet hyperquant-watchdog.timer
  systemctl enable --now --quiet hyperquant-update.timer
  systemctl --no-pager --lines=5 status hyperquant-scanner || true
}

main "$@"
