/**
 * Lista zmian okna „Co nowego” (`whats-new.json` z buildu strony, `scripts/blog/whatsnew.mjs`) i wybór pozycji do
 * pokazania. Czysta logika: bez sieci, pamięci przeglądarki i Reacta (okno: `Efekty.tsx`).
 */

export const GRUPY_NOWOSCI = ['wykres', 'prognozy', 'rynki', 'skaner', 'blog'] as const;
export type GrupaNowosci = (typeof GRUPY_NOWOSCI)[number];

export interface Nowosc {
  /** Data i tytuł: stały między buildami */
  id: string;
  date: string;
  group: GrupaNowosci;
  pl: string;
  en: string;
  /** Pierwsze zdanie opisu z CHANGELOG (po polsku) */
  body: string;
}

export interface ListaNowosci {
  v: 1;
  groups: Record<GrupaNowosci, { pl: string; en: string }>;
  items: Nowosc[];
}

/** Pozycje do tego dnia widział każdy stały użytkownik (ostatnie okno z listą wpisaną w kod, 23.11.2026). */
export const WIDZIANE_DO = '2026-11-23';
/** Najwięcej pozycji w oknie (pełna lista: strona „Co nowego”). */
export const NOWOSCI_W_OKNIE = 5;

export const czyLista = (x: unknown): x is ListaNowosci => {
  const l = x as ListaNowosci | null;
  return (
    !!l &&
    l.v === 1 &&
    typeof l.groups === 'object' &&
    l.groups !== null &&
    Array.isArray(l.items) &&
    l.items.every(
      (i) =>
        !!i &&
        typeof i.id === 'string' &&
        typeof i.date === 'string' &&
        (GRUPY_NOWOSCI as readonly string[]).includes(i.group) &&
        typeof i.pl === 'string' &&
        typeof i.en === 'string' &&
        typeof i.body === 'string'
    )
  );
};

/**
 * Pozycje do pokazania: niewidziane, w kolejności pliku (najnowsze pierwsze), najwyżej `NOWOSCI_W_OKNIE`. Bez zapisu
 * widzianych (pierwsze wejście z tą wersją okna): nowy użytkownik — nic, stały — pozycje po `WIDZIANE_DO`.
 */
export function nowosciDoPokazania(lista: ListaNowosci, widziane: readonly string[] | null, stalyUzytkownik: boolean): Nowosc[] {
  const seen = new Set(widziane ?? (stalyUzytkownik ? lista.items.filter((i) => i.date <= WIDZIANE_DO).map((i) => i.id) : lista.items.map((i) => i.id)));
  return lista.items.filter((i) => !seen.has(i.id)).slice(0, NOWOSCI_W_OKNIE);
}
