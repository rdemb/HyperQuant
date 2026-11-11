#!/usr/bin/env bash
# Aktualizacja kodu skanera i serwera powiadomień (hyperquant-update.service, root, co 15 min, w katalogu kodu).
# install.sh kopiuje ten plik do /opt/hyperquant/bin — poza katalog aktualizowany, więc kod z repo nie wykonuje się
# jako root, a zmiana tego pliku w repo działa dopiero po ponownym install.sh. Strażnik ma własną kopię i nie jest
# aktualizowany tym skryptem.
#
# Dwa tryby:
#  - gałąź (domyślnie, gdy nie ma pliku zaufanych kluczy): kod równany do gałęzi zdalnej, jak dotąd;
#  - podpisane tagi (jest niepusty plik HQ_UPDATE_SIGNERS w formacie allowed_signers ssh): kod tylko do najnowszego
#    tagu HQ_UPDATE_TAG_GLOB z ważnym podpisem zaufanego klucza (git verify-tag), tylko do przodu (bez cofania wersji).
#    Push bez podpisu (gałąź, tag bez podpisu, tag lekki) niczego nie zmienia.
#
# Restart tylko po zmianie kodu usług (backend, src, modele kota, pakiety); sam wpis bloga tylko aktualizuje pliki,
# bez przerwy w nagraniu. Serwer powiadomień restartuje się tylko po zmianie swojego kodu.
set -euo pipefail

SIGNERS="${HQ_UPDATE_SIGNERS:-/etc/hyperquant/allowed_signers}"
TAG_GLOB="${HQ_UPDATE_TAG_GLOB:-v*}"

# Najnowszy tag z ważnym podpisem; tagi pominięte trafiają do dziennika. Pusty wynik = brak takiego tagu.
latest_signed_tag() {
  local t tags
  tags="$(git tag -l "$TAG_GLOB" --sort=-version:refname)"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    # Obiekt tagu (nie tag lekki) z tą samą nazwą w środku — podpisany tag pod inną nazwą to przeniesiona referencja
    if [ "$(git for-each-ref --format='%(objecttype) %(tag)' "refs/tags/$t")" != "tag $t" ]; then
      echo "tag $t: brak podpisanego obiektu tagu o tej nazwie, pominięty" >&2
      continue
    fi
    if git -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-tag "refs/tags/$t" >/dev/null 2>&1; then
      echo "$t"
      return 0
    fi
    echo "tag $t: brak ważnego podpisu zaufanego klucza, pominięty" >&2
  done <<<"$tags"
  return 0
}

main() {
  local head target label
  head="$(git rev-parse HEAD)"
  if [ -s "$SIGNERS" ]; then
    git fetch --quiet --tags --force origin
    local tag
    tag="$(latest_signed_tag)"
    if [ -z "$tag" ]; then
      echo "tryb podpisanych tagów: brak tagu $TAG_GLOB z ważnym podpisem, kod bez zmian"
      return 0
    fi
    target="$(git rev-parse "refs/tags/$tag^{commit}")"
    [ "$target" != "$head" ] || return 0
    if ! git merge-base --is-ancestor "$head" "$target"; then
      echo "tag $tag nie jest następcą bieżącego kodu, bez cofania wersji (zmiana tylko przez install.sh z TAG=)" >&2
      return 0
    fi
    label="tag $tag"
  else
    git fetch --quiet
    target="$(git rev-parse '@{u}')"
    [ "$target" != "$head" ] || return 0
    label="$target"
  fi

  git reset --quiet --hard "$target"
  if git diff --quiet "$head" "$target" -- backend src public/schrodi package.json package-lock.json; then
    echo "pliki zaktualizowane do $label, kod skanera bez zmian (bez restartu)"
  else
    systemctl restart hyperquant-scanner
    echo "skaner zaktualizowany do $label"
  fi
  if ! git diff --quiet "$head" "$target" -- backend/alerts backend/scanner/hl.ts backend/scanner/rateLimiter.ts src/utils package.json package-lock.json; then
    systemctl try-restart hyperquant-alerts
    echo "serwer powiadomień zaktualizowany do $label"
  fi
}

main "$@"
