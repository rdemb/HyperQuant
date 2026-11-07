import { describe, expect, it } from 'vitest';
import { sourceTag } from '../sourceTag';

describe('plakietka obok liczby', () => {
  it('„—” bez plakietki źródła: ani LIVE, ani MODEL', () => {
    expect(sourceTag({ value: '—', badge: 'LIVE' })).toBeNull();
    expect(sourceTag({ value: '—', badge: 'MODEL' })).toBeNull();
  });

  it('„—” z powodem w uwadze (np. „tylko BTC”) — sam powód, ton neutralny', () => {
    expect(sourceTag({ value: '—', badge: 'LIVE', note: 'tylko BTC' })).toEqual({ text: 'tylko BTC', tone: 'neutral' });
  });

  it('liczba: LIVE albo MODEL; uwaga przy liczbie (wiek migawki) zamiast plakietki, ton nieaktualny', () => {
    expect(sourceTag({ value: '+1,2σ', badge: 'LIVE' })).toEqual({ text: 'LIVE', tone: 'live' });
    expect(sourceTag({ value: '31%', badge: 'MODEL' })).toEqual({ text: 'MODEL', tone: 'model' });
    expect(sourceTag({ value: '−0,4% · 12M', badge: 'LIVE', note: '4 min' })).toEqual({ text: '4 min', tone: 'stale' });
  });

  it('liczba częściowa (luka w świecach 1m, wiersz Rozliczenia): plakietka źródła w tonie nieaktualnym; przy „—” nadal bez plakietki', () => {
    expect(sourceTag({ value: '2/4 dotknięte', badge: 'LIVE', partial: true })).toEqual({ text: 'LIVE', tone: 'stale' });
    expect(sourceTag({ value: '97%', badge: 'MODEL', partial: true })).toEqual({ text: 'MODEL', tone: 'stale' });
    expect(sourceTag({ value: '—', badge: 'LIVE', partial: true })).toBeNull();
  });
});
