import { describe, expect, it } from 'vitest';
import { type LinkAlarm, alarmParam, linkAlerts, parseAlarmLink } from '../chart/alarmLink';

const PLAN: LinkAlarm[] = [
  { c: 'BTC', p: 64_670, k: 't', o: 'Poziom zakresu' },
  { c: 'BTC', p: 64_670, k: 'c', d: -1, i: '15m', n: 2, f: '10:05', u: '11:45', g: 'L', o: 'Pod poziomem: żółć' },
  { c: 'BTC', p: 64_670, k: 'r', d: 1, i: '15m', x: 1, f: '10:05', u: '11:45', g: 'L', o: 'Powrót nad: źdźbło' },
  { c: 'BTC', p: 65_500, k: 'c', d: 1 },
  { c: 'BTC', p: 65_400, k: 'c', d: -1, a: 3, u: '14:10', o: 'Wyjście po wybiciu' },
  { c: 'BTC', p: 1, k: 's', d: 1, u: '14:10', o: 'Wyciskanie: nie goń' },
];

describe('link z alarmami', () => {
  it('zestaw przechodzi przez link bez zmian (także polskie znaki w opisie)', () => {
    const hash = `#charts?m=BTC&alarm=${alarmParam(PLAN)}`;
    expect(hash).toMatch(/^[#\w?=&.\-]+$/);
    expect(parseAlarmLink(hash)).toEqual(PLAN);
    expect(parseAlarmLink('#charts?m=BTC')).toBeNull();
    expect(parseAlarmLink(`#desk?alarm=${alarmParam(PLAN)}`)).toBeNull();
  });

  it('jeden błędny wpis odrzuca cały link', () => {
    for (const bad of [{ ...PLAN[1], d: undefined }, { ...PLAN[5], d: undefined }, { ...PLAN[0], c: 'DOGE' }, { ...PLAN[1], i: '2h' }, { ...PLAN[1], f: '9:05' }, { ...PLAN[4], a: 4 }, { ...PLAN[1], n: 4 }])
      expect(parseAlarmLink(`#charts?alarm=${alarmParam([PLAN[0], bad as LinkAlarm])}`)).toBeNull();
    expect(parseAlarmLink('#charts?alarm=1.@@@')).toBeNull();
  });

  it('łańcuch w kółko odrzuca link; zwykły łańcuch kilku wpisów przechodzi', () => {
    const a = (k: number): LinkAlarm => ({ c: 'BTC', p: 64_000 + k * 100, k: 't', a: k });
    expect(parseAlarmLink(`#charts?alarm=${alarmParam([{ ...a(1) }, { ...a(0) }])}`)).toBeNull();
    expect(parseAlarmLink(`#charts?alarm=${alarmParam([PLAN[0], { ...a(2) }, { ...a(1) }])}`)).toBeNull();
    const chain = [PLAN[0], { ...a(0) }, { ...a(1) }];
    expect(parseAlarmLink(`#charts?alarm=${alarmParam(chain)}`)).toEqual(chain);
  });

  it('alarmy z zestawu: kierunek dotknięcia z ceny, okno z godzin lokalnych, para i łańcuch', () => {
    const local = new Date(2026, 9, 29, 10, 2).getTime();
    const list = linkAlerts(PLAN, () => 64_970, 1_000, local);
    expect(list[0]).toMatchObject({ kind: 'touch', dir: -1, note: 'Poziom zakresu', after: '', pair: '' });
    expect(list[1]).toMatchObject({ kind: 'close', dir: -1, closes: 2, from: new Date(2026, 9, 29, 10, 5).getTime(), until: new Date(2026, 9, 29, 11, 45).getTime() });
    expect(list[2]).toMatchObject({ kind: 'reclaim', dir: 1, delta: true });
    expect(list[1].pair).not.toBe('');
    expect(list[1].pair).toBe(list[2].pair);
    expect(list[4]).toMatchObject({ after: list[3].id, until: new Date(2026, 9, 29, 14, 10).getTime() });
    expect(list[5]).toMatchObject({ kind: 'squeeze', dir: 1, price: 1, after: '' });
    expect(new Set(list.map((a) => a.id)).size).toBe(PLAN.length);
  });
});
