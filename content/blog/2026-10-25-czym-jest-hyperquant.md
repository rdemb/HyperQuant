---
title: "HyperQuant jest gotowy. Darmowy orderflow BTC, lekcje i analizy pisane przed faktem"
description: "Wykresy orderflow BTC na żywo z powtórką nagranej doby, lekcje na prawdziwych dniach rynku i blog z mapami pisanymi przed faktem. Za darmo, bez konta, po polsku i po angielsku."
date: 2026-10-25T12:00:00+01:00
type: article
section: O HyperQuant
summary:
  - "HyperQuant to darmowa strona do day tradingu BTC na publicznych danych Hyperliquid: wykresy orderflow, lekcje i blog z analizami."
  - "Footprint, mapa płynności, VWAP, profil i powtórka nagranej doby, na telefonie i na komputerze."
  - "Bez konta i bez reklam, po polsku i po angielsku. Kod jest otwarty."
  - "Nie daję sygnałów i nie obiecuję zysków. Prognozy są zapisywane przed faktem i rozliczane publicznie."
  - "To wersja publiczna. Teraz zbieram Wasze opinie."
---
[![Wykresy HyperQuant: footprint BTC 1 min z mapą płynności arkusza, bąblami dużych zleceń, deltą, CVD, panelem Kto handluje i taśmą zleceń](wykresy.jpg)](wykresy.jpg)

*Wykresy HyperQuant, stacja Skalper: footprint 1 min, mapa płynności arkusza, bąble dużych zleceń, delta, CVD, Kto handluje i taśma zleceń. Powtórka z 24 października, 18:51.*

## Po co powstał HyperQuant

Większość ludzi handluje BTC, patrząc na same świece. Świeca mówi, gdzie cena była, ale nie mówi, kto ją tam zaniósł. Czy kupujący naprawdę naciskali, czy tylko zabrakło sprzedających? Gdzie w arkuszu czekają duże zlecenia? Narzędzia, które to pokazują, zwykle są płatne w abonamencie i prawie zawsze tylko po angielsku. Obok jest pełno grup z sygnałami, które obiecują zyski i z niczego się nie rozliczają.

Chciałem mieć coś innego: narzędzie, które pokazuje rynek od środka i nie mówi mi, co mam kliknąć. Tak powstał HyperQuant. Działa na publicznych danych giełdy Hyperliquid, jest za darmo i jest otwarty dla każdego.

## Wykresy: rynek od środka

Sercem strony są Wykresy. BTC, ETH, SOL i HYPE na żywo, na silniku TradingView Lightweight Charts. Oprócz świec masz tu footprint, czyli ile kupiono i sprzedano na każdym poziomie ceny, mapę płynności z arkusza zleceń, bąble dużych zleceń rynkowych, deltę i CVD, VWAP z odchyleniami, profil wolumenu, TPO i narzędzia do rysowania jak w TradingView.

Żeby nie ustawiać tego wszystkiego ręcznie, nad wykresem są stacje. Każda odpowiada na jedno pytanie: Start (co się dzieje), Skalper (kto teraz naciska), Płynność (gdzie stoją zlecenia i pozycje), Aukcja (gdzie rynek widzi wartość), Giełdy (czy Binance i Bybit się zgadzają) i Dwa interwały (co mówi wyższy interwał). Jedno kliknięcie i masz gotowy układ.

Nad wykresem jest też Stan rynku. To jedno zdanie złożone ze stałych reguł na ostatnich 10 świecach: gdzie jest cena względem VWAP, w którą stronę idzie CVD i od ilu świec, co robią otwarte pozycje, po której stronie są duzi gracze, a jeśli włączysz ich dane, także czy Binance i Bybit się zgadzają. Pod przyciskiem „skąd?” są liczby, z których to zdanie wyszło. To opis sytuacji, nie sygnał.

## Powtórka: przewiń nagraną dobę

Hyperliquid nie udostępnia historii taśmy transakcji ani arkusza zleceń, więc HyperQuant nagrywa je sam. Dlatego footprint i mapa płynności są na wykresie od pierwszej sekundy, a nagraną dobę możesz odtworzyć jak film: w tempie 1×, 5×, 15× albo 60×, z suwakiem czasu, na tym samym wykresie co na żywo.

Przykład z 24 października. Chwilę przed 19:00 sprzedający wrzucili na rynek 319 BTC w jedną minutę, a cena skończyła tę minutę tylko 36 dolarów niżej. Zlecenia z limitem po drugiej stronie przyjęły wszystko. To jest absorpcja i na zwykłej świecy jej nie widać. To ostatnia świeca na zrzucie na górze, z deltą −293 BTC. [Ten moment otworzysz tutaj](https://rdemb.github.io/HyperQuant/#charts?replay=lessons&m=BTC&i=1m&v=footprint&from=2026-10-24T16:00:00Z&to=2026-10-24T22:00:00Z&t=2026-10-24T16:52:00Z&station=scalp) i sam przewiniesz, co działo się dalej.

## Lekcje na prawdziwych dniach

W Lekcjach jest sześć ćwiczeń na prawdziwych dniach BTC z 20–24 października: wybicie na otwarciu Nowego Jorku, dzień trendu, odbicie w dniu spadkowym, dzień równowagi, kaskada likwidacji i strefa na footprincie. Wykres zatrzymuje się w ważnym momencie i widzisz tylko to, co było widać wtedy. Odpowiadasz, co widzisz i gdzie byłby błąd, a potem odsłaniasz dalszy ciąg świeca po świecy.

[![Lekcje HyperQuant: ćwiczenie Kaskada likwidacji z wykresem zatrzymanym o 17:30 i pytaniem z czterema odpowiedziami](lekcje.jpg)](lekcje.jpg)

*Ćwiczenie „Kaskada likwidacji i kto kupuje odbicie”: wykres stoi o 17:30, dalszy ciąg jest ukryty, a Ty wybierasz, co robisz z tą informacją.*

Strona ocenia tok rozumowania, a nie to, czy transakcja by zarobiła. Obok ćwiczeń jest atlas 21 wskaźników z Wykresów (co to jest, jak go liczymy, jak go czytać, gdzie są pułapki), rozdział o łączeniu wskaźników, popularne reguły tradingu zestawione z danymi i symulator ryzyka, który pokazuje, co z kapitałem robią serie strat.

## Blog: mapy przed faktem i uczciwe rozliczenia

Tutaj, na blogu, codziennie publikuję mapy BTC: rano mapę dnia, po południu mapę przed otwarciem Nowego Jorku i wieczorem podsumowanie, a między nimi krótkie notki. W mapach są poziomy dnia z prawdopodobieństwem dotknięcia, scenariusze i wykres sesji z VWAP, profilem, deltą i CVD. Pod każdym wpisem jest przycisk, który przez tydzień otwiera nagranie rynku z chwili publikacji, więc możesz sprawdzić, co było dalej.

Nie poprawiam niczego po fakcie. Każdy wpis ma publiczną historię zmian, a model desku co 15 minut zapisuje swoje prognozy w publicznym dzienniku z łańcuchem hashy i potwierdzeniem w blockchainie Bitcoina. W sobotę rozliczam cały tydzień, także to, co nie wyszło. W [pierwszym rozliczeniu](../2026-10-24-rozliczenie-tygodnia/) napisałem wprost, że 35 ocen z jednego dnia to wciąż w dużej mierze szum.

## Reszta desku

Na stronie jest też Desk z arkuszem zleceń, taśmą i mapą likwidacji, Analizator planu, który dla Twojego wejścia, stopu i celu liczy szansę dojścia do celu przed stopem, poślizg i wynik po opłatach, Rynek z fundingiem na trzech giełdach i kalendarzem makro, Mikrostruktura arkusza i Źródła, gdzie jest opisane, skąd pochodzi każda liczba.

## Czego HyperQuant nie robi

Nie daje sygnałów kupna ani sprzedaży i nie obiecuje zysków. Pokazuje dane i pomaga ocenić plan, który przygotowujesz sam. Liczby z modelu są oznaczone jako MODEL, dane na żywo jako LIVE, a gdy danych brakuje, strona pokazuje brak zamiast wymyślonej liczby.

Podstawą są dane Hyperliquid. Binance i Bybit możesz włączyć w Źródłach, wtedy pobiera je Twoja przeglądarka, a nie mój serwer. Powtórka sięga ostatniej doby nagrania.

## Za darmo, bez konta, po polsku i po angielsku

HyperQuant działa w przeglądarce na telefonie i na komputerze, bez logowania i bez reklam. Możesz go też zainstalować jak aplikację: na iPhonie przez Udostępnij i Do ekranu początkowego, na Androidzie przez Zainstaluj aplikację. Interfejs jest po polsku i po angielsku, przełącznik PL | EN jest w nagłówku. Twoje plany, dzienniki i rysunki zostają w Twojej przeglądarce. Kod jest otwarty [na GitHubie](https://github.com/rdemb/HyperQuant), na licencji MIT.

[![HyperQuant na telefonie: Wykresy w powtórce, Lekcje i notka z bloga z wykresem z 6 godzin](telefon.jpg)](telefon.jpg)

*Na telefonie: Wykresy w powtórce, Lekcje i notka z bloga z wykresem z ostatnich 6 godzin.*

## Teraz Twoja kolej

To jest publiczna wersja HyperQuant. Przez najbliższy czas nie dokładam nowych funkcji, tylko słucham i poprawiam. Od poniedziałku sam pracuję na nim codziennie przy day tradingu BTC.

Napisz mi, co jest niejasne, co nie działa na Twoim telefonie i czego brakuje Ci najbardziej. Najprościej w komentarzu pod postem na Facebooku, na stronie HyperQuant PL. Błędy techniczne możesz też [zgłosić na GitHubie](https://github.com/rdemb/HyperQuant/issues). Przeczytam każdą uwagę.

[Otwórz HyperQuant](https://rdemb.github.io/HyperQuant/)

Materiał edukacyjny, nie porada inwestycyjna. Handel z dźwignią niesie wysokie ryzyko utraty kapitału.
