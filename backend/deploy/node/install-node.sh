#!/usr/bin/env bash
# Instalacja noda Hyperliquid (bez walidacji) dla skanera HyperQuant. Idempotentna; uruchamiać jako root na Ubuntu 24.04
# (jedyny system wspierany przez hl-visor). Wymagania sprzętu z dokumentacji noda: 16 vCPU, 128 GB RAM, 500 GB SSD;
# porty 4001 i 4002 (gossip) publicznie otwarte; najniższe opóźnienie w Tokio.
#
# Co robi: użytkownik systemowy hlnode; hl-visor pobrany z binaries.hyperliquid.xyz i zweryfikowany podpisem GPG klucza
# Hyperliquid o przypiętym odcisku (inny klucz albo zły podpis — przerwanie); konfiguracja łańcucha i węzłów startowych
# (gossipRootIps z publicznego API); usługa systemd z flagami danych; rotacja plików co godzinę; zapora (4001–4002
# otwarte, lokalne /info na 3001 tylko z localhost).
set -euo pipefail

CHAIN="${CHAIN:-Mainnet}"
HL_USER="hlnode"
HOME_DIR="/home/$HL_USER"
TOOLS="/opt/hyperquant/node-tools"
SRC="$(cd "$(dirname "$0")" && pwd)"
# Odcisk klucza podpisującego hl-visor (Hyperliquid <notices@hyperfoundation.org>), sprawdzony 27.11.2026
FPR="CF2C2EA3DC3E8F042A55FB6503254A9349F1820B"
BIN="https://binaries.hyperliquid.xyz/$CHAIN"

[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root" >&2; exit 1; }
[ "$CHAIN" = "Mainnet" ] || [ "$CHAIN" = "Testnet" ] || { echo "CHAIN: Mainnet albo Testnet" >&2; exit 1; }
if [ "$CHAIN" = "Testnet" ]; then BIN="https://binaries.hyperliquid-testnet.xyz/Testnet"; fi
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || { echo "hl-visor wspiera tylko Ubuntu 24.04 (jest: ${PRETTY_NAME:-?})" >&2; exit 1; }

apt-get update -qq
apt-get install -y -qq curl gnupg jq ufw

id "$HL_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$HL_USER"
# Polecenie jako użytkownik noda, z jego katalogiem domowym i jego zbiorem kluczy GPG (bez GNUPGHOME roota)
as_hl() { runuser -u "$HL_USER" -- env -u GNUPGHOME HOME="$HOME_DIR" "$@"; }

# hl-visor: pobranie do pliku tymczasowego, podpis z przypiętym odciskiem, dopiero potem podmiana
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
curl -fsSL https://raw.githubusercontent.com/hyperliquid-dex/node/main/pub_key.asc -o "$work/pub_key.asc"
gpg --batch --quiet --import "$work/pub_key.asc"
curl -fsSL "$BIN/hl-visor" -o "$work/hl-visor"
curl -fsSL "$BIN/hl-visor.asc" -o "$work/hl-visor.asc"
if ! gpg --batch --status-fd 1 --verify "$work/hl-visor.asc" "$work/hl-visor" 2>/dev/null | grep -q "VALIDSIG $FPR"; then
  echo "Podpis hl-visor nie pochodzi od klucza $FPR — instalacja przerwana" >&2
  exit 1
fi
install -o "$HL_USER" -g "$HL_USER" -m 755 "$work/hl-visor" "$HOME_DIR/hl-visor"
# hl-visor sam weryfikuje i aktualizuje hl-node; klucz Hyperliquid w zbiorze kluczy użytkownika noda
install -o "$HL_USER" -g "$HL_USER" -m 644 "$work/pub_key.asc" "$HOME_DIR/pub_key.asc"
as_hl gpg --batch --quiet --import "$HOME_DIR/pub_key.asc"

# Łańcuch i węzły startowe (co najmniej jeden adres; lista z publicznego API Hyperliquid)
printf '{"chain": "%s"}\n' "$CHAIN" > "$HOME_DIR/visor.json"
roots="$(curl -fsS -X POST https://api.hyperliquid.xyz/info -H 'content-type: application/json' -d '{"type":"gossipRootIps"}')"
echo "$roots" | jq -e 'type == "array" and length > 0' >/dev/null || { echo "Brak listy gossipRootIps" >&2; exit 1; }
echo "$roots" | jq --arg chain "$CHAIN" '{root_node_ips: map({Ip: .}), try_new_peers: false, chain: $chain}' > "$HOME_DIR/override_gossip_config.json"
chown "$HL_USER:$HL_USER" "$HOME_DIR/visor.json" "$HOME_DIR/override_gossip_config.json"

# Usługi: node i rotacja danych
install -d -m 755 "$TOOLS"
install -m 755 "$SRC/hyperliquid-prune.sh" "$TOOLS/hyperliquid-prune.sh"
install -m 644 "$SRC/hyperliquid-node.service" /etc/systemd/system/hyperliquid-node.service
install -m 644 "$SRC/hyperliquid-prune.service" /etc/systemd/system/hyperliquid-prune.service
install -m 644 "$SRC/hyperliquid-prune.timer" /etc/systemd/system/hyperliquid-prune.timer
systemctl daemon-reload
systemctl enable --now hyperliquid-node.service hyperliquid-prune.timer

# Zapora: gossip publicznie (inaczej węzły obniżają priorytet tego adresu), /info tylko lokalnie
ufw allow OpenSSH >/dev/null
ufw allow 4001:4002/tcp >/dev/null
ufw deny 3001/tcp >/dev/null
ufw --force enable >/dev/null

echo "Node uruchomiony. Postęp: journalctl -u hyperliquid-node -f (strumień na żywo: linie „applied block”)."
echo "Świeżość lokalnego /info: curl -s localhost:3001/info -H 'content-type: application/json' -d '{\"type\":\"exchangeStatus\"}'"
