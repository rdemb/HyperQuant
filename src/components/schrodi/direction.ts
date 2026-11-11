import { tr } from '../../i18n';
import { UNSURE_HI, UNSURE_LO } from '../../utils/schrodi';

/**
 * Etykieta kierunku kota w jednym miejscu: szansa wzrostu ceny w najbliższej godzinie, bez stron rynku (long/short)
 * i bez kolorów kupna i sprzedaży. Kierunek kot trafia niewiele lepiej niż rzut monetą, więc to opis szansy,
 * nie sygnał. Zmiana formy etykiety (np. inne słowa albo ukrycie kierunku) to zmiana tylko tutaj.
 */
export const upLabel = (): string => tr('P(wzrost 1 h)', 'P(up 1 h)');

/** „P(wzrost 1 h) 54%” */
export const upOdds = (pUp: number): string => `${upLabel()} ${Math.round(pUp * 100)}%`;

/** Przedział prognoz w ocenie kierunku: „P(wzrost 1 h) > 53%” (stan `long`) albo „P(wzrost 1 h) < 47%” (stan `short`) */
export const upBand = (side: 'long' | 'short'): string =>
  `${upLabel()} ${side === 'long' ? `> ${Math.round(UNSURE_HI * 100)}%` : `< ${Math.round(UNSURE_LO * 100)}%`}`;

/** Kolor etykiety i paska kierunku: neutralny tusz, nigdy kolor kupna ani sprzedaży */
export const DIR_TONE = 'text-ink-1';
export const DIR_BAR = 'bg-ink-2';
