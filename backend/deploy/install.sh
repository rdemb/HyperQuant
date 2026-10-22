#!/usr/bin/env bash
# Instalacja / aktualizacja skanera HyperQuant na serwerze z Ubuntu (uruchamiać jako root).
# Idempotentny: tworzy użytkownika i katalogi, instaluje Node z oficjalnego archiwum (weryfikacja SHA-256),
# pobiera kod z publicznego repo i (re)startuje usługę. Nie zawiera żadnych danych konkretnego serwera.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.22.1}"
REPO_URL="${REPO_URL:-https://github.com/rdemb/HyperQuant.git}"
BRANCH="${BRANCH:-main}"
PREFIX=/opt/hyperquant
STATE=/var/lib/hyperquant

id hyperquant >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin hyperquant
install -d -o root -g root -m 0755 "$PREFIX"
install -d -o hyperquant -g hyperquant -m 0750 "$STATE" "$STATE/state" "$STATE/out"
install -d -o root -g hyperquant -m 0750 /etc/hyperquant

# Node z nodejs.org, sprawdzony sumą z SHASUMS256.txt
if [ ! -x "$PREFIX/node/bin/node" ] || [ "$("$PREFIX/node/bin/node" -v)" != "$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  file="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$PREFIX/node.new" && mkdir -p "$PREFIX/node.new"
  tar -xJf "$tmp/$file" -C "$PREFIX/node.new" --strip-components=1
  rm -rf "$PREFIX/node" && mv "$PREFIX/node.new" "$PREFIX/node"
  rm -rf "$tmp"
fi

# Kod (tylko odczyt dla usługi)
if [ -d "$PREFIX/app/.git" ]; then
  git -C "$PREFIX/app" fetch --quiet origin "$BRANCH"
  git -C "$PREFIX/app" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$PREFIX/app"
fi

# Konfiguracja tylko z szablonu, jeśli jeszcze jej nie ma (sekrety R2 wpisuje właściciel)
if [ ! -f /etc/hyperquant/scanner.env ]; then
  install -o root -g hyperquant -m 0640 "$PREFIX/app/backend/deploy/scanner.env.example" /etc/hyperquant/scanner.env
fi

install -o root -g root -m 0644 "$PREFIX/app/backend/deploy/hyperquant-scanner.service" /etc/systemd/system/hyperquant-scanner.service
systemctl daemon-reload
systemctl enable --quiet hyperquant-scanner
systemctl restart hyperquant-scanner
systemctl --no-pager --lines=5 status hyperquant-scanner || true
