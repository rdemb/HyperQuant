import { tr } from '../../../i18n';
import type { IndicatorId } from './registry';

/**
 * Karta wskaźnika (plan 59, F1): co liczba twierdzi, czy to sprawdzono (te same 4 stany co karta modelu) i pasmo szumu.
 * Twierdzenia bez kierunku ceny i bez zaleceń; test pilnuje zakazanych słów.
 */

/** Status sprawdzenia: zapis przed faktem z wynikiem, test planowany, sprawdzony bez mocy, sam opis (jak `Walidacja` karty modelu). */
export type IndicatorStatus = 'zapis' | 'test' | 'bezMocy' | 'opis';

export interface IndicatorCard {
  claim: string;
  status: IndicatorStatus;
  noise?: string;
}

export const STATUS_LABEL: Record<IndicatorStatus, string> = {
  zapis: tr('zapisywany przed faktem', 'recorded before the fact'),
  test: tr('test planowany', 'test planned'),
  bezMocy: tr('sprawdzony: bez mocy', 'tested: no power'),
  opis: tr('opis, bez prognozy', 'description, no forecast'),
};

const CLASSIC: IndicatorCard = {
  claim: tr(
    'Przekształcenie ceny według wzoru jak w TradingView; nie twierdzi niczego o przyszłości.',
    'A transformation of price with the same formula as in TradingView; it claims nothing about the future.'
  ),
  status: 'opis',
};

export const INDICATOR_CARD: Partial<Record<IndicatorId, IndicatorCard>> = {
  oiflow: {
    claim: tr(
      'Jak zmieniały się otwarte pozycje w świecy obok przewagi agresorów; współruch, nie podział na otwierających i zamykających.',
      'How open interest changed within the candle next to the aggressor balance; co-movement, not a split into openers and closers.'
    ),
    status: 'opis',
  },
  absorption: {
    claim: tr(
      'Czy cena w świecy przesunęła się w stronę agresji mniej albo bardziej niż zwykle przy takiej delcie (wysiłek a efekt).',
      'Whether price moved in the direction of aggression less or more than usual for such a delta within the candle (effort vs result).'
    ),
    status: 'test',
    noise: tr(
      'Przy rozkładzie normalnym reszt |z| > 2 zdarza się w 4,6% świec; przy grubych ogonach częściej.',
      'With normal residuals |z| > 2 happens in 4.6% of candles; with fat tails more often.'
    ),
  },
  breadth: {
    claim: tr(
      'Ile kont naprawdę stało za agresją w świecy (liczba efektywna) i jak równo rozłożyły się wejścia.',
      'How many accounts really stood behind the aggression in the candle (effective number) and how evenly entries were spread.'
    ),
    status: 'opis',
  },
  repeat: {
    claim: tr(
      'Jaka część wejść w świecy pochodzi od kont, które już wchodziły po tej samej stronie, po przeciwnej, a jaka od nowych.',
      'What share of entries within the candle comes from accounts that already entered on the same side, on the opposite side, and from new ones.'
    ),
    status: 'opis',
  },
  makers: {
    claim: tr('Kto przyjmował agresję po stronie makera: animatorzy rynku czy reszta kont.', 'Who took the aggression on the maker side: market makers or the other accounts.'),
    status: 'opis',
  },
  twap: {
    claim: tr('Jaka część wartości transakcji to podzlecenia TWAP i ile TWAP-ów działało w świecy.', 'What share of trade value comes from TWAP suborders and how many TWAPs ran within the candle.'),
    status: 'opis',
  },
  slippage: {
    claim: tr(
      'Ile kosztowałoby teraz zlecenie rynkowe o zadanej kwocie według widocznego arkusza (bez ukrytych zleceń i bez opłaty).',
      'What a market order of the given amount would cost now according to the visible book (no hidden orders, no fee).'
    ),
    status: 'test',
  },
  rvol: {
    claim: tr('Czy wolumen jest wyższy niż zwykle o tej porze dnia w Nowym Jorku.', 'Whether volume is higher than usual at this New York time of day.'),
    status: 'test',
  },
  ofi: {
    claim: tr(
      'Jak bardzo nierównowaga na najlepszych poziomach arkusza tłumaczy zmianę ceny w tej samej świecy.',
      'How much the imbalance at the best book levels explains the price change within the same candle.'
    ),
    status: 'opis',
    noise: tr(
      'Przy oknie 30 świec R² poniżej 0,13 mieści się w szumie (5%); oczekiwaną zmianę pokazujemy dopiero powyżej progu dla danego okna.',
      'With a 30-candle window an R² below 0.13 is within noise (5%); the expected change is shown only above the floor for the window.'
    ),
  },
  ordersize: {
    claim: tr(
      'Czy zlecenia rynkowe w świecy są większe albo mniejsze niż zwykle (rozkład wielkości wobec bazy).',
      'Whether market orders within the candle are larger or smaller than usual (size distribution vs the baseline).'
    ),
    status: 'opis',
    noise: tr(
      'KS jest istotny na poziomie 1% dopiero powyżej 1,628·√((n + m)/(n·m)) (n zleceń świecy, m zleceń bazy); niżej to szum.',
      'KS is significant at 1% only above 1.628·√((n + m)/(n·m)) (n candle orders, m baseline orders); below it is noise.'
    ),
  },
  cone: {
    claim: tr(
      'Jak szeroki może być ruch BTC w ciągu 1 h i 4 h (rozkład zwrotu, bez kierunku), z prognoz zapisanych przed faktem.',
      'How wide the BTC move may be over 1 h and 4 h (return distribution, no direction), from forecasts recorded before the fact.'
    ),
    status: 'zapis',
  },
  outcomes: {
    claim: tr(
      'Czy model desku i rynek wynikowy HIP-4 dają podobne prawdopodobieństwa tym samym pytaniom.',
      'Whether the desk model and the HIP-4 outcome market give similar probabilities for the same questions.'
    ),
    status: 'zapis',
  },
  regime: {
    claim: tr(
      'Prawdopodobieństwo, że poziom zmienności zmienił się w ostatnich świecach (wykrywanie punktu zmiany).',
      'The probability that the volatility level changed within the last candles (change-point detection).'
    ),
    status: 'test',
    noise: tr(
      'Przy stałym reżimie linia leży zwykle w okolicy „Okno zmiany” / „Długość reżimu” (domyślnie 0,1); rytm doby też ją podnosi.',
      'With a stable regime the line usually sits near “Change window” / “Regime length” (0.1 by default); the daily rhythm also lifts it.'
    ),
  },
  hawkes: {
    claim: tr(
      'Jak bardzo transakcje skupiają się w czasie, jakby jedne wywoływały następne; wysokie n nie dowodzi, że rynek napędza sam siebie.',
      'How strongly trades cluster in time, as if some triggered the next; a high n does not prove the market feeds on itself.'
    ),
    status: 'test',
    noise: tr('Pasmo na wykresie to 95% przedział z profilu wiarygodności.', 'The band on the chart is the 95% profile-likelihood interval.'),
  },
  pbrange: {
    claim: tr(
      'Strefy konsolidacji po impulsie i poziomy profilu poprzedniego tygodnia i doby; opis struktury, bez miejsc wejścia.',
      'Consolidation zones after an impulse and the previous week’s and day’s profile levels; a description of structure, without entry places.'
    ),
    status: 'opis',
    noise: tr('Dawne miejsca wejścia sprawdzone na 2026 r.: bez przewagi (A 52%, B 48%, C 53%).', 'Former entry places checked on 2026: no edge (A 52%, B 48%, C 53%).'),
  },
  ivb: {
    claim: tr(
      'Zakres ceny pierwszych 30 albo 60 minut od otwarcia giełdy w Nowym Jorku; opis miejsca, bez prognozy wybicia.',
      'The price range of the first 30 or 60 minutes after the New York stock exchange opens; a description of a place, no breakout forecast.'
    ),
    status: 'opis',
    noise: tr('Sprawdzianu wobec losowego poziomu jeszcze nie ma.', 'Not yet checked against a random level.'),
  },
  effort: {
    claim: tr(
      'Gdzie rynek przyjął agresję na krańcach swingu i które świece miały agresję z wybiciem.',
      'Where the market absorbed aggression at swing extremes and which candles had aggression with a breakout.'
    ),
    status: 'bezMocy',
    noise: tr(
      'W 2026 r. strefa utrzymała się po pierwszym dotknięciu w 52% przypadków, tak jak losowy poziom w tej samej odległości (BTC 5m, n 9 281).',
      'In 2026 a zone held after the first touch in 52% of cases, just like a random level at the same distance (BTC 5m, n 9,281).'
    ),
  },
};

/** Karta wskaźnika: wpis HyperQuant albo wspólny opis klasycznego wskaźnika. */
export function indicatorCard(id: IndicatorId): IndicatorCard {
  return INDICATOR_CARD[id] ?? CLASSIC;
}
