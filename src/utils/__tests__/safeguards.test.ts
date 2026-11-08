import { describe, expect, it } from 'vitest';
import { GUARDS, TITLE_GUARDS, guardHits, guardViolations } from '../safeguards.mjs';
// Walidator bloga korzysta z tego samego modułu (jedna lista bezpieczników)
import { GUARDS as BLOG_GUARDS, guardViolations as blogViolations } from '../../../scripts/blog/posts.mjs';

describe('bezpieczniki treści: wspólny moduł bloga i strony', () => {
  it('blog używa tej samej listy i tej samej funkcji', () => {
    expect(BLOG_GUARDS).toBe(GUARDS);
    expect(blogViolations).toBe(guardViolations);
  });

  it('komunikat walidatora bloga bez zmian: powód po polsku i fragment z kontekstem', () => {
    expect(guardViolations('Kupujcie, póki tanio.')).toEqual(['wezwanie do transakcji: „…Kupujcie, póki tanio.…”']);
    expect(guardViolations('Long od 80 500 z celem wyżej.')).toEqual(['gotowe wejście (long/short od ceny): „…Long od 80 500 z celem wyżej.…”']);
    expect(guardViolations('Cena spadła — znowu.')).toEqual(['myślnik: „…Cena spadła — znowu.…”']);
  });

  it('każdy wzorzec ma rodzaj i powód po polsku i angielsku', () => {
    for (const g of [...GUARDS, ...TITLE_GUARDS]) {
      expect(g.kind).toMatch(/^(privacy|advice|style)$/);
      expect(g.why.length).toBeGreaterThan(3);
      expect(g.en.length).toBeGreaterThan(3);
    }
  });
});

describe('bezpieczniki tytułu Klatki (TITLE_GUARDS)', () => {
  const kinds = (t: string) => guardHits(t, TITLE_GUARDS).map((h) => h.guard.kind);

  it.each([
    ['kup', 'Kup teraz, VWAP +1,2σ'],
    ['sprzedaj', 'Sprzedaj przy 82 000'],
    ['wejdź w longa', 'Wejdź w longa nad VAH'],
    ['long od ceny', 'Long od 80 500'],
    ['long przy cenie bez przyimka', 'Long 80 500, klaster 4,2M'],
    ['short z @', 'short @ 82000'],
    ['TP/SL', 'TP 82000, SL 80100'],
    ['buy (EN)', 'Buy the dip: VWAP −2,1σ'],
    ['sell (EN)', 'Sell now, RVOL 3,2×'],
    ['go long (EN)', 'Go long above 80,500'],
    ['enter a short (EN)', 'Enter a short at the VAH'],
    ['long from (EN)', 'Long from 80,500'],
  ])('rada „%s” jest blokowana', (_, t) => {
    expect(kinds(t)).toContain('advice');
  });

  it('prywatność też: adres portfela w tytule', () => {
    expect(kinds('Wieloryb 0x1234567890abcdef1234567890abcdef12345678 dokupił')).toContain('privacy');
  });

  it('bez reguł stylu bloga: „—” to brak liczby w nagłówku, nie myślnik', () => {
    expect(guardHits('Klaster likw.: — (tylko BTC); RVOL: 1,3× (MODEL)', TITLE_GUARDS)).toEqual([]);
    expect(TITLE_GUARDS.some((g) => g.kind === 'style')).toBe(false);
  });

  it.each([
    'Kto teraz naciska, kto przyjmuje uderzenia i co stoi w kolejce?',
    'Saldo wielorybów: +4,2M (LIVE); Klaster likw.: +1,23% · 4,2M (LIVE, 4 min)',
    'Presja kupujących osłabła, sprzedający wrzucili 120 BTC w minutę',
    'Likwidacje longów 23,7M pod ceną, shorty wyżej',
    'Buy volume and sell volume are even; buyers absorbed 120 BTC',
    'Longs 4.2M, shorts 3.9M: the whale balance is flat',
    'Short squeeze? IB up · 1,8×',
  ])('zwykły opis rynku przechodzi: %s', (t) => {
    expect(guardHits(t, TITLE_GUARDS)).toEqual([]);
  });

  it('trafienie ma fragment tekstu z dopasowaniem', () => {
    const [h] = guardHits('Wykres BTC. Kup teraz, póki tanio.', TITLE_GUARDS);
    expect(h.fragment).toContain('Kup');
  });
});

/** Wzorce e-mail, TP/SL i long/short przy cenie w poprzednim zapisie (czas dopasowania kwadratowy w długości tekstu). */
const PREVIOUS = {
  email: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
  tpsl: /(?<![\p{L}])(?:TP|SL|take[ -]profit|stop[ -]loss)\s*[:=]?\s*\d/iu,
  longAt: /(?<![\p{L}])(?:long|short)\s*(?:@|from|at|above|below|near)?\s*\d/iu,
};
const guardOf = (list: readonly { en: string; re: RegExp }[], en: string) => {
  const g = list.find((x) => x.en === en);
  if (!g) throw new Error(`brak wzorca: ${en}`);
  return g.re;
};
const CURRENT = {
  email: guardOf(GUARDS, 'an e-mail address'),
  tpsl: guardOf(GUARDS, 'a TP/SL level'),
  longAt: guardOf(TITLE_GUARDS, 'a ready-made entry (long/short at a price)'),
};
type Changed = keyof typeof PREVIOUS;
/** Dopasowanie jako porównywalna para: miejsce i tekst (null — brak). */
const matchOf = (re: RegExp, t: string) => {
  const m = re.exec(t);
  return m ? [m.index, m[0]] : null;
};

/** Teksty trafień i nie-trafień każdego zmienianego wzorca (także granice słów, polskie litery, białe znaki i separatory). */
const EXAMPLES: Record<Changed, { hit: string[]; miss: string[] }> = {
  email: {
    hit: ['Pisz na desk@example.com.', 'a.b+c-d@sub-domain.io', 'x@y.co', '(kontakt: jan_kowalski@firma.pl)', 'ąę desk@example.com', 'wiele...kropek@d.org', 'a@b.cd@e.fg', 'mail:a@b.cde1'],
    miss: ['@example.com', 'desk@localhost', 'desk @ example.com', 'a@b.c', 'adres e-mail bez małpy', 'a@.com', 'a@b_c', '80 500 @ 81 000', 'user@host.'],
  },
  tpsl: {
    hit: ['TP 82000, SL 80100', 'TP 82000 i SL: 80100.', 'tp:1', 'SL=80 100', 'take profit 82 000', 'Take-profit: 1', 'stop loss 80k', 'stop-loss = 7', 'SL   :   5', '(TP\t1)', 'zielony TP 9'],
    miss: ['TPS 82000', 'STP 1', 'TP: brak', 'SL :: 5', 'ATP 2026', 'take  profit 1', 'stoploss 5', 'TP = = 1', 'łTP 1', 'TP x'],
  },
  longAt: {
    hit: ['Long 80 500, klaster 4,2M', 'short @ 82000', 'Long from 80,500', 'short at 1', 'long above 2', 'LONG below 3', 'short near 4', 'long5', 'longat5', 'long   @   6', 'Short\n7'],
    miss: ['longer 5', 'oblong 5', 'long @ x', 'long from from 5', 'long term', 'Longs 4.2M, shorts 3.9M', 'short squeeze? 1', 'long — 5', 'ąshort 5'],
  },
};

/** Znaki i słowa losowych tekstów: te, na których wzorzec się różnicuje (separatory, białe znaki, polskie litery, cyfry). */
const FUZZ_PARTS: Record<Changed, string[]> = {
  email: ['a', 'Z', '0', '.', '+', '-', '_', '@', ' ', '\n', ':', 'ą', '.com', '.pl', '.c', 'x@y', '@ex', '-d', 'b.co'],
  tpsl: ['TP', 'SL', 'tp', 'take profit', 'take-profit', 'stop loss', 'stop-loss', ' ', '  ', '\t', '\n', ':', '=', '7', '0', 'x', 'ą', 'S', '.', ','],
  longAt: ['long', 'short', 'LONG', ' ', '  ', '\t', '\n', '@', 'from', 'at', 'above', 'below', 'near', '5', '0', 'x', 'ą', 's', '—', ','],
};

/** Losowe teksty (stałe ziarno, ten sam zestaw przy każdym uruchomieniu) z części `parts`. */
function fuzz(n: number, seed: number, parts: readonly string[]): string[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, () => {
    let t = '';
    const len = 1 + Math.floor(rnd() * 14);
    for (let i = 0; i < len; i++) t += parts[Math.floor(rnd() * parts.length)];
    return t;
  });
}

describe('wzorce e-mail, TP/SL i long/short przy cenie: te same trafienia co w poprzednim zapisie', () => {
  for (const k of Object.keys(PREVIOUS) as Changed[]) {
    it(`${k}: przykłady trafień i nie-trafień — to samo miejsce i ten sam tekst dopasowania`, () => {
      for (const t of EXAMPLES[k].hit) {
        expect(matchOf(PREVIOUS[k], t), `${k} (poprzedni) trafia: ${t}`).not.toBeNull();
        expect(matchOf(CURRENT[k], t), t).toEqual(matchOf(PREVIOUS[k], t));
      }
      for (const t of EXAMPLES[k].miss) {
        expect(matchOf(PREVIOUS[k], t), `${k} (poprzedni) nie trafia: ${t}`).toBeNull();
        expect(matchOf(CURRENT[k], t), t).toBeNull();
      }
    });

    it(`${k}: 20 000 losowych tekstów ze stałym ziarnem — wynik identyczny z poprzednim zapisem`, () => {
      const texts = fuzz(20_000, 7 + k.length, FUZZ_PARTS[k]);
      const diff = texts.filter((t) => JSON.stringify(matchOf(CURRENT[k], t)) !== JSON.stringify(matchOf(PREVIOUS[k], t)));
      expect(diff).toEqual([]);
      // Zestaw zawiera trafienia: porównanie nie przechodzi na samych brakach dopasowania
      expect(texts.filter((t) => PREVIOUS[k].test(t)).length).toBeGreaterThan(100);
    });
  }

  it('komunikaty walidatora bloga i trafienia strażnika tytułu bez zmian na przykładach (ten sam powód i fragment)', () => {
    const all = Object.values(EXAMPLES).flatMap((e) => [...e.hit, ...e.miss]);
    const prevGuards = <G extends { re: RegExp; en: string }>(list: readonly G[]): G[] =>
      list.map((g) => ({ ...g, re: g.en === 'an e-mail address' ? PREVIOUS.email : g.en === 'a TP/SL level' ? PREVIOUS.tpsl : g.en === 'a ready-made entry (long/short at a price)' ? PREVIOUS.longAt : g.re }));
    const view = (hits: ReturnType<typeof guardHits>) => hits.map((h) => [h.guard.en, h.fragment]);
    for (const t of all) {
      expect(view(guardHits(t, GUARDS)), t).toEqual(view(guardHits(t, prevGuards(GUARDS))));
      expect(view(guardHits(t, TITLE_GUARDS)), t).toEqual(view(guardHits(t, prevGuards(TITLE_GUARDS))));
    }
  });
});

describe('czas dopasowania liniowy: tekst 200 000 znaków, najgorszy przypadek poprzednich wzorców', () => {
  const N = 200_000;
  const cases: [string, string, string | null][] = [
    // E-mail: długi ciąg znaków lokalnej części bez „@” (poprzednio od każdej pozycji skan do końca)
    ['e-mail bez małpy', 'a'.repeat(N), null],
    ['e-mail z małpą na końcu', `${'a.'.repeat(N / 2)}@example.com`, 'an e-mail address'],
    // TP/SL: słowo i długi ciąg białych znaków bez cyfry (poprzednio dwa \s* wokół [:=]? — kwadratowo)
    ['TP i spacje', `TP${' '.repeat(N)}x`, null],
    ['SL, dwukropek i spacje', `SL${' '.repeat(N / 2)}:${' '.repeat(N / 2)}x`, null],
    // long/short: słowo i długi ciąg białych znaków bez ceny (poprzednio dwa \s* wokół przyimka)
    ['long i spacje', `long${' '.repeat(N)}x`, null],
    ['short, przyimek i spacje', `short${' '.repeat(N / 2)}at${' '.repeat(N / 2)}x`, null],
  ];
  it.each(cases)('%s: guardHits kończy się w limicie testu', (_, text, want) => {
    expect(text.length).toBeGreaterThanOrEqual(N);
    const blog = guardHits(text, GUARDS).map((h) => h.guard.en);
    const title = guardHits(text, TITLE_GUARDS).map((h) => h.guard.en);
    if (want === null) {
      expect(blog.filter((e) => e === 'an e-mail address' || e === 'a TP/SL level')).toEqual([]);
      expect(title.filter((e) => /e-mail|TP\/SL|long\/short at a price/.test(e))).toEqual([]);
    } else {
      expect(blog).toContain(want);
      expect(title).toContain(want);
    }
  });

  it('wszystkie trzy naraz w jednym tekście, także komunikaty walidatora bloga', () => {
    const text = ['a'.repeat(N), `TP${' '.repeat(N)}x`, `long${' '.repeat(N)}x`].join('|');
    expect(guardViolations(text)).toEqual([]);
    expect(guardHits(text, TITLE_GUARDS)).toEqual([]);
  });
});
