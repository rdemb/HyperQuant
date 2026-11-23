import { describe, expect, it } from 'vitest';
import { NIC_KLUCZ, NIC_WAZNOSC_MS, czytajNic, opisNici, zapiszNic } from '../nic';

const pamiec = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const T = Date.UTC(2026, 10, 23, 7, 0, 0);

describe('nić kontekstu: powrót do miejsca pracy z Dziś', () => {
  it('zapisuje tylko widoki pracy, z pełnym adresem; Dziś i Rynki nie nadpisują nici', () => {
    const s = pamiec();
    zapiszNic('#charts?m=xyz:GOLD&i=5m&v=footprint', T, s);
    zapiszNic('#dzis', T + 1000, s);
    zapiszNic('#markets', T + 2000, s);
    expect(czytajNic(T + 3000, s)).toEqual({ hash: '#charts?m=xyz:GOLD&i=5m&v=footprint', at: T });
  });

  it('wpis starszy niż 12 h, „z przyszłości” albo uszkodzony: brak propozycji', () => {
    const s = pamiec();
    zapiszNic('#orderflow?m=BTC', T, s);
    expect(czytajNic(T + NIC_WAZNOSC_MS + 1, s)).toBeNull();
    expect(czytajNic(T - 120_000, s)).toBeNull();
    s.m.set(NIC_KLUCZ, '{"hash":"#start","at":1}');
    expect(czytajNic(T, s)).toBeNull();
    s.m.set(NIC_KLUCZ, 'nie-json');
    expect(czytajNic(T, s)).toBeNull();
    expect(czytajNic(T, null)).toBeNull();
  });

  it('opis z adresu: rynek, interwał, rodzaj, nagranie z chwilą albo obserwacja Order Flow', () => {
    const f = (ms: number) => new Date(ms).toISOString().slice(5, 16);
    expect(opisNici('#charts?m=xyz:GOLD&i=5m&v=footprint', f)).toEqual({ widok: 'W sesji', szczegoly: ['GOLD', '5m', 'footprint'] });
    expect(opisNici('#charts?replay=history&m=BTC&i=5m&t=2026-11-20T07:30:00Z', f)).toEqual({ widok: 'W sesji', szczegoly: ['BTC', '5m', 'nagranie · 11-20T07:30'] });
    expect(opisNici('#orderflow?m=BTC&w=level&a=xyz', f)).toEqual({ widok: 'Order Flow', szczegoly: ['BTC', 'obserwacja poziomu'] });
    expect(opisNici('#before', f)).toEqual({ widok: 'Przed sesją', szczegoly: [] });
    expect(opisNici('#lessons', f)).toBeNull();
  });
});
