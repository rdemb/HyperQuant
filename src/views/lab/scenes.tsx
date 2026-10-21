import React from 'react';
import { Box, Mountain, Orbit, Sparkles, Waves } from 'lucide-react';
import type { BadgeTone } from '../../ui';

export type SceneId = 'liquidity' | 'vortex' | 'fluid' | 'risk' | 'options';

export interface SceneMeta {
  id: SceneId;
  label: string;
  icon: React.ReactNode;
  /** Pochodzenie danych — znaczniki LIVE / MODEL */
  sources: { tone: BadgeTone; label: string }[];
  what: string;
  how: string[];
  method: string;
  limits: string[];
  /** Scena bez WebGL (płótno 2D) — wysokość według treści */
  autoHeight?: boolean;
}

const ICON = 'w-3.5 h-3.5';

// Opisy scen: co widać, jak czytać, skąd dane i czego scena NIE mówi
export const SCENES: SceneMeta[] = [
  {
    id: 'liquidity',
    label: 'Liquidity Canyon',
    icon: <Box className={ICON} aria-hidden="true" />,
    sources: [
      { tone: 'live', label: 'LIVE' },
      { tone: 'model', label: 'MODEL' },
    ],
    what: 'Ostatnie 36 świec BTC-PERP jako bryły, ściany arkusza L2 Hyperliquid, profil wolumenu po lewej, poziomy dnia i świeże strefy Order Block.',
    how: [
      'Słupki po prawej to 10 najbliższych poziomów arkusza: BID z przodu, ASK z tyłu; wysokość = płynność w USD.',
      'Złote belki to PDH/PDL, fioletowe bloki to strefy OB (krawędź morska = popytowa, pomarańczowa = podażowa).',
      'Najedź na obiekt (na telefonie dotknij), aby zobaczyć wartość.',
    ],
    method: 'Świece i arkusz z API Hyperliquid; strefy OB, profil i trajektoria (Kalman + OU + ważona suma cech) liczone lokalnie.',
    limits: [
      'Trajektoria to heurystyka bez kalibracji — nie prognoza.',
      'Arkusz to migawka 10 poziomów; zlecenia mogą zniknąć w ułamku sekundy.',
    ],
  },
  {
    id: 'vortex',
    label: 'Orderflow Vortex',
    icon: <Orbit className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'live', label: 'LIVE' }],
    what: 'Węzły giełd wokół rdzenia BTC-PERP. Impulsy na przewodach pokazują, która strona dominuje w przepływie agresora w bieżącej świecy.',
    how: [
      'Kolor węzła: morski = przewaga kupujących ▲, pomarańczowy = sprzedających ▼, szary = brak danych.',
      'Impulsy płyną do środka przy przewadze kupna, na zewnątrz przy przewadze sprzedaży; rozmiar węzła rośnie z wolumenem.',
      'Słupki wokół rdzenia to duże zlecenia w arkuszu HL (≥ 1,2 BTC lub ≥ 10 zleceń na poziomie).',
    ],
    method: 'Transakcje z WebSocket Hyperliquid; giełdy CEX tylko po włączeniu opt-in w Źródłach (łączone z Twojej przeglądarki).',
    limits: [
      'Bez opt-in CEX aktywny jest tylko węzeł Hyperliquid.',
      'Jedna świeca to krótkie okno — przewaga potrafi się odwrócić w kilka sekund.',
      'Ścieżki Monte Carlo to model (Merton jump-diffusion), nie prognoza.',
    ],
  },
  {
    id: 'fluid',
    label: 'Delta Fluid',
    icon: <Waves className={ICON} aria-hidden="true" />,
    sources: [
      { tone: 'live', label: 'LIVE' },
      { tone: 'model', label: 'MODEL' },
    ],
    what: 'Powierzchnia, której lewa strona unosi się z intensywnością agresywnych kupujących, a prawa opada z intensywnością sprzedających.',
    how: [
      'Jasna linia styku przesuwa się w prawo, gdy przeważają kupujący (przewaga netto Hawkesa), w lewo — gdy sprzedający.',
      'Słupki to poziomy cenowe z taśmy OFI: wysokość = |OFI|, kolor = strona; jasny słupek = wykryte wyczerpanie przepływu.',
      '„Przekaż do planu” przenosi kierunek przewagi do Analizatora — tam oceniasz plan.',
    ],
    method: 'Transakcje HL → intensywność Hawkesa (μ, α, β stałe; η nieestymowane) i OFI per poziom ceny.',
    limits: [
      'Fale i turbulencja to efekt wizualny, nie symulacja płynu.',
      'Suwaki „wzmocnienie” i „tłumienie” zmieniają tylko wygląd, nie dane.',
    ],
  },
  {
    id: 'risk',
    label: 'Liquidation Risk (szacunek)',
    icon: <Mountain className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'model', label: 'MODEL' }],
    what: 'Teren wokół bieżącej ceny (jasna pionowa linia): wzniesienia tam, gdzie heurystyka szacuje skupiska poziomów likwidacji i stopów.',
    how: [
      'Prawo od linii ceny = poziomy nad ceną (szacowane likwidacje shortów ▲), lewo = pod ceną (longów ▼).',
      'Wysokość i jasność = względna siła szacunku, nie kwota w USD. Złote znaczniki to PDH/PDL.',
      'Głębokość (oś Z) to umowny podział na dźwignię 5×/20×/100× — tylko układ wizualny.',
    ],
    method: 'Szacunek z wolumenu świec przy założonych dźwigniach (5/20/100×) oraz pul stopów przy PDH/PDL; siła = U(p) z profilu.',
    limits: [
      'To nie są realne pozycje — Hyperliquid nie publikuje mapy likwidacji.',
      'Skuteczność „magnesów” nie została zmierzona.',
    ],
  },
  {
    id: 'options',
    label: 'Options (ilustracja)',
    icon: <Sparkles className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'model', label: 'MODEL' }],
    what: 'Parametryczny smile zmienności implikowanej w funkcji strike’u i terminu oraz greki Blacka-Scholesa dla opcji CALL.',
    how: [
      'Wysokość = IV modelu; przełącz na gammę lub vannę modelu.',
      'Przeciągnij płótno, aby obrócić; słupki po prawej to przekrój smile dla wybranego terminu.',
    ],
    method: 'Ręcznie sparametryzowany smile (struktura terminowa + skew + krzywizna) i Black-Scholes (r = 4,5%, q = 0).',
    limits: [
      'Hyperliquid nie ma rynku opcji; aplikacja nie pobiera kwotowań opcji.',
      'Brak GEX, max pain i zero-gamma — wymagają open interest per strike.',
    ],
    autoHeight: true,
  },
];
