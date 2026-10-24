import type { LessonsContent } from './types';

/** Odmiana „zdarzenie” po liczebniku. */
const events = (n: number) => (n === 1 ? 'zdarzenie' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zdarzenia' : 'zdarzeń');

/** Treść zakładki Lekcje po polsku. Godziny w czasie polskim (CEST), ceny BTC w USD. */
export const pl: LessonsContent = {
  tz: 'Europe/Warsaw',
  locale: 'pl-PL',
  tzLabel: 'czas polski',
  ui: {
    eyebrow: 'Akademia HyperQuant',
    title: 'Lekcje na naszych wykresach',
    lead:
      'Prawdziwe sytuacje z rynku BTC na Hyperliquid, zatrzymane w ważnym momencie. Odpowiadasz, co widzisz i gdzie byłby błąd, a potem odsłaniamy dalszy ciąg. Oceniamy tok rozumowania, nie zysk: bez sygnałów kup/sprzedaj i bez obiecywania wyników.',
    tabs: { exercises: 'Ćwiczenia', atlas: 'Wskaźniki', combine: 'Jak łączyć', myths: 'Mity i dane', risk: 'Ryzyko' },
    progress: (done, total) => `Ukończone: ${done} z ${total}`,
    level: (n) => ['Podstawy', 'Średni', 'Zaawansowany'][n - 1],
    start: 'Zacznij',
    again: 'Od nowa',
    back: 'Wszystkie ćwiczenia',
    check: 'Sprawdź',
    next: 'Dalej',
    reveal: 'Odsłoń dalszy ciąg',
    revealEnd: 'Odsłoń do końca',
    finish: 'Omówienie',
    score: (s, max) => `Ocena rozumowania: ${s} z ${max}`,
    scoreNote: 'Punkty za odczyt kontekstu i logiczne miejsce unieważnienia, nie za to, czy transakcja by zarobiła.',
    yourAnswer: 'Twoja odpowiedź',
    pickPrompt: 'Kliknij albo dotknij cenę na wykresie.',
    pickNone: 'Nie wskazano jeszcze ceny.',
    verdict: { 0: 'Do poprawy', 1: 'Do obrony', 2: 'Dobry tok rozumowania' },
    debrief: 'Czego uczy ta sytuacja',
    honest: 'Uczciwie',
    practice: 'Ćwicz na żywo',
    openStation: (_id, name) => `Otwórz stację „${name}” w Wykresach`,
    atlasLinks: 'Wskaźniki z tego ćwiczenia',
    labTitle: 'Co mówią dane desku',
    labLoading: 'Wczytuję wyniki Laboratorium folkloru…',
    labUnavailable: 'Wyniki Laboratorium folkloru są chwilowo niedostępne.',
    labLine: (rate, p0, n) => `Sukces w ${rate} zdarzeń, a przy cenie błądzącej losowo oczekiwalibyśmy ${p0} (${n} ${events(n)} w historii).`,
    labEffect: (pp) => `Różnica: ${pp}.`,
    labVerdict: {
      support: 'Historia wspiera tę regułę (eksploracyjnie, po korekcie na wielokrotne testy).',
      against: 'Historia przeczy tej regule (eksploracyjnie, po korekcie na wielokrotne testy).',
      none: 'Brak dowodu, że reguła działa lepiej niż przypadek. To nie dowód, że nie działa nigdy.',
      few: 'Za mało zdarzeń na werdykt.',
    },
    labShort: { support: 'wspiera', against: 'przeczy', none: 'brak dowodu', few: 'za mało danych' },
    labOpen: 'Pełne wyniki w Analizatorze planu',
    loading: 'Wczytuję wycinek rynku…',
    loadError: 'Nie udało się wczytać danych ćwiczenia. Odśwież stronę.',
    dataNote: 'Dane: świece Hyperliquid z archiwum desku; delta, open interest i footprint z taśmy nagrywanej przez desk; likwidacje z taśmy likwidacji desku.',
    checkpoint: (i, n) => `Zatrzymanie ${i} z ${n}`,
    question: (i, n) => `Pytanie ${i} z ${n}`,
    exercisesIntro: 'Sześć prawdziwych sytuacji z 20–24 października 2026, od podstaw do footprintu. Każde zajmuje kilka minut.',
    best: 'Najlepsza odpowiedź',
    pickInput: 'Cena w USD',
    quote: (s) => `„${s}”`,
  },
  chart: {
    hidden: 'dalszy ciąg ukryty',
    stopped: 'zatrzymane',
    noTape: 'brak taśmy',
    delta: 'Delta agresorów, BTC',
    cvd: 'CVD od początku nagrania, BTC',
    oi: 'Open interest, BTC',
    sessions: { london: 'Londyn', ny: 'Nowy Jork' },
    liq: (m) => `${m} mln USD`,
    pickHint: 'Wskaż cenę: kliknij albo dotknij panel ceny.',
    yourPick: 'Twój poziom',
    volume: 'Wolumen',
    oiChange: 'ΔOI',
    imbalance: 'nierównowaga 3:1',
  },
  exercises: {
    'ny-breakout': {
      title: 'Wybicie na otwarciu Nowego Jorku',
      when: 'wt 20.10.2026 · BTC · świece 5 min',
      tagline: 'Spokojny poranek, gwałtowne wybicie przez PDH i cofnięcie do VWAP. Gdzie jest błąd?',
      intro:
        'Wtorek. Od rana BTC stoi w miejscu, a o 15:30 otwiera się giełda w Nowym Jorku. Na rycinie: VWAP dnia z pasmami ±1σ i ±2σ, profil wolumenu dnia (POC, VAH, VAL), szczyt i dołek poniedziałku (PDH, PDL) oraz otwarcie Nowego Jorku.',
      checkpoints: [
        {
          context:
            'Jest 15:30. Od północy cena krąży między 81 300 a 81 800 USD. VWAP prawie się nie rusza (81 630), a obszar wartości dnia, czyli 70% wolumenu, mieści się w 400 dolarach (81 360–81 760).',
          questions: [
            {
              prompt: 'Jak opisać ten poranek?',
              options: [
                { label: 'Trend spadkowy: cena jest pod VWAP i pod wczorajszym dołkiem.', feedback: 'Cena faktycznie jest chwilowo pod VWAP, ale VWAP jest płaski, a cena wiele razy przechodziła przez niego w obie strony. To nie jest trend, tylko krążenie wokół jednej ceny.' },
                {
                  label: 'Równowaga: płaski VWAP, cena krąży wokół niego, obszar wartości wąski.',
                  feedback: 'Tak. Rynek akceptuje jedną cenę i czeka. Równowaga nie mówi, w którą stronę nastąpi wybicie, ale mówi, że z wąskiego zakresu ruch bywa gwałtowny, bo po obu stronach zbierają się zlecenia.',
                },
                { label: 'Trend wzrostowy: od 03:00 cena robi wyższe dołki.', feedback: 'Wyższe dołki z nocy szybko się skończyły, a cena od godzin nie oddala się od VWAP. Rynek w trendzie zostawia VWAP za sobą.' },
                { label: 'Nie da się nic powiedzieć przed otwarciem NY.', feedback: 'Kierunku nie znamy, ale typ poranka już tak. Ta wiedza przyda się za chwilę: wybicie z równowagi trzeba ocenić po tym, czy zostanie zaakceptowane.' },
              ],
            },
          ],
          reveal:
            'Otwarcie NY wybija cenę z równowagi: w godzinę BTC rośnie o ponad 2000 USD, z wolumenem kilka razy większym niż rano. Cena przebija PDH (83 138) i robi szczyt 83 425 (1), ale nie zostaje nad nim: o 17:10 jedna pięciominutowa świeca zrzuca ją do 82 200 (2), czyli prawie do VWAP.',
        },
        {
          context: 'Jest 17:30. Po zrzucie do 82 200 cena od dwudziestu minut trzyma się między 82 330 a 82 630, nad VWAP (82 150). PDH 83 138 został przebity, ale nie utrzymany.',
          questions: [
            {
              prompt: 'Ktoś zakłada, że wybicie będzie kontynuowane. Gdzie leży poziom, którego przełamanie unieważnia ten scenariusz?',
              pick: {
                hint: 'Wskaż cenę na wykresie: pod nią teza o kontynuacji przestaje mieć sens.',
                good: 'Dobrze. Pod dołkiem zrzutu (82 200) i pod VWAP teza traci sens: jeśli kupujący bronią średniej ceny dnia, cena nie powinna zostać pod nią. Unieważnienie jest blisko, więc strata przy błędzie jest mała, a wielkość pozycji można policzyć z tej odległości.',
                ok: 'Do obrony, ale szeroko. Powrót do porannego zakresu (pod 81 800) naprawdę oznacza porażkę wybicia, tylko że ryzyko jest dwa, trzy razy większe. Przy tym samym ryzyku w dolarach pozycja musi być odpowiednio mniejsza.',
                tight: 'Za ciasno. To środek zwykłych wahań po wybiciu, a dołek zrzutu (82 200) leży niżej. Taki poziom zbije szum, zanim rynek powie cokolwiek o tezie.',
                wide: 'Za szeroko. Poniżej porannego zakresu nie zostaje już nic z logiki tego scenariusza, a ryzyko rośnie kilkukrotnie bez żadnej korzyści.',
              },
            },
          ],
          reveal:
            'VWAP wytrzymał. Cena już nie zeszła pod 82 310, a wieczorem wróciła do 82 800–82 900. Następnego dnia BTC wybił PDH na dobre i zrobił dzień trendu: to ćwiczenie „Dzień trendu: +2σ to nie sufit”.',
        },
      ],
      debrief: {
        points: [
          'Równowaga (płaski VWAP, wąski obszar wartości) nie zdradza kierunku, ale zapowiada, że wybicie może być gwałtowne. Wybicie oceniamy po akceptacji, a nie po samym przebiciu.',
          'PDH został przebity, ale nie zaakceptowany: cena wróciła pod niego w kilkanaście minut. Samo dotknięcie poziomu nic nie znaczy; liczy się czas i wolumen po drugiej stronie.',
          'Po wybiciu VWAP zmienił rolę: z „środka zakresu” stał się linią obrony kupujących. Zrzut zatrzymał się tuż nad nim.',
          'Unieważnienie wynika z miejsca, w którym teza przestaje mieć sens. Wielkość pozycji wynika z odległości do tego miejsca, a nie odwrotnie.',
        ],
        honest:
          'To jeden przykład, a nie reguła: w innym dniu ten sam obraz kończy się zejściem pod VWAP. Laboratorium folkloru desku sprawdza na historii pokrewną regułę „Zebranie PDH → powrót” i porównuje ją z ceną błądzącą losowo.',
      },
      zoneLabels: ['logiczne unieważnienie'],
    },
    'trend-up': {
      title: 'Dzień trendu: +2σ to nie sufit',
      when: 'śr 21.10.2026 · BTC · świece 15 min',
      tagline: 'Cena dotyka pasma +2σ. „Drogo, czas na short”? Sprawdź, co mówi kontekst dnia.',
      intro:
        'Dzień po wybiciu z poprzedniego ćwiczenia. Na rycinie: VWAP dnia z pasmami ±1σ i ±2σ, PDH i PDL (szczyt i dołek wtorku) oraz otwarcia Londynu i Nowego Jorku.',
      checkpoints: [
        {
          context:
            'Jest 16:45. Od otwarcia Londynu cena rośnie, PDH 83 425 przebity przed południem i utrzymany. Od 11:00 cena nie dotknęła VWAP, który sam rośnie (teraz 83 390). Cena 84 185 to +1,9σ od VWAP, tuż przy paśmie +2σ.',
          questions: [
            {
              prompt: 'Wielu traderów uczy: „cena przy +2σ jest statystycznie za wysoko”. Co mówi kontekst tego dnia?',
              options: [
                {
                  label: 'Short z celem na VWAP: cena jest za daleko od średniej.',
                  feedback:
                    'To odruch z dni równowagi. Dziś VWAP rośnie, cena od pięciu godzin go nie dotyka, a przebity PDH stał się wsparciem. W takim dniu pasma rozszerzają się razem z ceną, a sprzedaż przy +2σ to walka z trendem bez logicznego unieważnienia.',
                },
                {
                  label: 'Dzień trendu: rosnący VWAP, cena stale nad nim, PDH przebity i utrzymany. Nie walczę z ruchem; wejścia szukałbym raczej na cofnięciu do struktury.',
                  feedback:
                    'Tak. Pasmo σ to linijka, a nie sygnał. W trendzie cena potrafi godzinami jechać po paśmie +1σ…+2σ. Rozsądny proces to czekanie na cofnięcie do struktury (np. pasmo +1σ, przebity poziom) z jasnym unieważnieniem, albo brak transakcji.',
                },
                {
                  label: 'Kupuję teraz, bo trend jest silny.',
                  feedback:
                    'Kierunek rozpoznany dobrze, ale gonienie ceny przy +2σ daje najgorszą lokalizację: najdalej do logicznego unieważnienia. Lepszy proces to cofnięcie albo mniejsza pozycja.',
                },
                { label: 'Nic nie da się powiedzieć.', feedback: 'Coś jednak wiemy: typ dnia. Niepewność co do następnej świecy nie znaczy, że kontekst jest bezużyteczny.' },
              ],
            },
          ],
          reveal:
            'Cena doszła do 84 850 o 18:39 i do północy ani razu nie wróciła do VWAP: najniżej 84 136, przy VWAP około 83 850. Dzień zamknął się przy szczytach, 84 795. Kto sprzedał przy +2σ z celem na VWAP, celu nie zobaczył.',
        },
      ],
      debrief: {
        points: [
          'Dzień trendu rozpoznasz w trakcie: VWAP nachylony, cena godzinami po jednej jego stronie, cofnięcia płytkie (nie sięgają VWAP), przebite poziomy zmieniają rolę.',
          'Pasma σ mierzą rozrzut cen dnia ważony wolumenem. W równowadze ich krawędzie bywają skrajami zakresu, w trendzie cena potrafi po nich jechać.',
          'Najdroższa transakcja w dniu trendu to kontrariańska transakcja bez unieważnienia. Jeśli już gramy przeciw ruchowi, to małą pozycją i z poziomem, który mówi „myliłem się”.',
        ],
        honest:
          'Laboratorium folkloru desku sprawdza na historii regułę „Z 2σ od VWAP cena wraca” (do VWAP przed dojściem do 4σ). Wynik porównuje z tym, czego oczekiwalibyśmy przy cenie błądzącej losowo.',
      },
    },
    'trend-down': {
      title: 'Odbicie w dniu spadkowym',
      when: 'czw 22.10.2026 · BTC · świece 15 min',
      tagline: 'Po spadku o 2700 USD cena odbija do dolnej krawędzi wartości. Odwrócenie czy test od spodu?',
      intro:
        'Lustro poprzedniego ćwiczenia. Na rycinie: VWAP dnia z pasmami, profil wolumenu dnia, PDH i PDL (szczyt i dołek środy) oraz otwarcia sesji.',
      checkpoints: [
        {
          context:
            'Jest 13:00. W nocy cena zjechała z 84 300, przed 10:00 przebiła PDL 82 613, o 11:00 zrobiła dołek 81 619. Teraz odbiła do 82 172 (1) i stoi przy 82 020: to dolna krawędź obszaru wartości dnia (VAL 82 000). VWAP spada i jest 770 USD wyżej (82 774), cena to −1,1σ.',
          questions: [
            {
              prompt: 'Czy rynek odzyskał wartość?',
              options: [
                { label: 'Tak: odbicie od dołka to odwrócenie trendu.', feedback: 'Jedno odbicie to za mało. Odwrócenie wymaga dowodu: akceptacji z powrotem w obszarze wartości i nad VWAP. Na razie cena tylko dotyka dolnej krawędzi od spodu.' },
                {
                  label: 'Nie: to test od spodu. Odzyskanie wartości to akceptacja w obszarze wartości i nad VWAP, a nie samo dotknięcie VAL.',
                  feedback: 'Tak. Krawędź obszaru wartości, przebita wcześniej w dół, od spodu często działa jak opór. Kontrolę mają sprzedający, dopóki cena nie zostanie z powrotem w środku i nad VWAP.',
                },
                { label: 'Cena jest „tania” (−1σ), więc warto kupić.', feedback: 'W dniu trendu „tanio” potrafi być coraz taniej. Odległość od VWAP w σ nie jest ceną okazyjną, tylko miarą, jak daleko rynek uciekł od średniej.' },
                { label: 'VAL nie ma znaczenia w trakcie dnia.', feedback: 'Profil rozwija się w trakcie dnia i jego krawędzie pokazują, gdzie rynek handlował najchętniej. To ważna mapa, choć nie wyrocznia.' },
              ],
            },
            {
              prompt: 'Ktoś gra kontynuację spadku. Gdzie leży poziom, powyżej którego teza o kontroli sprzedających przestaje mieć sens?',
              pick: {
                hint: 'Wskaż cenę na wykresie: nad nią teza o kontynuacji spadku upada.',
                good: 'Dobrze. Nad szczytem odbicia (82 172), a najpóźniej nad VWAP, sprzedający tracą argument: rynek wraca do wartości. To blisko, więc błąd kosztuje mało.',
                ok: 'Do obrony, ale szeroko. Nad VWAP teza na pewno upada, tylko że ryzyko jest dużo większe niż potrzeba: szczyt odbicia mówi to samo wcześniej.',
                tight: 'Za ciasno. Pod szczytem odbicia to zwykły szum: taki poziom zbije pierwsze wahnięcie, zanim rynek powie cokolwiek o tezie.',
                wide: 'Za szeroko. Tak daleko nad VWAP nie zostaje już nic z logiki „sprzedający kontrolują dzień”, a ryzyko rośnie kilkukrotnie.',
              },
            },
          ],
          reveal: 'Cena nie przebiła już 82 172 (najwyżej 82 100). Po otwarciu Nowego Jorku spadła dalej i o 18:53 zrobiła dołek 80 911. VWAP nie został odzyskany do końca okna, zamknięcie 81 381.',
        },
      ],
      debrief: {
        points: [
          'Dzień trendu w dół wygląda jak lustro wzrostowego: VWAP opada, odbicia nie sięgają VWAP, przebity PDL przestaje być wsparciem.',
          'Profil dnia rozwija się za ceną. Jego dolna krawędź (VAL), przebita w dół, od spodu często zatrzymuje odbicia.',
          'Unieważnienie dla kontynuacji leży nad szczytem odbicia albo nad VWAP. Kupowanie „taniego” −1σ w dniu trendu to łapanie noża bez punktu wyjścia.',
        ],
        honest: 'Laboratorium folkloru desku sprawdza na historii regułę „Zebranie PDL → powrót” (po dotknięciu PDL cena wraca do środka wczorajszego zakresu). Tego dnia nie wróciła.',
      },
      zoneLabels: ['logiczne unieważnienie'],
    },
    'balance-day': {
      title: 'Dzień równowagi: wybicia bez akceptacji',
      when: 'pt 23.10.2026 · BTC · świece 5 min',
      tagline: 'Skok w górę na otwarciu NY, potem zrzut pod obszar wartości. Zmiana typu dnia czy dwa fałszywe wybicia?',
      intro:
        'Piątek. Na rycinie: VWAP z pasmami, profil wolumenu dnia, otwarcia sesji i initial balance Nowego Jorku (zakres pierwszej godziny sesji, z rozszerzeniami 1,5× i 2×), widoczny po jej zakończeniu. PDH i PDL są daleko poza zakresem.',
      checkpoints: [
        {
          context:
            'Jest 16:10. Od rana VWAP stoi w miejscu (81 600–81 700), a cena przechodziła przez niego wiele razy. Na otwarciu NY skok do 82 088 (1), nad górną krawędź obszaru wartości (VAH 82 020), ale po dziesięciu minutach cena jest z powrotem w środku, przy 81 890.',
          questions: [
            {
              prompt: 'Jaki to dzień?',
              options: [
                { label: 'Równowaga: płaski VWAP, wiele przejść ceny przez niego, wąski obszar wartości; skok nad VAH szybko wrócił do środka.', feedback: 'Tak. W równowadze krawędzie częściej odrzucają cenę, niż ją przepuszczają. Szybki powrót spod 82 088 to odrzucenie, a nie akceptacja.' },
                { label: 'Trend wzrostowy: właśnie padł szczyt dnia.', feedback: 'Szczyt dnia padł, ale nie został utrzymany. Trend zostawia VWAP za sobą; tu cena wróciła do niego w kilkanaście minut.' },
                { label: 'Trend spadkowy: cena właśnie spada.', feedback: 'Dziesięć minut spadku po skoku to za mało. Cena wróciła do środka obszaru wartości, a nie pod niego.' },
                { label: 'Za wcześnie, żeby cokolwiek powiedzieć.', feedback: 'Za wcześnie na pewność, ale nie na hipotezę. Hipoteza „równowaga” daje plan: patrzeć, czy krawędzie odrzucają cenę.' },
              ],
            },
          ],
          reveal: 'O 16:15 cena zjeżdża z 81 890 do 81 106 (2) w dziesięć minut, pod dolną krawędź obszaru wartości (VAL około 81 500). Initial balance Nowego Jorku jest już kompletny: 81 106–82 088.',
        },
        {
          context: 'Jest 16:30. W dwadzieścia minut cena przeszła od szczytu dnia do dołka dnia. Teraz odbija i stoi przy 81 470, pod VAL.',
          questions: [
            {
              prompt: 'Czy typ dnia właśnie się zmienił?',
              options: [
                { label: 'Tak, to początek trendu w dół.', feedback: 'Jedna gwałtowna świeca nie robi trendu. Trend potrzebuje akceptacji: ceny, która zostaje pod VAL i pod VWAP, i profilu, który zaczyna budować się niżej.' },
                {
                  label: 'Na razie to wyjście pod wartość bez akceptacji. Hipoteza równowagi jest zagrożona; rozstrzygnie to, czy cena zostanie pod VAL, czy wróci do środka.',
                  feedback: 'Tak. Akceptacja to czas i wolumen po drugiej stronie krawędzi; odrzucenie to szybki powrót. Plan „patrzę na akceptację” działa w obie strony i chroni przed graniem pierwszego wrażenia.',
                },
                { label: 'Kupuję, bo w równowadze cena zawsze wraca.', feedback: '„Zawsze” to słowo, które kosztuje najwięcej. W równowadze powroty są częstsze, ale dzień równowagi może w każdej chwili zamienić się w trend.' },
                { label: 'Sprzedaję na odbiciu do VAL bez stopu, bo dzień jest słaby.', feedback: 'Sprzedaż bez unieważnienia to brak planu. Nawet trafna teza bez poziomu „myliłem się” kończy się źle przy pierwszym gwałtownym ruchu.' },
              ],
            },
          ],
          reveal:
            'Cena wróciła do środka: do 18:30 doszła do 81 932, a do końca dnia nie wyszła już poza initial balance (najwyżej 81 932, najniżej 81 238). VWAP został płaski, zamknięcie 81 407. Oba wybicia z IB okazały się fałszywe.',
        },
      ],
      debrief: {
        points: [
          'Równowaga: płaski VWAP, cena krąży wokół niego, obszar wartości wąski. W takim dniu krawędzie (VAH, VAL, pasma σ, IB) częściej odrzucają, niż przepuszczają, ale nie zawsze.',
          'Akceptacja kontra odrzucenie: odrzucenie to szybki powrót, akceptacja to cena, która zostaje po drugiej stronie (kilka świec, wolumen, profil budujący się na nowym poziomie).',
          'Initial balance Nowego Jorku objął oba gwałtowne ruchy, a reszta dnia została w jego środku. IB to mapa: pokazuje, gdzie rynek już raz odrzucił cenę.',
        ],
        honest:
          'Laboratorium folkloru desku sprawdza na historii regułę „Wybicie IB jedzie dalej” (dla IB pierwszej godziny doby UTC). To inna definicja IB niż na rycinie, ale ta sama idea.',
      },
    },
    'liq-cascade': {
      title: 'Kaskada likwidacji i kto kupuje odbicie',
      when: 'sob 24.10.2026 · BTC · świece 5 min',
      tagline: '45 mln USD zlikwidowanych longów pod wczorajszym dołkiem, potem odbicie. Kto za nim stoi?',
      intro:
        'Sobota. Na rycinie: VWAP z pasmami, PDH i PDL (szczyt i dołek piątku), koła likwidacji (pole koła według kwoty), a w panelach pod ceną CVD i open interest z taśmy, którą desk nagrywa od 18:25.',
      checkpoints: [
        {
          context:
            'Jest 17:30. Spokojny dzień (VWAP około 80 760) skończył się o 16:15: cena zeszła pod PDL 80 500 i uruchomiła likwidacje longów, 17,7 mln USD w jednej świecy (1). Po krótkim odbiciu druga fala, 14,3 mln o 17:10 (2), i dołek 79 184. Razem od 16:15 około 45 mln USD zlikwidowanych longów. Cena jest 1,65σ pod VWAP.',
          questions: [
            {
              prompt: 'Co robisz z tą informacją?',
              options: [
                { label: 'Kupuję od razu: po takiej kaskadzie zawsze jest odbicie.', feedback: 'Kaskady często kończą się odbiciem, ale nie wiadomo, po której fali. Wejście w środku kaskady bez unieważnienia to zgadywanie, gdzie skończy się przymusowa sprzedaż.' },
                {
                  label: 'Czekam na znak, że przymusowa sprzedaż się kończy (mniejsze likwidacje, brak nowych dołków, powrót nad poziom). Plan dopiero wtedy, z unieważnieniem pod dołkiem 79 184.',
                  feedback: 'Tak. Likwidacje to sprzedaż przymusowa, a nie decyzja kogoś, kto wie więcej. Kiedy się kończą, ruch często traci paliwo. Wiemy też, gdzie jest błąd: nowy dołek pod 79 184.',
                },
                { label: 'Sprzedaję, bo trend jest silny: dołączam do kaskady.', feedback: 'Dołączanie po 45 mln likwidacji to sprzedaż na samym dole fali, z unieważnieniem daleko nad ceną. Kierunek dnia rozpoznany, lokalizacja najgorsza z możliwych.' },
                { label: 'Ignoruję likwidacje, to szum.', feedback: 'Likwidacje to bardzo konkretna informacja: kto musiał wyjść i gdzie. Nie mówią, co będzie dalej, ale opisują, skąd wziął się ruch.' },
              ],
            },
          ],
          reveal:
            'Kolejnych dużych likwidacji już nie było, a nowego dołka też nie. Od 17:45 cena wraca, około 18:50 jest z powrotem nad VWAP. Od 18:25 desk nagrywa taśmę, więc w panelach pojawiają się CVD i open interest.',
        },
        {
          context: 'Jest 20:15. Cena 80 330, nad VWAP (80 124). W ostatnim kwadransie agresywne kupno przeważało o prawie 500 BTC (CVD rośnie), a open interest spadł o ponad 600 BTC (3).',
          questions: [
            {
              prompt: 'Cena rośnie, delta mocno dodatnia, open interest spada. Kto najpewniej kupuje?',
              options: [
                { label: 'Nowi kupujący otwierają longi.', feedback: 'Nowe longi zwiększałyby open interest. Tu open interest spada, więc pozycje są zamykane, a nie otwierane.' },
                { label: 'Shorty zamykają pozycje: odkupują, żeby wyjść.', feedback: 'Tak. Spadek OI przy agresywnym kupnie to najczęściej zamykanie shortów (short covering). Takie wzrosty mają paliwo tylko do chwili, gdy skończą się shorty do zamknięcia; nowego popytu jeszcze nie widać.' },
                { label: 'Market makerzy kupują od sprzedających.', feedback: 'Market makerzy są po drugiej stronie agresorów, czyli tu raczej sprzedają. Delta liczy agresorów: tych, którzy kupują po cenie ofert.' },
                { label: 'Nie da się tego powiedzieć bez adresów.', feedback: 'Pewności nie ma, bo każdą transakcję zamykają dwie strony. Ale zestaw „cena w górę, agresywne kupno, OI w dół” ma jedno najbardziej prawdopodobne wyjaśnienie.' },
              ],
            },
          ],
          reveal:
            'O 20:45 jeszcze jeden skok: delta +534 BTC, open interest −387 BTC, szczyt 80 628, czyli z powrotem nad PDL. Potem dwie godziny stania w miejscu przy małym wolumenie. O 23:00 cena spada do 80 259 (4) z deltą −443 i rosnącym open interest: to nowe shorty.',
        },
      ],
      debrief: {
        points: [
          'Cztery ćwiartki ceny i open interest: cena ↑ i OI ↑ to nowe longi; cena ↑ i OI ↓ to zamykanie shortów; cena ↓ i OI ↑ to nowe shorty; cena ↓ i OI ↓ to zamykanie longów, w skrajnym przypadku likwidacje.',
          'Kaskada likwidacji to sprzedaż przymusowa. Kończy się, gdy skończą się pozycje z dźwignią w zasięgu ceny; potem ruch często traci paliwo.',
          'Odbicie po kaskadzie było w dużej części zamykaniem shortów (OI spadł o ponad 1000 BTC, gdy cena rosła). Wzrost na zamykaniu shortów nie jest tym samym, co nowy popyt.',
          'Przebity poziom (PDL 80 500) odzyskany wieczorem to informacja, ale nie gwarancja: o 23:00 nowe shorty sprowadziły cenę pod niego.',
        ],
        honest:
          'To jedna sytuacja. Taśma likwidacji w publicznych danych desku zaczyna się 24.10, więc reguł o kaskadach nie da się jeszcze rzetelnie sprawdzić na historii. Ćwiczenie uczy czytania przepływu, a nie przewidywania.',
      },
    },
    'footprint-zone': {
      title: 'Footprint: strefa nierównowagi, która nie wytrzymała',
      when: 'sob 24.10.2026 · BTC · footprint 15 min',
      tagline: 'Agresywne kupno przez dziewięć poziomów ceny. Wsparcie na pewno? Czytamy komórka po komórce.',
      intro:
        'Ten sam wieczór co w ćwiczeniu o kaskadzie, w powiększeniu. W każdej świecy: lewa kolumna to sprzedaż agresorów (zlecenia rynkowe uderzające w bid), prawa to kupno agresorów (zdejmujące ask), liczby w BTC, wiersze co 20 USD. Ramka to POC świecy, pasek przy krawędzi kafla to nierównowaga 3:1 po przekątnej. Pod świecami: delta, wolumen i zmiana open interest.',
      checkpoints: [
        {
          context:
            'Jest 21:00. Świeca 20:45 (1) poszła z 80 326 do 80 628: delta +534 BTC, wolumen 669 BTC, POC 80 460, nierównowagi kupna na dziewięciu poziomach od 80 360 do 80 620, w tym cztery z rzędu 80 420–80 480. Open interest w tej świecy spadł o 387 BTC.',
          questions: [
            {
              prompt: 'Co mówi świeca 20:45?',
              options: [
                { label: 'Kupujący przejęli kontrolę; strefa 80 420–80 480 na pewno utrzyma cenę.', feedback: '„Na pewno” to za dużo. Strefa nierównowagi mówi, gdzie kupujący byli agresywni, a nie gdzie będą bronić ceny w przyszłości.' },
                {
                  label: 'Agresywne kupno przez wiele poziomów, ale OI spada o 387 BTC: dużo w tym zamykania shortów. To opis tego, co się stało, a nie obietnica.',
                  feedback: 'Tak. Footprint pokazuje, kto był agresywny i na jakich cenach. Spadek OI dodaje kontekst: część tej agresji to wychodzenie z pozycji, nie nowe przekonanie.',
                },
                { label: 'To absorpcja: sprzedający wchłaniają kupno.', feedback: 'Absorpcja wyglądałaby inaczej: duże kupno, a cena stoi w miejscu. Tu cena przeszła 300 USD w górę, więc kupno nie zostało wchłonięte.' },
                { label: 'Delta +534 to sygnał kupna.', feedback: 'Delta opisuje przeszłą świecę. Sama w sobie nie mówi, co zrobi następna.' },
              ],
            },
            {
              prompt: 'Jeśli kupujący z tej świecy mają rację, którego poziomu nie powinni oddać? Wskaż cenę, której przełamanie unieważnia ich przewagę.',
              pick: {
                hint: 'Wskaż cenę na footprincie: pod nią przewaga kupujących ze świecy 20:45 traci sens.',
                good: 'Dobrze. Dół świecy i serii nierównowag (80 320–80 460): jeśli cena wraca pod miejsce, gdzie kupujący byli najbardziej agresywni, ich przewaga przestaje istnieć.',
                ok: 'Do obrony, ale szeroko. Pod strefą ze świecy 20:00 przewaga na pewno upada, tylko że ryzyko jest większe niż potrzeba.',
                tight: 'Za ciasno. To górna połowa świecy, gdzie zwykłe wahania po skoku zbiją poziom bez żadnej informacji.',
                wide: 'Za szeroko. Tak daleko pod świecą nie zostaje już nic z logiki tej świecy, a ryzyko rośnie kilkukrotnie.',
              },
            },
          ],
          reveal:
            'O 21:00 na szczycie pojawiają się nierównowagi sprzedaży (80 480–80 540), potem dwie godziny stania z wolumenem 74–144 BTC na świecę. O 23:00 jedna świeca przecina obie strefy kupna, z 20:00 i z 20:45 (2): delta −443 BTC, nierównowagi sprzedaży od 80 260 do 80 420, open interest +103 BTC, dołek 80 259.',
        },
      ],
      debrief: {
        points: [
          'Jak czytać komórkę: lewa liczba to sprzedaż agresorów, prawa to kupno agresorów na danym poziomie ceny. Nierównowaga po przekątnej: kupno na poziomie co najmniej 3 razy większe niż sprzedaż poziom niżej (i odwrotnie).',
          'Świeca 20:45 pokazała agresję kupujących przez dziewięć poziomów, ale spadek OI o 387 BTC mówi, że duża część to zamykanie shortów.',
          'Po skoku: sprzedający na szczycie i gasnący wolumen. O 23:00 jedna świeca z nowymi shortami (OI rośnie) przecięła obie strefy.',
          'Strefa nierównowagi to opis przeszłości, a nie wsparcie z gwarancją. Użyteczna jest jako mapa: tam, gdzie była agresja, łatwo sprawdzić, czy wciąż jest.',
        ],
        honest:
          'Uczciwie o footprincie: w testach na danych historycznych, które robiliśmy przy budowie desku, same nierównowagi, ich serie, absorpcja ani dywergencje CVD nie dawały przewagi po kosztach. Dlatego uczymy ich jako kontekstu i potwierdzenia tego, co mówi lokalizacja, a nie jako sygnałów.',
      },
      zoneLabels: ['logiczne unieważnienie', 'nierównowagi kupna z 20:45'],
    },
  },
  atlas: {
    intro:
      'Każdy wskaźnik z zakładki Wykresy: co to jest, jak go liczymy, jak go czytać, gdzie się na nim łatwo pomylić i z czym go łączyć. Ryciny pochodzą z tych samych wycinków co ćwiczenia.',
    groups: { price: 'Cena i wartość', flow: 'Przepływ: kto jest agresywny', book: 'Arkusz i płynność', context: 'Pozycje i dźwignia' },
    labels: { what: 'Co to jest', how: 'Jak liczymy', read: 'Jak czytać', traps: 'Pułapki', combine: 'Z czym łączyć', where: 'Na Wykresach' },
    entries: [
      {
        id: 'vwap',
        name: 'VWAP dnia i pasma σ',
        group: 'price',
        what: 'Średnia cena dnia ważona wolumenem: ile średnio zapłacił każdy, kto dziś handlował.',
        how: 'Od 00:00 UTC cena typowa świecy (H+L+C)/3 ważona wolumenem; pasma to ±1σ i ±2σ, odchylenie standardowe ceny od VWAP ważone wolumenem. VWAP sesji liczy to samo od otwarcia Azji, Londynu albo Nowego Jorku.',
        read: [
          'Nachylenie mówi o typie dnia: płaski VWAP to równowaga, nachylony to trend.',
          'Cena nad VWAP: kupujący dnia są średnio na plusie; pod VWAP: na minusie.',
          'W równowadze krawędzie pasm bywają skrajami zakresu; w trendzie cena potrafi jechać po paśmie +1σ…+2σ.',
        ],
        traps: ['Pasmo ±2σ to nie sygnał odwrócenia: w dniu trendu „drogo” robi się coraz drożej.', 'Rano, przy małej liczbie świec, pasma są wąskie i łatwo je przebić.'],
        combine: ['Z profilem: VWAP przy POC to zgoda co do wartości dnia.', 'Z przepływem: utrzymanie VWAP przy agresywnej sprzedaży mówi więcej niż samo dotknięcie.'],
        where: 'Wskaźniki → VWAP dnia, Pasma VWAP ±1σ i ±2σ, VWAP sesji',
        station: 'start',
        figure: { slice: '2026-10-21-trend', layers: { vwap: true, bands: true }, caption: 'Środa 21.10: dzień trendu. VWAP rośnie, cena godzinami jedzie po paśmie +1σ…+2σ.' },
      },
      {
        id: 'profile',
        name: 'Profil wolumenu: POC, VAH, VAL',
        group: 'price',
        what: 'Ile handlowano na każdej cenie: mapa miejsc, które rynek uznał za uczciwe, i miejsc, przez które przeleciał.',
        how: 'Wolumen każdej świecy rozkładamy na jej zakres (świece w całości nagrane z taśmy: dokładnie po cenach transakcji). POC to wiersz z największym wolumenem; obszar wartości (VAH–VAL) to 70% wolumenu wokół POC.',
        read: [
          'Cena w obszarze wartości: rynek akceptuje te ceny. Poza nim: albo szybki powrót (odrzucenie), albo budowa nowej wartości (akceptacja).',
          'Gruby, symetryczny profil to równowaga; wydłużony i cienki to trend.',
          'Krawędź przebita w jedną stronę często działa od drugiej strony (VAL od spodu jako opór).',
        ],
        traps: ['Profil zależy od zakresu: widoczny zakres, sesja i doba dają różne POC.', 'POC to nie magnes z gwarancją: wraca się do niego często, bo zwykle leży blisko bieżącej ceny.'],
        combine: ['Z VWAP i poziomami dnia: zbieg kilku poziomów to mocniejsza mapa.', 'Z przepływem na krawędzi: czy przy VAH agresywne kupno przechodzi, czy jest wchłaniane.'],
        where: 'Wskaźniki → Profil wolumenu, Profile sesji i nagie POC, Rozwijający się POC i value area',
        station: 'auction',
        figure: { slice: '2026-10-23-balance', layers: { vwap: true, profile: true }, caption: 'Piątek 23.10: dzień równowagi. Wąski obszar wartości, POC tuż przy płaskim VWAP.' },
      },
      {
        id: 'devpoc',
        name: 'Profile sesji, nagie POC i rozwijający się POC',
        group: 'price',
        what: 'Profil każdej sesji osobno, POC, do których cena już nie wróciła, i POC liczony świeca po świecy.',
        how: 'Profil każdej sesji (Azja, Londyn, Nowy Jork) albo doby od jej początku. Nagi POC: POC zamkniętego okresu, którego cena potem nie dotknęła, ciągnięty do prawej krawędzi. Rozwijający się POC i obszar wartości: stan od początku okresu w każdej chwili.',
        read: ['Przesuwanie się rozwijającego się POC za ceną to migracja wartości (trend); POC stojący w miejscu to równowaga.', 'Nagie POC pokazują, gdzie rynek handlował dużo, a potem odszedł i nie wrócił.'],
        traps: ['Nagi POC to miejsce, a nie cel: częste powroty to w dużej mierze geometria (POC zwykle leży blisko ceny).'],
        combine: ['Z sesjami: POC Londynu kontra cena po otwarciu Nowego Jorku.', 'Z poziomami dnia: nagi POC przy PDH albo PDL.'],
        where: 'Wskaźniki → Profile sesji i nagie POC, Rozwijający się POC i value area',
        station: 'auction',
      },
      {
        id: 'tpo',
        name: 'TPO: profil czasowy',
        group: 'price',
        what: 'Profil czasu zamiast wolumenu: jak długo rynek przebywał na każdej cenie.',
        how: 'Doba UTC dzielona na 30-minutowe okresy oznaczone literami; każdy wiersz ceny dostaje literę każdego okresu, którego zakres go dotknął. Do tego POC, obszar wartości, initial balance (dwa pierwsze okresy), pojedyncze wydruki i ogony.',
        read: ['Pojedyncze wydruki (jedna litera) to szybki przelot ceny: miejsca bez akceptacji.', 'Długie ogony na skraju dnia to odrzucenie ceny.'],
        traps: ['Czas to nie wolumen: cena może długo stać przy małym obrocie.'],
        combine: ['Z profilem wolumenu: zgodny POC czasu i wolumenu to mocna wartość.', 'Z IB: wyjście z IB i budowa liter poza nim to akceptacja.'],
        where: 'Wskaźniki → TPO — profil czasowy doby',
        station: 'auction',
      },
      {
        id: 'levels',
        name: 'Poziomy dnia: PDH, PDL, otwarcie',
        group: 'price',
        what: 'Szczyt i dołek poprzedniego dnia UTC oraz otwarcie dnia: punkty, które widzi każdy uczestnik rynku.',
        how: 'Ze świec dziennych Hyperliquid: PDH i PDL to szczyt i dołek poprzedniej doby UTC, otwarcie to cena o 00:00 UTC.',
        read: ['Przebicie i akceptacja po drugiej stronie zmienia rolę poziomu (PDH staje się wsparciem).', 'Przebicie i szybki powrót to odrzucenie: pierwsze ostrzeżenie dla wybicia.'],
        traps: ['Samo dotknięcie poziomu nic nie znaczy. Pod PDL i nad PDH często stoją stopy, więc ruch bywa gwałtowny w obie strony.'],
        combine: ['Z likwidacjami: przebity PDL potrafi uruchomić kaskadę.', 'Z profilem i VWAP: poziom dnia przy krawędzi wartości jest ważniejszy.'],
        where: 'Wskaźniki → Poziomy dnia',
        station: 'start',
        figure: { slice: '2026-10-20-ny', layers: { levels: true, vwap: true, sessions: true }, caption: 'Wtorek 20.10: rano cena pod PDL, po otwarciu Nowego Jorku przebicie PDH i szybki powrót pod niego.' },
      },
      {
        id: 'sessions',
        name: 'Otwarcia sesji',
        group: 'price',
        what: 'Chwile, w których do rynku wchodzą nowi uczestnicy: Azja, Londyn, Nowy Jork.',
        how: 'Azja od 00:00 UTC, Londyn od 08:00 czasu londyńskiego, Nowy Jork od 09:30 czasu nowojorskiego (otwarcie giełdy kasowej), z czasem letnim liczonym automatycznie. Sesja trwa do otwarcia następnej.',
        read: ['Zmienność i wolumen rosną po otwarciach, szczególnie Nowego Jorku.', 'Rano często zapada typ dnia; otwarcie Nowego Jorku potrafi go zmienić.'],
        traps: ['Otwarcie to nie kierunek: ruch po otwarciu bywa w obie strony i często jest szybko oddawany.'],
        combine: ['Z IB: zakres pierwszej godziny sesji jako mapa dnia.', 'Z VWAP sesji: czy nowa sesja handluje nad czy pod ceną poprzedniej.'],
        where: 'Wskaźniki → Otwarcia sesji',
        station: 'start',
      },
      {
        id: 'ib',
        name: 'Initial balance (IB)',
        group: 'price',
        what: 'Zakres pierwszej godziny sesji: gdzie rynek ustalił pierwsze granice.',
        how: 'Szczyt i dołek świec z pierwszej godziny każdej sesji, a po jej zakończeniu rozszerzenia 1,5× i 2× zakresu nad szczytem i pod dołkiem.',
        read: ['Wyjście z IB i akceptacja poza nim to rozszerzenie zakresu (dzień kierunkowy).', 'Odrzucenie obu krawędzi to dzień w zakresie.'],
        traps: ['Na BTC sesje nie mają prawdziwego otwarcia jak giełda: IB bywa bardzo szeroki (cały ruch w pierwszej godzinie) albo bardzo wąski.'],
        combine: ['Z profilem: krawędź IB przy VAH albo VAL to mocniejsza granica.', 'Z przepływem: wybicie z IB z agresją i rosnącym OI kontra wybicie bez nich.'],
        where: 'Wskaźniki → Initial balance',
        station: 'auction',
        figure: { slice: '2026-10-23-balance', layers: { ib: 'ny', sessions: true, vwap: true }, caption: 'Piątek 23.10: IB Nowego Jorku objął skok w górę i zrzut w dół; reszta dnia została w środku.' },
      },
      {
        id: 'footprint',
        name: 'Footprint: Bid × Ask, Delta, Wolumen',
        group: 'flow',
        what: 'Wnętrze świecy: ile kupili i sprzedali agresorzy na każdym poziomie ceny.',
        how: 'Z taśmy transakcji Hyperliquid nagrywanej przez desk: każda transakcja ma stronę agresora (kupno zdejmujące ask albo sprzedaż uderzająca w bid). Styl Bid × Ask pokazuje obie liczby, Delta ich różnicę, Wolumen sumę. Świece bez pełnej taśmy są oznaczone jako częściowe.',
        read: [
          'Gdzie był wolumen świecy (POC w ramce): na dole, w środku, na górze.',
          'Kto był agresywny na skrajach: kupno na szczycie wzrostowej świecy kontra sprzedaż, która je zatrzymała.',
          'Puste lub małe komórki na skraju świecy (brak handlu po jednej stronie) to zakończona aukcja; obie strony na skraju to aukcja niedokończona.',
        ],
        traps: ['Footprint opisuje przeszłość świecy. Bez lokalizacji (poziomy, profil, VWAP) łatwo w nim zobaczyć wszystko.', 'Historia taśmy sięga tylko tak daleko, jak nagranie desku.'],
        combine: ['Z open interest: agresja z rosnącym OI to nowe pozycje, ze spadającym to zamykanie.', 'Z poziomami: footprint na krawędzi wartości mówi więcej niż w środku zakresu.'],
        where: 'Widok Footprint i styl Bid × Ask, Delta, Wolumen nad wykresem',
        station: 'scalp',
        figure: { slice: '2026-10-24-footprint', view: 'footprint', layers: {}, caption: 'Sobota 24.10, 20:00–23:30: skok z agresywnym kupnem i spadkiem OI, potem gasnący wolumen i świeca z nowymi shortami.' },
      },
      {
        id: 'imbalance',
        name: 'Nierównowagi, strefy i niedokończone aukcje',
        group: 'flow',
        what: 'Miejsca, w których jedna strona wyraźnie przeważała, i skraje świec, na których aukcja się nie skończyła.',
        how: 'Nierównowaga po przekątnej: kupno na poziomie co najmniej 3× większe niż sprzedaż poziom niżej (sprzedaż: 3× kupno poziom wyżej), od progu wartości. Strefa: seria co najmniej 3 takich wierszy, ciągnięta w prawo, aż cena przez nią przejdzie. Niedokończona aukcja: szczyt albo dołek świecy z handlem po obu stronach, do powrotu ceny.',
        read: ['Seria nierównowag pokazuje, gdzie agresja przeszła przez kilka poziomów naraz.', 'Niedokończona aukcja to poziom, do którego rynek często wraca, żeby „dokończyć” handel.'],
        traps: ['Strefa nierównowagi to nie wsparcie z gwarancją (ćwiczenie z footprintem).', 'W naszych testach same nierównowagi i ich serie nie dawały przewagi po kosztach.'],
        combine: ['Z open interest i lokalizacją: strefa przy krawędzi wartości z rosnącym OI to mocniejszy kontekst niż strefa w środku zakresu.'],
        where: 'Wskaźniki → Strefy nierównowagi, Niedokończone aukcje; próg w ustawieniach footprintu',
        station: 'scalp',
      },
      {
        id: 'delta',
        name: 'Delta agresorów',
        group: 'flow',
        what: 'Różnica między agresywnym kupnem a agresywną sprzedażą w świecy.',
        how: 'Suma wolumenu transakcji, w których agresorem był kupujący, minus suma tych, w których był sprzedający, z taśmy Hyperliquid (w BTC).',
        read: ['Delta zgodna z kierunkiem świecy to ruch z agresją; przeciwna to ruch bez niej (np. cena rośnie, bo sprzedający się wycofali).', 'Duża delta bez ruchu ceny to wchłanianie przez zlecenia oczekujące.'],
        traps: ['Delta opisuje świecę, a nie przyszłość.', 'Każda transakcja ma kupującego i sprzedającego; delta mówi tylko, kto był niecierpliwy.'],
        combine: ['Z open interest: czy agresja otwiera, czy zamyka pozycje.', 'Z poziomem: delta przy teście krawędzi.'],
        where: 'Panel Delta pod wykresem',
        station: 'start',
        figure: { slice: '2026-10-24-cascade', layers: { delta: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Sobota 24.10: delta od początku nagrania taśmy (18:25). Wcześniej panel jest kreskowany.' },
      },
      {
        id: 'cvd',
        name: 'CVD: skumulowana delta',
        group: 'flow',
        what: 'Suma delt od początku okresu: kierunek agresji w czasie.',
        how: 'Delta kolejnych świec dodawana od resetu (sesja, doba UTC, tydzień albo bez resetu). Na Wykresach do tego CVD giełd: Hyperliquid, Binance (perp i spot) i Bybit, liczone w przeglądarce czytelnika.',
        read: ['Cena i CVD w jednym kierunku: ruch z agresją. Rozjazd (dywergencja): ruch bez agresji albo agresja wchłaniana.', 'CVD giełd mówi, czy Hyperliquid idzie razem z większymi rynkami.'],
        traps: ['Dywergencje CVD wyglądają przekonująco na wykresie, ale w naszych testach nie dawały przewagi po kosztach.', 'Kształt CVD zależy od miejsca resetu.'],
        combine: ['Z open interest i ceną (cztery ćwiartki z ćwiczenia o kaskadzie).', 'Z panelami giełd: zgoda HL, Binance i Bybit wzmacnia odczyt.'],
        where: 'Panel CVD pod wykresem; reset w ustawieniach; Wskaźniki → CVD giełd',
        station: 'venues',
        figure: { slice: '2026-10-24-cascade', layers: { cvd: true, oi: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Sobota 24.10: CVD rośnie razem z ceną, a open interest spada. Zamykanie shortów.' },
      },
      {
        id: 'bubbles',
        name: 'Bąble zleceń agresora',
        group: 'flow',
        what: 'Duże zlecenia rynkowe jako koła na wykresie: kto uderzył dużą wielkością i gdzie.',
        how: 'Wypełnienia jednego zlecenia agresora łączymy dokładnie (ten sam biorca i hash transakcji). Bąbel od progu, który dobiera się do rynku (wysoki kwantyl wartości zleceń z ostatniej godziny); pole koła według wartości, podwójny pierścień to bitwa z jednym dużym makerem.',
        read: ['Seria dużych bąbli na poziomie, a cena stoi: ktoś po drugiej stronie wchłania.', 'Duży bąbel na wybiciu z rosnącym OI: nowa pozycja, a nie zamknięcie.'],
        traps: ['Jedno duże zlecenie to jeszcze nie trend; często to zamknięcie pozycji albo zabezpieczenie.'],
        combine: ['Z taśmą i DOM: co stało w arkuszu, zanim przyszło zlecenie.', 'Z wielorybami: czy duże konta się ruszają.'],
        where: 'Wskaźniki → Bąble zleceń agresora',
        station: 'scalp',
      },
      {
        id: 'clashes',
        name: 'Serie, ściany i góry lodowe',
        group: 'flow',
        what: 'Zderzenia uczestników policzone z publicznych danych transakcji, bez zgadywania.',
        how: 'Seria: drobne zlecenia co najmniej 4 różnych biorców po jednej stronie w 2 sekundy, razem od progu. Ściana: jeden maker na jednej cenie przyjął od progu z co najmniej 3 zleceń. Góra lodowa: ściana, która przyjęła co najmniej 2× więcej, niż cały poziom kiedykolwiek pokazywał w arkuszu (zlecenie odnawiane po każdym wypełnieniu).',
        read: ['Ściana na poziomie, przy którym cena się zatrzymała, wyjaśnia, dlaczego się zatrzymała.', 'Góra lodowa to ukryta płynność: arkusz pokazywał mniej, niż naprawdę stało.'],
        traps: ['Ściana może zniknąć w każdej chwili; to opis tego, co się stało, a nie obietnica.'],
        combine: ['Z mapą ciepła i DOM: widoczna płynność kontra wchłonięta naprawdę.'],
        where: 'Wskaźniki → Serie i ściany',
        station: 'scalp',
      },
      {
        id: 'tape',
        name: 'Taśma zleceń (Time & Sales)',
        group: 'flow',
        what: 'Lista transakcji na bieżąco: czas, cena, wielkość, strona agresora.',
        how: 'Transakcje z WebSocketu Hyperliquid z filtrem wartości (USD) i opcjonalnym dźwiękiem dużych zleceń.',
        read: ['Tempo taśmy mówi o pilności: przyspieszenie przy poziomie to walka o ten poziom.', 'Duże wydruki po jednej stronie bez ruchu ceny to wchłanianie.'],
        traps: ['Taśma kusi do reagowania na każdy wydruk. Bez planu to głównie szum.'],
        combine: ['Z DOM: kto zdejmuje płynność i czy arkusz ją odnawia.'],
        where: 'Wskaźniki → Taśma zleceń; na telefonie zakładka Taśma',
        station: 'scalp',
      },
      {
        id: 'venues',
        name: 'Panele giełd i Tablica liczb',
        group: 'flow',
        what: 'Ten sam rynek na trzech giełdach: CVD, zmiana OI i finansowanie z Hyperliquid, Binance i Bybit.',
        how: 'Dane Binance i Bybit pobiera przeglądarka czytelnika (domyślnie wyłączone, włączasz w Źródłach); desk ich nie przechowuje. Tablica liczb zbiera statystyki świec w jednym miejscu.',
        read: ['Ruch na Hyperliquid bez potwierdzenia na Binance bywa lokalny i krótkotrwały.', 'Rozjazd finansowania między giełdami pokazuje, gdzie tłoczy się dźwignia.'],
        traps: ['Różne giełdy, różne kontrakty i różni uczestnicy: zgodność to kontekst, nie sygnał.'],
        combine: ['Z CVD i OI na Hyperliquid: czy przepływ jest wspólny dla całego rynku.'],
        where: 'Wskaźniki → CVD giełd, ΔOI giełd; Tablica liczb pod wykresem; stacja Giełdy',
        station: 'venues',
      },
      {
        id: 'heatmap',
        name: 'Mapa ciepła arkusza',
        group: 'book',
        what: 'Zlecenia oczekujące w czasie: gdzie stała płynność i jak się zmieniała.',
        how: 'Migawki arkusza l2Book Hyperliquid (20 poziomów na stronę) w dwóch agregacjach ceny; każda migawka obowiązuje do następnej. Jaśniej = więcej zleceń, białe pasy to ściany. Historia od otwarcia strony, a z zapisu desku z ostatniej doby.',
        read: ['Jasny pas, przy którym cena się zatrzymuje, to płynność, która przyjmuje ruch.', 'Pas, który znika tuż przed dojściem ceny, to zlecenie zdjęte, a nie wypełnione.'],
        traps: ['Zlecenia oczekujące można zdjąć w milisekundę. Widoczna płynność to nie obietnica.', 'Arkusz pokazuje tylko 20 poziomów na stronę.'],
        combine: ['Z bąblami i ścianami: czy płynność została wypełniona, czy zdjęta.', 'Z poziomami: płynność przy PDH albo PDL.'],
        where: 'Wskaźniki → Mapa ciepła arkusza; stacje Skalper i Płynność',
        station: 'liquidity',
      },
      {
        id: 'dom',
        name: 'DOM: drabina arkusza',
        group: 'book',
        what: 'Bieżący arkusz zleceń jako drabina: wielkość na każdej cenie nad i pod ceną.',
        how: 'Najnowsza migawka arkusza przy prawej krawędzi wykresu (aski nad ceną, bidy pod nią), skala pierwiastkowa, żeby jedna ściana nie spłaszczała reszty.',
        read: ['Asymetria najbliższych poziomów mówi, która strona jest cieńsza.', 'Ściana, która stoi, gdy cena do niej dochodzi, jest ważniejsza niż ściana daleko od ceny.'],
        traps: ['DOM zmienia się kilka razy na sekundę; pojedyncze ściany często są stawiane i zdejmowane.'],
        combine: ['Z taśmą: czy agresorzy zjadają ścianę, czy ściana się odnawia.'],
        where: 'Drabina przy mapie ciepła; na telefonie zakładka DOM',
        station: 'scalp',
      },
      {
        id: 'lots',
        name: 'Duże zlecenia w arkuszu',
        group: 'book',
        what: 'Poziomy arkusza z wyjątkowo dużymi zleceniami oczekującymi i czas, przez jaki stały.',
        how: 'Poziom, na którym średnie zlecenie jest w 1% największych z ostatnich 30 minut tego rynku (nie mniej niż ułamek progu dużego zlecenia agresora); linia przez czas obecności w arkuszu, a po 30 s podpis „liczba zleceń × średnia wartość”.',
        read: ['Duże zlecenie, które stoi długo, to czyjś plan; mignięcie na sekundę to często test.'],
        traps: ['Duże zlecenie może być przynętą i zniknąć, zanim cena dojdzie.'],
        combine: ['Ze ścianami: czy duże zlecenie zostało rzeczywiście wypełnione.'],
        where: 'Wskaźniki → Duże zlecenia w arkuszu',
        station: 'liquidity',
      },
      {
        id: 'liq',
        name: 'Likwidacje i klastry likwidacji',
        group: 'context',
        what: 'Przymusowe zamknięcia pozycji z dźwignią: te, które już się wydarzyły, i miejsca, gdzie mogą się wydarzyć.',
        how: 'Klastry na Wykresach to szacunek skanera desku: gdzie leżą ceny likwidacji otwartych pozycji. Koła na rycinach lekcji to likwidacje, które już się wydarzyły (taśma likwidacji desku, w mln USD na świecę).',
        read: ['Kaskada likwidacji to sprzedaż (albo kupno) przymusowa, a nie decyzja kogoś, kto wie więcej.', 'Duży klaster blisko ceny to paliwo: dojście do niego może przyspieszyć ruch.'],
        traps: ['Klaster to szacunek z publicznych pozycji, a nie pewność; pozycje się zmieniają.', 'Koniec kaskady trudno trafić w czasie rzeczywistym.'],
        combine: ['Z poziomami dnia: stopy i likwidacje często leżą tuż za PDH i PDL.', 'Z open interest: kaskada to gwałtowny spadek OI.'],
        where: 'Wskaźniki → Klastry likwidacji; Desk → mapa i taśma likwidacji',
        station: 'liquidity',
        figure: { slice: '2026-10-24-cascade', layers: { liq: true, levels: true, vwap: true }, at: '2026-10-24T17:30Z', caption: 'Sobota 24.10: przebicie PDL 80 500 i dwie fale likwidacji longów, razem około 45 mln USD.' },
      },
      {
        id: 'whales',
        name: 'Wieloryby',
        group: 'context',
        what: 'Największe pozycje i zlecenia oczekujące największych kont Hyperliquid.',
        how: 'Skaner desku czyta publiczny stan największych kont i publikuje go bez adresów: konto ma pseudonim ważny jedną dobę UTC. Na wykresie: cena wejścia (L/S, wartość, dźwignia), cena likwidacji i duże zlecenia, także stop i take profit.',
        read: ['Duże stopy i take profity wielorybów to miejsca, gdzie może pojawić się przepływ.', 'Zmiana pozycji dużego konta to informacja o jego decyzji, a nie o przyszłości ceny.'],
        traps: ['Wieloryb też się myli, a część pozycji to zabezpieczenia innych pozycji.', 'Kopiowanie bez znajomości całego portfela innego gracza to zgadywanie.'],
        combine: ['Z klastrami likwidacji i poziomami: gdzie kilka rzeczy wypada w jednym miejscu.'],
        where: 'Wskaźniki → Wieloryby',
        station: 'liquidity',
      },
      {
        id: 'oi',
        name: 'Open interest i finansowanie',
        group: 'context',
        what: 'Liczba otwartych kontraktów (ile jest pozycji) i stawka, którą płaci tłoczniejsza strona.',
        how: 'Open interest z kontekstu rynku Hyperliquid zapisywanego co minutę razem z taśmą; finansowanie za godzinę z tego samego źródła (na Wykresach też z Binance i Bybit).',
        read: ['Cena ↑ i OI ↑: nowe longi. Cena ↑ i OI ↓: zamykanie shortów. Cena ↓ i OI ↑: nowe shorty. Cena ↓ i OI ↓: zamykanie longów.', 'Skrajne finansowanie pokazuje, która strona jest przepełniona.'],
        traps: ['Każdy kontrakt ma dwie strony; OI mówi ile, ale nie kto ma rację.', 'Skrajne finansowanie potrafi trwać długo.'],
        combine: ['Z deltą i ceną (ćwiczenie o kaskadzie).', 'Z likwidacjami: gwałtowny spadek OI przy ruchu to zamykanie przymusowe.'],
        where: 'Wskaźniki → ΔOI giełd; Tablica liczb',
        station: 'venues',
        figure: { slice: '2026-10-24-cascade', layers: { oi: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Sobota 24.10: odbicie po kaskadzie przy spadającym open interest.' },
      },
    ],
  },
  combine: {
    intro:
      'Żaden wskaźnik nie odpowiada na wszystko. Zawodowcy łączą je według pytań, a nie według liczby linii na ekranie. Te trzy pytania warto zadać przed każdą decyzją, w tej kolejności.',
    questions: [
      { q: 'Gdzie jestem?', tools: 'Typ dnia (VWAP, pasma), wartość (profil, POC, VAH, VAL), poziomy dnia, sesja, IB.', answer: 'Kontekst i lokalizacja: czy cena jest przy krawędzi, w środku zakresu, czy w nowym miejscu.' },
      { q: 'Kto naciska?', tools: 'Footprint, delta, CVD, bąble, taśma, open interest, likwidacje, giełdy.', answer: 'Przepływ: czy agresja otwiera nowe pozycje, zamyka stare, czy jest wchłaniana.' },
      { q: 'Gdzie się mylę?', tools: 'Struktura (dołek, szczyt, krawędź wartości, VWAP), wielkość pozycji z odległości do unieważnienia.', answer: 'Ryzyko: poziom, który mówi „teza upadła”, i strata, którą akceptujesz, zanim wejdziesz.' },
    ],
    rules: [
      'Najpierw lokalizacja, potem przepływ. Footprint w środku zakresu mówi niewiele; ten sam footprint na krawędzi wartości mówi dużo.',
      'Dwa niezależne źródła są lepsze niż pięć zależnych. VWAP, pasma i profil to wszystko cena z wolumenem; open interest i likwidacje to inna informacja.',
      'Każda teza ma swój poziom unieważnienia. Jeśli nie umiesz go wskazać, nie masz tezy, tylko opinię.',
      'Wielkość pozycji liczysz z odległości do unieważnienia i z ryzyka, które akceptujesz. Nigdy odwrotnie.',
      'Oceniaj decyzję po procesie, a nie po wyniku jednej transakcji. Dobra decyzja może przegrać, zła może wygrać.',
    ],
    recipesTitle: 'Gotowe zestawy pytań',
    recipesIntro: 'To nie są sygnały. To zestawy pytań do typowych sytuacji, z miejscem, w którym widać, że się mylisz.',
    recipeLabels: { context: 'Kontekst', flow: 'Przepływ', risk: 'Unieważnienie', against: 'Co przeczy' },
    recipes: [
      {
        name: 'Test krawędzi wartości',
        context: 'Dzień równowagi, cena dochodzi do VAH albo VAL, najlepiej przy innym poziomie (PDH/PDL, krawędź IB).',
        flow: 'Czy agresja na krawędzi przechodzi dalej, czy jest wchłaniana (duża delta bez ruchu, ściany, bąble po jednej stronie bez postępu)?',
        risk: 'Akceptacja po drugiej stronie krawędzi: kilka świec i budowa wolumenu poza obszarem wartości.',
        against: 'Rosnący open interest z agresją w stronę wybicia i cena, która zostaje poza krawędzią.',
      },
      {
        name: 'Cofnięcie w dniu trendu',
        context: 'Nachylony VWAP, cena godzinami po jednej stronie, przebity poziom dnia zmienił rolę.',
        flow: 'Czy na cofnięciu do VWAP, pasma albo przebitego poziomu agresja przeciw trendowi słabnie (mniejsza delta, mniejszy wolumen)?',
        risk: 'Akceptacja po drugiej stronie VWAP albo przebitego poziomu.',
        against: 'Cofnięcie przechodzi przez VWAP z rosnącym wolumenem i open interest po stronie przeciwnej.',
      },
      {
        name: 'Po kaskadzie likwidacji',
        context: 'Przebity ważny poziom, seria dużych likwidacji, cena daleko od VWAP.',
        flow: 'Czy likwidacje maleją, czy cena przestaje robić nowe skraje, czy open interest przestaje gwałtownie spadać?',
        risk: 'Nowy skraj kaskady (dołek albo szczyt).',
        against: 'Kolejne fale likwidacji i nowe pozycje w kierunku kaskady (OI rośnie).',
      },
      {
        name: 'Wybicie z initial balance',
        context: 'Zakończona pierwsza godzina sesji, cena wychodzi poza IB.',
        flow: 'Czy wybicie ma agresję i rosnący open interest (nowe pozycje), czy tylko zamykanie pozycji?',
        risk: 'Powrót do środka IB.',
        against: 'Szybki powrót pod krawędź i agresja po przeciwnej stronie (dzień w zakresie, jak 23.10).',
      },
    ],
  },
  myths: {
    intro:
      'Popularne reguły day tradingu zestawione z historią BTC. Laboratorium folkloru desku liczy, jak często każda reguła się sprawdziła, i porównuje to z tym, czego oczekiwalibyśmy, gdyby cena błądziła losowo. Wyniki odświeżają się co godzinę.',
    how: 'Jak czytać: „sukces” to odsetek zdarzeń, w których reguła się sprawdziła; „losowo” to oczekiwany odsetek przy cenie bez pamięci (dla reguł z dwiema barierami wynika z ich odległości). Liczy się różnica, a nie sam odsetek: reguła, która sprawdza się w 60% przypadków, nie ma przewagi, jeśli losowo wychodzi 60%.',
    columns: { claim: 'Reguła', result: 'Sukces / losowo', n: 'Zdarzenia', verdict: 'Werdykt' },
    footer:
      'Ocena historyczna jest eksploracyjna (wiele reguł naraz, korekta Benjaminiego–Hochberga). Prawdziwy test to ocena do przodu na zdarzeniach po zapisie katalogu reguł w weryfikowalnym dzienniku desku.',
  },
  risk: {
    badge: 'symulacja',
    intro:
      'Ten sam trader z tą samą skutecznością może przetrwać albo zbankrutować: decyduje ryzyko na transakcję. Symulator losuje tysiąc serii transakcji z Twoimi parametrami i pokazuje, jak mogą wyglądać.',
    labels: { winRate: 'Skuteczność', payoff: 'Średni zysk do straty (R)', riskPct: 'Ryzyko na transakcję', trades: 'Liczba transakcji', cost: 'Koszty na transakcję (R)', reset: 'Domyślne' },
    out: {
      expectancy: 'Oczekiwany wynik na transakcję',
      median: 'Mediana kapitału na końcu',
      band: 'Typowy zakres (5–95%)',
      dd20: 'Szansa obsunięcia o 20% lub więcej',
      dd50: 'Szansa obsunięcia o 50% lub więcej',
      streak: 'Typowa najdłuższa seria strat',
      paths: 'Przykładowe ścieżki kapitału (start = 100)',
    },
    lessons: [
      { title: 'Serie strat są normalne', text: 'Przy skuteczności 50% seria 6–8 strat z rzędu w 200 transakcjach to nie pech, tylko statystyka. Plan musi ją przetrwać psychicznie i finansowo.' },
      { title: 'Ryzyko na transakcję decyduje o przetrwaniu', text: 'Ta sama przewaga przy 1% ryzyka daje gładką ścieżkę, a przy 5% głębokie obsunięcia. Po stracie 50% potrzebujesz 100% zysku, żeby wrócić.' },
      { title: 'Bez przewagi koszty zjadają kapitał', text: 'Przy oczekiwanym wyniku 0 R przed kosztami (moneta) opłaty i poślizg sprawiają, że mediana kapitału spada. Przewagę wykaże tylko uczciwy dziennik, a nie kilka udanych transakcji.' },
    ],
    sizeLink: 'Kalkulator wielkości pozycji: zakładka Mikrostruktura',
    planLink: 'Wpisz konkretny plan w Analizatorze planu',
  },
};
