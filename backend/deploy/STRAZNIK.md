# Strażnik bez root i aktualizacja z podpisanych tagów

Instrukcja dla operatora serwera skanera (Ubuntu, systemd). Wszystkie polecenia wykonujesz jako root na serwerze.
Ścieżki są domyślnymi ścieżkami z `install.sh`.

## Co się zmienia

Dotąd strażnik (`hyperquant-watchdog.service`) działał jako root i uruchamiał `scripts/watchdog.mjs` z katalogu
`/opt/hyperquant/app`. Ten katalog `hyperquant-update.timer` co 15 min równa do gałęzi `main` repo. Każdy, kto mógł
wypchnąć commit do `main` (albo przejąć konto GitHub), w ciągu 15 min uruchamiał swój kod jako root na serwerze.

Po zmianie:

1. **Strażnik działa jako osobny użytkownik `hyperquant-watchdog`**, nie root i nie użytkownik skanera. Ma izolację
   jak skaner (`NoNewPrivileges`, `ProtectSystem=strict`, puste `CapabilityBoundingSet`, filtr wywołań systemowych)
   i zapisuje tylko do własnego katalogu `/var/lib/hyperquant-watchdog`.
2. **Restart usług przez polkit.** Reguła `/etc/polkit-1/rules.d/50-hyperquant-watchdog.rules` pozwala temu
   użytkownikowi tylko na `restart` usług `hyperquant-scanner` i `hyperquant-alerts`. Start, stop, inne usługi
   i pliki jednostek są zabronione.
3. **Kod strażnika pochodzi z kopii** w `/opt/hyperquant/watchdog` (root, tylko odczyt). Kopię kładzie `install.sh`.
   Push do repo jej nie zmienia, więc nie wyłączy też strażnika, który pilnuje skanera.
4. **Skrypt aktualizacji też jest kopią** (`/opt/hyperquant/bin/hyperquant-update`, wzorzec
   `backend/deploy/hyperquant-update.sh`). Ma dwa tryby:
   - **gałąź** (domyślnie): kod skanera i serwera powiadomień idzie za gałęzią `main`, jak dotąd;
   - **podpisane tagi** (zalecany): włącza go plik `/etc/hyperquant/allowed_signers`. Kod idzie tylko do najnowszego
     tagu `v*` z ważnym podpisem zaufanego klucza (`git verify-tag`), tylko do przodu. Push bez podpisu nie zmienia
     kodu na serwerze.
5. **Dostęp do plików.** Strażnik czyta klucz wdrożeniowy repo danych przez `LoadCredential` systemd: plik klucza
   zostaje własnością skanera, a strażnik dostaje kopię widoczną tylko dla siebie. `status.json` skanera i puls serwera
   powiadomień mają teraz prawa `0640`, więc strażnik czyta je jako członek grupy `hyperquant`. Reszta stanu usług
   zostaje `0600`. Sekrety R2 nie trafiają do środowiska strażnika.

### Kompromis między trybami

| | Tryb gałęzi (domyślny) | Tryb podpisanych tagów |
| --- | --- | --- |
| Strażnik | nie root, kod z kopii, push go nie zmienia | tak samo |
| Kod skanera i serwera powiadomień | idzie za `main`. Push wykonuje kod jako użytkownik `hyperquant` (bez root) | tylko podpisany tag. Push bez podpisu nic nie zmienia |
| Wdrożenie zmiany | commit na `main` (najwyżej 15 min) | podpisany tag `v*` (najwyżej 15 min) |
| Wpisy bloga na serwerze | aktualne | do następnego tagu (skaner ich nie czyta) |
| Wymagania | brak | klucz podpisu u właściciela, plik zaufanych kluczy na serwerze |

Tryb domyślny jest bezpieczny dla roota bez żadnej konfiguracji. Tryb tagów zamyka też drogę „push → kod skanera”
(skaner ma klucz wdrożeniowy repo danych i dziennik prognoz). Kosztem jest jeden podpisany tag na każde wdrożenie.

## Wymagania

- polkit z regułami JavaScript (wersja 0.106 lub nowsza). Ubuntu 23.04 i nowsze oraz Debian 12 mają go w pakiecie
  `polkitd`. Ubuntu 22.04 ma polkit 0.105 bez reguł JS: tam strażnik nie zrestartuje usług, tylko zgłosi alarm.
  `install.sh` wypisuje wtedy ostrzeżenie.
- systemd 247 lub nowszy (`LoadCredential`), git 2.34 lub nowszy (podpisy ssh).

```bash
pkaction --version      # oczekiwane: 0.106 lub więcej
systemctl --version | head -1
git --version
```

## Część A. Strażnik bez root (tryb domyślny)

1. **Zapisz stan przed zmianą** (potrzebny do wycofania):

   ```bash
   mkdir -p /root/hq-przed
   cp -a /etc/systemd/system/hyperquant-*.service /etc/systemd/system/hyperquant-*.timer /root/hq-przed/
   git -C /opt/hyperquant/app rev-parse HEAD > /root/hq-przed/commit.txt
   ```

2. **Zainstaluj polkit**, jeśli go nie ma:

   ```bash
   command -v pkaction || apt-get install -y polkitd
   ```

3. **Zatrzymaj timery na czas zmiany**, żeby strażnik nie zgłosił restartu jako awarii:

   ```bash
   systemctl stop hyperquant-watchdog.timer hyperquant-update.timer
   ```

4. **Uruchom `install.sh` w wersji, która zawiera tę zmianę.** Najpierw przeczytaj pobrany plik:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/rdemb/HyperQuant/main/backend/deploy/install.sh -o /root/install.sh
   less /root/install.sh
   bash /root/install.sh
   ```

   Skrypt tworzy użytkownika `hyperquant-watchdog`, kopiuje strażnika i skrypt aktualizacji, instaluje regułę polkit
   i drop-in z kluczem (`/etc/systemd/system/hyperquant-watchdog.service.d/deploy-key.conf`, gdy w
   `/etc/hyperquant/scanner.env` jest `HQ_GIT_SSH_KEY`). Na koniec restartuje skaner i serwer powiadomień oraz włącza
   timery.

5. **Sprawdź** (wynik obok polecenia):

   ```bash
   systemctl show -p User -p SupplementaryGroups -p ExecStart hyperquant-watchdog
   #   User=hyperquant-watchdog (nie root), SupplementaryGroups=hyperquant,
   #   ExecStart z /opt/hyperquant/watchdog/watchdog.mjs (nie z /opt/hyperquant/app)
   systemctl show -p LoadCredential hyperquant-watchdog      # deploy_key:<ścieżka klucza>, gdy jest repo danych
   sleep 90; stat -c '%a %U:%G %n' /var/lib/hyperquant/out/status.json /var/lib/hyperquant/state/alerts-pulse.json
   #   640 hyperquant:hyperquant (pliki zapisane już przez nowy kod)
   systemctl start hyperquant-watchdog; journalctl -u hyperquant-watchdog -n 5 --no-pager
   #   „[strażnik] ok” (tuż po restarcie usług może być „ok”, bo działa 10-minutowy czas na start);
   #   brak „wysyłka stanu nieudana”
   ```

   Reguła polkit: odmowa dla wszystkiego poza restartem dwóch usług:

   ```bash
   sudo -u hyperquant-watchdog systemctl --no-ask-password stop hyperquant-scanner     # odmowa (Access denied / authentication required)
   sudo -u hyperquant-watchdog systemctl --no-ask-password restart ssh                 # odmowa
   sudo -u hyperquant-watchdog systemctl --no-ask-password restart hyperquant-alerts   # sukces (krótka przerwa serwera powiadomień)
   ```

6. Timery włączył już `install.sh`. Sprawdź: `systemctl list-timers 'hyperquant-*'`.

## Część B. Aktualizacja tylko z podpisanych tagów (zalecana)

### B1. Klucz podpisu u właściciela repo (raz, na własnym komputerze)

Klucz prywatny nigdy nie trafia na serwer ani do repo. Na serwer idzie tylko klucz publiczny.

```bash
ssh-keygen -t ed25519 -C "podpis tagów HyperQuant" -f ~/.ssh/hq_tag_signing   # albo istniejący klucz ssh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/hq_tag_signing.pub
```

Opcjonalnie dodaj klucz publiczny w GitHub jako *Signing key*. Wtedy tagi mają tam oznaczenie „Verified”.
Serwer i tak sprawdza podpis sam, bez GitHuba.

### B2. Pierwszy podpisany tag

```bash
git tag -s v2.5.0 -m "v2.5.0"        # na commicie, który ma trafić na serwer
git tag -v v2.5.0                    # lokalnie: „Good "git" signature”
git push origin v2.5.0
```

### B3. Zaufany klucz na serwerze i instalacja z tagu

```bash
# Format allowed_signers: <adres e-mail> <typ klucza> <klucz publiczny>
echo "<e-mail> $(cat hq_tag_signing.pub)" > /etc/hyperquant/allowed_signers   # treść pliku .pub z komputera właściciela
chown root:root /etc/hyperquant/allowed_signers && chmod 0644 /etc/hyperquant/allowed_signers

systemctl stop hyperquant-update.timer
curl -fsSL https://raw.githubusercontent.com/rdemb/HyperQuant/v2.5.0/backend/deploy/install.sh -o /root/install.sh
TAG=v2.5.0 bash /root/install.sh
```

Jeśli plik zaufanych kluczy istnieje, `install.sh` bez `TAG=` się zatrzyma. Z tagiem bez ważnego podpisu też się
zatrzyma i nie zmieni kodu. Kopie strażnika i skryptu aktualizacji pochodzą wtedy ze sprawdzonego tagu.

Opcjonalnie inny wzorzec tagów (np. osobne tagi wdrożeń):
`echo 'HQ_UPDATE_TAG_GLOB=deploy-*' > /etc/hyperquant/update.env`.

### B4. Sprawdzenie

```bash
git -C /opt/hyperquant/app describe --tags --exact-match        # v2.5.0
systemctl start hyperquant-update; journalctl -u hyperquant-update -n 5 --no-pager
```

**Push bez podpisu nie zmienia kodu.** Wystarczy zwykły commit na `main` (np. wpis bloga) albo tag bez podpisu:

```bash
before=$(git -C /opt/hyperquant/app rev-parse HEAD)
systemctl start hyperquant-update
git -C /opt/hyperquant/app fetch --quiet origin main
echo "HEAD przed: $before"
echo "HEAD po:    $(git -C /opt/hyperquant/app rev-parse HEAD)"     # to samo co przed
echo "main:       $(git -C /opt/hyperquant/app rev-parse origin/main)"   # inny commit
journalctl -u hyperquant-update -n 5 --no-pager                 # tagi bez podpisu: „pominięty”
```

### B5. Codzienna praca

Wdrożenie to nowy podpisany tag wypchnięty do repo. Timer przenosi kod w ciągu 15 min i restartuje usługi tylko
po zmianie ich kodu. Strażnik i skrypt aktualizacji zmieniają się tylko przez `TAG=<tag> bash install.sh`.

Skrypt bierze najnowszy tag z ważnym podpisem i pomija:
- tagi bez podpisu i tagi lekkie;
- podpisy spoza listy zaufanych kluczy;
- podpisany tag pod inną nazwą (przeniesioną referencję).

Tagu starszego niż bieżący kod skrypt nie wdroży. Cofnięcie wersji robisz tylko świadomie (niżej).

## Wycofanie

**Inna (np. starsza) wersja w trybie tagów:**

```bash
TAG=<wcześniejszy podpisany tag> bash /root/install.sh
```

Timer jej nie zmieni, dopóki nie pojawi się nowszy podpisany tag.

**Wyłączenie trybu tagów** (powrót do gałęzi `main`):

```bash
rm /etc/hyperquant/allowed_signers
systemctl start hyperquant-update     # kod do stanu main
```

Aby kod został tam, gdzie jest, wyłącz timer: `systemctl disable --now hyperquant-update.timer`.

**Strażnik z powrotem jak przed zmianą** (gdy coś nie działa; dawne pliki z kroku A1):

```bash
systemctl stop hyperquant-watchdog.timer hyperquant-update.timer
cp /root/hq-przed/hyperquant-watchdog.service /root/hq-przed/hyperquant-update.service /etc/systemd/system/
rm -rf /etc/systemd/system/hyperquant-watchdog.service.d
systemctl daemon-reload
systemctl start hyperquant-watchdog.timer hyperquant-update.timer
systemctl show -p User hyperquant-watchdog     # pusto = root, jak dawniej
```

Dawne jednostki działają z nowym kodem repo: strażnik jako root czyta klucz i pliki tak jak dawniej. Dawna usługa
aktualizacji nie zna trybu tagów i znowu idzie za `main`. Jeśli kod ma zostać na tagu, wyłącz jej timer. Użytkownik
`hyperquant-watchdog` i reguła polkit mogą zostać. Pełne sprzątanie:
`rm /etc/polkit-1/rules.d/50-hyperquant-watchdog.rules /opt/hyperquant/bin/hyperquant-update; rm -r /opt/hyperquant/watchdog; userdel hyperquant-watchdog`.
Po wycofaniu nie uruchamiaj ponownie nowego `install.sh`, bo zainstaluje nowe jednostki.

## Co zostaje

- Usługa aktualizacji działa jako root: robi `git fetch` i `reset --hard` w katalogu kodu oraz restartuje usługi.
  Polecenia pochodzą z kopii instalowanej przez `install.sh`, nie z repo. Git jako root obrabia jednak treść
  z repo zdalnego.
- W trybie gałęzi push do `main` wykonuje kod jako użytkownik skanera (`hyperquant`), bez root.
- Kopia strażnika nie aktualizuje się sama. Poprawki strażnika trafiają na serwer po ponownym `install.sh`.
- `install.sh` pobrany z `main` jest tak zaufany jak `main`. W trybie tagów pobieraj go z podpisanego tagu (B3).
