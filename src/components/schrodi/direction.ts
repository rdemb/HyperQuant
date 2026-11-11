import { tr } from '../../i18n';
import { UNSURE_HI, UNSURE_LO } from '../../utils/schrodi';
import type { CatTrust } from '../../utils/schrodiTrust';

/**
 * Kierunek kota w jednym miejscu. Kierunek jest ukryty w interfejsie, dopóki e-proces w dzienniku (zakład kota wobec
 * prostej reguły, zarejestrowany plan) nie da dowodu przewagi: bez dowodu kot pokazuje tylko duży ruch i dotknięcia,
 * a rysunek nie koduje kierunku. Alarm dryfu kierunku (kot ostatnio gorszy od prostej reguły) znów ukrywa kierunek,
 * choć dowód z przeszłości zostaje w dzienniku. Z dowodem kierunek to neutralna szansa wzrostu ceny w najbliższej godzinie, bez stron
 * rynku (long/short) i bez kolorów kupna i sprzedaży. Zmiana reguły albo formy etykiety to zmiana tylko tutaj.
 */
export const dirProven = (trust: CatTrust | null | undefined): boolean => !!trust?.plan && trust.dir.proofAt !== null && !trust.dir.drift.alarm;

export const upLabel = (): string => tr('P(wzrost 1 h)', 'P(up 1 h)');

/** „P(wzrost 1 h) 54%” */
export const upOdds = (pUp: number): string => `${upLabel()} ${Math.round(pUp * 100)}%`;

/** Przedział prognoz w ocenie kierunku: „P(wzrost 1 h) > 53%” (stan `long`) albo „P(wzrost 1 h) < 47%” (stan `short`) */
export const upBand = (side: 'long' | 'short'): string =>
  `${upLabel()} ${side === 'long' ? `> ${Math.round(UNSURE_HI * 100)}%` : `< ${Math.round(UNSURE_LO * 100)}%`}`;

/** Dopisek przy pomiarze kierunku, gdy kierunek jest ukryty */
export const dirHiddenNote = (): string =>
  tr(
    'Kierunek jest ukryty do czasu dowodu przewagi na żywo (e-proces w dzienniku); wyniki kierunku to tylko pomiar.',
    'Direction is hidden until a live edge is proven (e-process in the ledger); direction scores are a measurement only.'
  );

/** Kolor etykiety i paska kierunku: neutralny tusz, nigdy kolor kupna ani sprzedaży */
export const DIR_TONE = 'text-ink-1';
export const DIR_BAR = 'bg-ink-2';
