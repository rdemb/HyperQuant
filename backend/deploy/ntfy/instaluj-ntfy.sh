#!/usr/bin/env bash
# Serwer ntfy HyperQuant na VPS: ntfy (oficjalne repozytorium apt), Caddy (HTTPS, Let's Encrypt), wydawca z tokenem,
# usługa hyperquant-tematy (z HQ_TOPICS=0 — próba na sucho, nic nie publikuje). Na końcu autotest.
#
# Użycie (root, po wdrożeniu kodu podpisanym tagiem i po rekordzie DNS A domeny na adres VPS):
#   bash /opt/hyperquant/app/backend/deploy/ntfy/instaluj-ntfy.sh ntfy.hyperquant.tech
# Ponowne uruchomienie jest bezpieczne: istniejący token zostaje, pliki konfiguracji są nadpisywane wzorcem z repo.
# Cofnięcie: HQ_TOPICS=0 w /etc/hyperquant/topics.env, `systemctl disable --now hyperquant-tematy ntfy caddy`.
# Token wydawcy trafia tylko do /etc/hyperquant/topics.env (root 0600); skrypt go nie wypisuje.
set -euo pipefail

DOMENA="${1:-}"
[[ "$DOMENA" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Podaj domenę, np. ntfy.hyperquant.tech" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "Uruchom jako root" >&2; exit 2; }
APP=/opt/hyperquant/app
SRC="$APP/backend/deploy"
ENVF=/etc/hyperquant/topics.env
ARCH="$(dpkg --print-architecture)"

echo "1/6 ntfy z repozytorium archive.ntfy.sh ($ARCH)"
mkdir -p /etc/apt/keyrings
[ -s /etc/apt/keyrings/ntfy.gpg ] || curl -fsSL -o /etc/apt/keyrings/ntfy.gpg https://archive.ntfy.sh/apt/keyring.gpg
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/ntfy.gpg] https://archive.ntfy.sh/apt stable main" >/etc/apt/sources.list.d/ntfy.list

echo "2/6 Caddy z repozytorium Caddy (Cloudsmith)"
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
[ -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ] || curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq ntfy caddy >/dev/null

echo "3/6 konfiguracja (domena $DOMENA)"
mkdir -p /etc/ntfy /var/lib/ntfy /var/cache/ntfy
sed "s/__DOMENA__/$DOMENA/g" "$SRC/ntfy/server.yml" >/etc/ntfy/server.yml
sed "s/__DOMENA__/$DOMENA/g" "$SRC/ntfy/Caddyfile" >/etc/caddy/Caddyfile
chown -R ntfy:ntfy /var/lib/ntfy /var/cache/ntfy 2>/dev/null || true
systemctl enable --now ntfy >/dev/null
systemctl restart ntfy
sleep 2

echo "4/6 wydawca hq-wydawca (tylko zapis tematów hq-*) i token"
if ! ntfy user list 2>/dev/null | grep -q '^user hq-wydawca'; then
  NTFY_PASSWORD="$(openssl rand -hex 24)" ntfy user add hq-wydawca >/dev/null
fi
ntfy access hq-wydawca 'hq-*' write-only >/dev/null
umask 077
touch "$ENVF"
if ! grep -q '^HQ_NTFY_TOKEN=tk_' "$ENVF"; then
  TOKEN="$(ntfy token add --label=hyperquant-tematy hq-wydawca 2>&1 | grep -o 'tk_[a-z0-9]*' | head -1)"
  [ -n "$TOKEN" ] || { echo "Nie udało się utworzyć tokenu" >&2; exit 1; }
  grep -v '^HQ_NTFY_TOKEN=' "$ENVF" >"$ENVF.tmp" || true
  printf 'HQ_NTFY_TOKEN=%s\n' "$TOKEN" >>"$ENVF.tmp"
  mv "$ENVF.tmp" "$ENVF"
  unset TOKEN
fi
grep -q '^HQ_NTFY_URL=' "$ENVF" || echo 'HQ_NTFY_URL=http://127.0.0.1:2586' >>"$ENVF"
grep -q '^HQ_TOPIC_PREFIX=' "$ENVF" || echo 'HQ_TOPIC_PREFIX=hq-btc' >>"$ENVF"
grep -q '^HQ_TOPICS=' "$ENVF" || echo 'HQ_TOPICS=0' >>"$ENVF"
chown root:root "$ENVF"
chmod 0600 "$ENVF"

echo "5/6 zapora (porty 80 i 443 dla Caddy, jeśli ufw jest włączony), Caddy, usługa tematów"
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
systemctl enable --now caddy >/dev/null
systemctl reload caddy || systemctl restart caddy
install -m 0644 "$SRC/hyperquant-tematy.service" /etc/systemd/system/hyperquant-tematy.service
systemctl daemon-reload
systemctl enable --now hyperquant-tematy >/dev/null
systemctl restart hyperquant-tematy
sleep 8

echo "6/6 autotest"
bash "$SRC/ntfy/test-ntfy.sh" "$DOMENA"
