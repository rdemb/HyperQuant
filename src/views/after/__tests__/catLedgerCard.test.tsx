import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeskLedgerSummary } from '../../../utils/deskLedger';
import { CatLedgerCard } from '../CatLedgerCard';

type Cat = NonNullable<DeskLedgerSummary['cat']>;
type Big = Cat['scores']['big'];

const T = Date.UTC(2026, 10, 12, 3, 30);
const catWith = (big: Partial<Big> = {}): Cat =>
  ({
    model: 'schrodi-v1',
    since: T - 7 * 86_400_000,
    issued: 600,
    slots: 610,
    latest: null,
    scores: {
      n: 600,
      nEff: 150,
      dir: { brier: 0.249, brierBase: 0.25, bss: 0.004, auc: 0.52, hit: 0.51, long: { n: 90, hit: 0.53 }, short: { n: 40, hit: 0.5 }, unsure: 20 },
      big: { brier: 0.15, brierBase: 0.24, bss: 0.3627, auc: 0.878, hit: 0.76, reliability: [], ...big },
    },
  }) as unknown as Cat;

describe('Po sesji: karta kota — duży ruch wobec stałej częstości i wobec godziny dnia', () => {
  it('z bazą sezonową: obie liczby, druga z przedziałem 95% i opisem bazy', () => {
    const html = renderToStaticMarkup(<CatLedgerCard cat={catWith({ bssSeasonal: { value: 0.0515, lo: -0.0883, hi: 0.1965, days: 14, n: 1259 } })} />);
    expect(html).toContain('BSS wobec stałej częstości');
    expect(html).toContain('36%');
    expect(html).toContain('BSS wobec godziny dnia');
    expect(html).toContain('5% [−9%; 20%]');
    expect(html).toContain('ta sama godzina UTC z 20 dób tego samego typu; przedział 95% z losowania dób');
  });

  it('starsze podsumowanie bez pola: „—” z powodem', () => {
    const html = renderToStaticMarkup(<CatLedgerCard cat={catWith()} />);
    expect(html).toContain('BSS wobec godziny dnia');
    expect(html).toContain('brak w starszym podsumowaniu');
  });

  it('za mało dób na przedział: liczba bez przedziału i powód; bez bazy: „—”', () => {
    const few = renderToStaticMarkup(<CatLedgerCard cat={catWith({ bssSeasonal: { value: 0.04, lo: null, hi: null, days: 5, n: 300, reason: 'min-days' } })} />);
    expect(few).toContain('4%');
    expect(few).toContain('przedział od 7 dób (jest 5)');
    const none = renderToStaticMarkup(<CatLedgerCard cat={catWith({ bssSeasonal: { value: null, lo: null, hi: null, days: 0, n: 0, reason: 'min-days' } })} />);
    expect(none).toContain('od 7 dób (jest 0)');
  });

  it('kierunek bez zmian: etykieta „Umiejętność (BSS)”', () => {
    const html = renderToStaticMarkup(<CatLedgerCard cat={catWith()} />);
    expect(html).toContain('Umiejętność (BSS)');
  });
});
