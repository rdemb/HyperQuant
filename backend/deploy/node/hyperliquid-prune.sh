#!/usr/bin/env bash
# Rotacja danych noda Hyperliquid: node przy domyślnych ustawieniach zapisuje ok. 100 GB dziennie (dokumentacja noda),
# więc pliki godzinowe starsze niż HL_KEEP_HOURS (domyślnie 24) są usuwane, a z migawek stanu ABCI zostają dwie najnowsze.
# Skaner czyta pliki na bieżąco — nie potrzebuje starszych. Uruchamiane co godzinę przez hyperliquid-prune.timer.
set -euo pipefail

DATA="${HL_DATA:-/home/hlnode/hl/data}"
KEEP_HOURS="${HL_KEEP_HOURS:-24}"
if ! [[ "$KEEP_HOURS" =~ ^[0-9]+$ ]] || [ "$KEEP_HOURS" -lt 2 ]; then
  echo "HL_KEEP_HOURS: liczba godzin ≥ 2" >&2
  exit 1
fi

for dir in node_fills node_raw_book_diffs misc_events node_twap_statuses node_trades node_order_statuses hip3_oracle_updates; do
  root="$DATA/$dir"
  [ -d "$root" ] || continue
  find "$root" -type f -mmin "+$((KEEP_HOURS * 60))" -delete
  find "$root" -mindepth 1 -type d -empty -delete
done

# Migawki stanu (co 10 000 bloków): dwie najnowsze wystarczą do odtworzenia arkusza L4 i pozycji
states="$DATA/periodic_abci_states"
if [ -d "$states" ]; then
  find "$states" -type f -name '*.rmp' -printf '%T@ %p\n' | sort -rn | tail -n +3 | cut -d' ' -f2- | xargs -r rm -f
  find "$states" -mindepth 1 -type d -empty -delete
fi
echo "rotacja: zostają pliki z ostatnich ${KEEP_HOURS} h; wolne miejsce: $(df -h "$DATA" | awk 'NR==2 {print $4}')"
