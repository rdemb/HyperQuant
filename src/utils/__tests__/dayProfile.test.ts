import { describe, expect, it } from 'vitest';
import { baseTick } from '../../charts/pro/core/footprintBar';
import { DAY_PROFILE_VERSION, DayProfileBuilder, dayProfilePath, decodeDayProfile, encodeDayProfile, profileTick } from '../dayProfile';

const D = Date.UTC(2026, 9, 30);
const MIN = 60_000;

describe('profil doby z taśmy: kupno, sprzedaż i zmiana OI na cenach', () => {
  it('zmiana OI minuty dzielona na ceny według wolumenu, część według znaku OI i strony z przewagą agresji', () => {
    const b = new DayProfileBuilder('BTC', D, 1);
    // Minuta 0: kupno 3 na 100, sprzedaż 1 na 102 (przewaga kupna), OI +2 → „rośnie przy kupnie” 1,5 i 0,5
    b.addMinute(D, [100.4, 102.9], [3, 1], [1, -1], 2);
    // Minuta 1: równa agresja, OI −1 → po połowie „spada przy kupnie” i „przy sprzedaży”
    b.addMinute(D + MIN, [101, 101], [1, 1], [1, -1], -1);
    // Minuta 2 bez odczytu OI: tylko kupno i sprzedaż, poza udziałem minut z OI
    b.addMinute(D + 2 * MIN, [100], [2], [-1], null);
    // Spoza doby i bez transakcji — pominięte
    b.addMinute(D - MIN, [100], [5], [1], 1);
    b.addMinute(D + 3 * MIN, [], [], [], 1);
    const p = b.build()!;
    expect([p.tick, p.lo]).toEqual([1, 100]);
    expect(Array.from(p.buy)).toEqual([3, 1, 0]);
    expect(Array.from(p.sell)).toEqual([2, 1, 1]);
    expect(Array.from(p.ob)).toEqual([1.5, 0, 0.5]);
    expect(Array.from(p.os)).toEqual([0, 0, 0]);
    expect(Array.from(p.cb)).toEqual([0, 0.5, 0]);
    expect(Array.from(p.cs)).toEqual([0, 0.5, 0]);
    expect([p.mv[0], p.mv[1], p.mv[2], p.mv[3]]).toEqual([4, 2, 2, 0]);
    expect(p.oiVol).toBe(6);
    expect(new DayProfileBuilder('BTC', D, 1).build()).toBeNull();
  });

  it('plik: zapis z zaokrągleniem, odczyt sprawdza wersję, kształt i długości kolumn; ścieżka w katalogu doby', () => {
    const b = new DayProfileBuilder('BTC', D, 1);
    b.addMinute(D, [100], [1 / 3], [1], 0.1);
    const f = encodeDayProfile(b.build()!);
    expect(f.v).toBe(DAY_PROFILE_VERSION);
    expect(f.buy).toEqual([0.3333]);
    expect(f.mv).toHaveLength(1440);
    const back = decodeDayProfile(JSON.parse(JSON.stringify(f)))!;
    expect(back.ob).toEqual([0.1]);
    expect(decodeDayProfile({ ...f, v: 0 })).toBeNull();
    expect(decodeDayProfile({ ...f, sell: [] })).toBeNull();
    expect(decodeDayProfile({ ...f, mv: [1] })).toBeNull();
    expect(decodeDayProfile({ ...f, day: D + 1 })).toBeNull();
    expect(decodeDayProfile({ ...f, ob: [-1] })).toBeNull();
    expect(dayProfilePath('BTC', D)).toBe('BTC/2026-10-30/profile.json.gz');
  });

  it('krok wierszy pliku taki sam jak tick bazowy footprintu strony', () => {
    for (const px of [77_000, 101_000, 2_800, 195, 37, 0.42]) expect(profileTick(px)).toBe(baseTick(px));
    // Z szDecimals rynku (kPEPE: 0) ten sam krok co tick bazowy strony
    for (const px of [0.0045, 0.012, 77_000]) expect(profileTick(px, 0)).toBe(baseTick(px, 0));
    expect(profileTick(0.0045, 0)).toBeCloseTo(1e-6, 15);
  });
});
