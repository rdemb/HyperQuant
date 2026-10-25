import React from 'react';
import { Box, Mountain, Orbit, Sparkles, Waves } from 'lucide-react';
import type { BadgeTone } from '../../ui';
import { tr } from '../../i18n';

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
    what: tr('Ostatnie 36 świec BTC-PERP jako bryły, ściany arkusza L2 Hyperliquid, profil wolumenu po lewej, poziomy dnia i świeże strefy Order Block.', 'The last 36 BTC-PERP candles as solids, Hyperliquid L2 book walls, the volume profile on the left, the day\'s levels and fresh Order Block zones.'),
    how: [
      tr('Słupki po prawej to 10 najbliższych poziomów arkusza: BID z przodu, ASK z tyłu; wysokość = płynność w USD.', 'The bars on the right are the 10 nearest book levels: BID in front, ASK at the back; height = liquidity in USD.'),
      tr('Złote belki to PDH/PDL, fioletowe bloki to strefy OB (krawędź morska = popytowa, pomarańczowa = podażowa).', 'Gold beams are PDH/PDL, purple blocks are OB zones (teal edge = demand, orange = supply).'),
      tr('Najedź na obiekt (na telefonie dotknij), aby zobaczyć wartość.', 'Hover over an object (tap on a phone) to see its value.'),
    ],
    method: tr('Świece i arkusz z API Hyperliquid; strefy OB, profil i trajektoria (Kalman + OU + ważona suma cech) liczone lokalnie.', 'Candles and book from the Hyperliquid API; OB zones, the profile and the trajectory (Kalman + OU + weighted sum of features) computed locally.'),
    limits: [
      tr('Trajektoria to heurystyka bez kalibracji — nie prognoza.', 'The trajectory is an uncalibrated heuristic, not a forecast.'),
      tr('Arkusz to migawka 10 poziomów; zlecenia mogą zniknąć w ułamku sekundy.', 'The book is a 10-level snapshot; orders can vanish in a fraction of a second.'),
    ],
  },
  {
    id: 'vortex',
    label: 'Orderflow Vortex',
    icon: <Orbit className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'live', label: 'LIVE' }],
    what: tr('Węzły giełd wokół rdzenia BTC-PERP. Impulsy na przewodach pokazują, która strona dominuje w przepływie agresora w bieżącej świecy.', 'Exchange nodes around the BTC-PERP core. Pulses on the wires show which side dominates the aggressor flow in the current candle.'),
    how: [
      tr('Kolor węzła: morski = przewaga kupujących ▲, pomarańczowy = sprzedających ▼, szary = brak danych.', 'Node colour: teal = buyers dominate ▲, orange = sellers ▼, grey = no data.'),
      tr('Impulsy płyną do środka przy przewadze kupna, na zewnątrz przy przewadze sprzedaży; rozmiar węzła rośnie z wolumenem.', 'Pulses flow inwards when buying dominates and outwards when selling dominates; node size grows with volume.'),
      tr('Słupki wokół rdzenia to duże zlecenia w arkuszu HL (≥ 1,2 BTC lub ≥ 10 zleceń na poziomie).', 'The bars around the core are large orders in the HL book (≥ 1.2 BTC or ≥ 10 orders at a level).'),
    ],
    method: tr('Transakcje z WebSocket Hyperliquid; giełdy CEX tylko po włączeniu opt-in w Źródłach (łączone z Twojej przeglądarki).', 'Trades from the Hyperliquid WebSocket; CEX exchanges only after the opt-in in Sources (connected from your browser).'),
    limits: [
      tr('Bez opt-in CEX aktywny jest tylko węzeł Hyperliquid.', 'Without the CEX opt-in only the Hyperliquid node is active.'),
      tr('Jedna świeca to krótkie okno — przewaga potrafi się odwrócić w kilka sekund.', 'One candle is a short window; the edge can flip within seconds.'),
      tr('Ścieżki Monte Carlo to model (sezonowy log-HAR + reszty FHS; bez modelu zmienności — Merton z założonymi skokami), nie prognoza.', 'The Monte Carlo paths are a model (seasonal log-HAR + FHS residuals; without the volatility model, Merton with assumed jumps), not a forecast.'),
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
    what: tr('Powierzchnia, której lewa strona unosi się z intensywnością agresywnych kupujących, a prawa opada z intensywnością sprzedających.', 'A surface whose left side rises with the intensity of aggressive buyers and whose right side sinks with the intensity of sellers.'),
    how: [
      tr('Jasna linia styku przesuwa się w prawo, gdy przeważają kupujący (przewaga netto Hawkesa), w lewo — gdy sprzedający.', 'The bright contact line moves right when buyers dominate (Hawkes net edge) and left when sellers do.'),
      tr('Słupki to poziomy cenowe z taśmy OFI: wysokość = |OFI|, kolor = strona; jasny słupek = wykryte wyczerpanie przepływu.', 'The bars are price levels from the OFI tape: height = |OFI|, colour = side; a bright bar = detected flow exhaustion.'),
      tr('„Przekaż do planu” przenosi kierunek przewagi do Analizatora — tam oceniasz plan.', '"Send to plan" carries the direction of the edge to the Analyzer, where you evaluate the plan.'),
    ],
    method: tr('Transakcje HL → intensywność Hawkesa (μ, α, β stałe; η nieestymowane) i OFI per poziom ceny.', 'HL trades → Hawkes intensity (μ, α, β fixed; η not estimated) and OFI per price level.'),
    limits: [
      tr('Fale i turbulencja to efekt wizualny, nie symulacja płynu.', 'The waves and turbulence are a visual effect, not a fluid simulation.'),
      tr('Suwaki „wzmocnienie” i „tłumienie” zmieniają tylko wygląd, nie dane.', 'The "gain" and "damping" sliders change only the look, not the data.'),
    ],
  },
  {
    id: 'risk',
    label: tr('Ryzyko likwidacji (szacunek)', 'Liquidation Risk (estimate)'),
    icon: <Mountain className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'model', label: 'MODEL' }],
    what: tr('Teren wokół bieżącej ceny (jasna pionowa linia): wzniesienia tam, gdzie heurystyka szacuje skupiska poziomów likwidacji i stopów.', 'Terrain around the current price (bright vertical line): hills where the heuristic estimates clusters of liquidation and stop levels.'),
    how: [
      tr('Prawo od linii ceny = poziomy nad ceną (szacowane likwidacje shortów ▲), lewo = pod ceną (longów ▼).', 'Right of the price line = levels above price (estimated short liquidations ▲), left = below price (longs ▼).'),
      tr('Wysokość i jasność = względna siła szacunku, nie kwota w USD. Złote znaczniki to PDH/PDL.', 'Height and brightness = relative strength of the estimate, not a USD amount. Gold markers are PDH/PDL.'),
      tr('Głębokość (oś Z) to umowny podział na dźwignię 5×/20×/100× — tylko układ wizualny.', 'Depth (Z axis) is a nominal split into 5×/20×/100× leverage; a visual layout only.'),
    ],
    method: tr('Szacunek z wolumenu świec przy założonych dźwigniach (5/20/100×) oraz pul stopów przy PDH/PDL; siła = U(p) z profilu.', 'Estimate from candle volume at assumed leverage (5/20/100×) and stop pools at PDH/PDL; strength = U(p) from the profile.'),
    limits: [
      tr('To nie są realne pozycje — Hyperliquid nie publikuje mapy likwidacji.', 'These are not real positions; Hyperliquid does not publish a liquidation map.'),
      tr('Skuteczność „magnesów” nie została zmierzona.', 'The effectiveness of the "magnets" has not been measured.'),
    ],
  },
  {
    id: 'options',
    label: tr('Opcje (ilustracja)', 'Options (illustration)'),
    icon: <Sparkles className={ICON} aria-hidden="true" />,
    sources: [{ tone: 'model', label: 'MODEL' }],
    what: tr('Parametryczny smile zmienności implikowanej w funkcji strike’u i terminu oraz greki Blacka-Scholesa dla opcji CALL.', 'A parametric implied volatility smile as a function of strike and expiry, plus Black-Scholes greeks for a CALL option.'),
    how: [
      tr('Wysokość = IV modelu; przełącz na gammę lub vannę modelu.', 'Height = model IV; switch to the model gamma or vanna.'),
      tr('Przeciągnij płótno, aby obrócić; słupki po prawej to przekrój smile dla wybranego terminu.', 'Drag the canvas to rotate; the bars on the right are the smile cross-section for the selected expiry.'),
    ],
    method: tr('Ręcznie sparametryzowany smile (struktura terminowa + skew + krzywizna) i Black-Scholes (r = 4,5%, q = 0).', 'A hand-parametrised smile (term structure + skew + curvature) and Black-Scholes (r = 4.5%, q = 0).'),
    limits: [
      tr('Hyperliquid nie ma rynku opcji; aplikacja nie pobiera kwotowań opcji.', 'Hyperliquid has no options market; the app does not fetch option quotes.'),
      tr('Brak GEX, max pain i zero-gamma — wymagają open interest per strike.', 'No GEX, max pain or zero-gamma; they need open interest per strike.'),
    ],
    autoHeight: true,
  },
];
