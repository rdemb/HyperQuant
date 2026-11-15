#!/usr/bin/env bash
# Autotest serwera ntfy HyperQuant (root): HTTPS, odmowa publikacji bez tokenu (403), publikacja z tokenem do tematu
# testowego hq-test, odczyt tej wiadomości anonimowo, brak dziennika dostępu w Caddy i ntfy. Token nie jest wypisywany.
#   bash /opt/hyperquant/app/backend/deploy/ntfy/test-ntfy.sh ntfy.hyperquant.tech
set -uo pipefail
DOMENA="${1:?domena}"
URL="https://$DOMENA"
TOKEN="$(grep '^HQ_NTFY_TOKEN=' /etc/hyperquant/topics.env | cut -d= -f2-)"
ok=0
bad=0
check() { if [ "$2" = "$3" ]; then echo "OK   $1 ($2)"; ok=$((ok + 1)); else echo "NIE  $1: jest $2, oczekiwane $3"; bad=$((bad + 1)); fi; }

check "HTTPS odpowiada (/v1/health)" "$(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/health")" 200
check "publikacja bez tokenu do hq-test" "$(curl -s -o /dev/null -w '%{http_code}' -d 'proba bez tokenu' "$URL/hq-test")" 403
check "publikacja bez tokenu do hq-btc-pdh" "$(curl -s -o /dev/null -w '%{http_code}' -d 'proba bez tokenu' "$URL/hq-btc-pdh")" 403
check "publikacja z tokenem poza hq-* (inny-temat)" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -d 'proba' "$URL/inny-temat")" 403
ID="test-$(date +%s)"
check "publikacja z tokenem do hq-test" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Title: HyperQuant test' -d "$ID" "$URL/hq-test")" 200
sleep 1
check "odczyt hq-test bez tokenu (wiadomość widoczna)" "$(curl -s "$URL/hq-test/json?poll=1&since=5m" | grep -c "$ID")" 1
check "dziennik dostępu Caddy wyłączony (brak dyrektywy log)" "$(grep -c '^\s*log' /etc/caddy/Caddyfile)" 0
check "ntfy: dziennik tylko błędów" "$(grep -c '^log-level: error' /etc/ntfy/server.yml)" 1
check "ntfy: bez upstream do ntfy.sh" "$(grep -c '^upstream-base-url' /etc/ntfy/server.yml)" 0
check "usługa hyperquant-tematy działa" "$(systemctl is-active hyperquant-tematy)" active
check "plik tokenu: root 0600" "$(stat -c '%U %a' /etc/hyperquant/topics.env)" "root 600"
echo "Wynik: $ok OK, $bad NIE"
[ "$bad" = 0 ]
