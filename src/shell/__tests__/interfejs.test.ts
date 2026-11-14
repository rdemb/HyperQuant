import { describe, expect, it } from 'vitest';
import { UI_KEY, bezParametruUi, wybierzInterfejs } from '../interfejs';

/** Pamięć zastępcza localStorage (tylko potrzebne metody). */
function pamiec(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe('przełącznik nowego wyglądu', () => {
  it('domyślnie stary interfejs, bez zapisu', () => {
    const s = pamiec();
    expect(wybierzInterfejs('', s)).toBe('stary');
    expect(s.dump()).toEqual({});
  });

  it('?ui=nowy włącza i zapamiętuje, następna wizyta bez parametru zostaje przy nowym', () => {
    const s = pamiec();
    expect(wybierzInterfejs('?ui=nowy', s)).toBe('nowy');
    expect(s.dump()).toEqual({ [UI_KEY]: 'nowy' });
    expect(wybierzInterfejs('', s)).toBe('nowy');
  });

  it('?ui=stary wyłącza i usuwa zapis', () => {
    const s = pamiec({ [UI_KEY]: 'nowy' });
    expect(wybierzInterfejs('?ui=stary', s)).toBe('stary');
    expect(s.dump()).toEqual({});
  });

  it('nieznana wartość parametru i zepsuty zapis dają stary interfejs bez zmiany pamięci', () => {
    const s = pamiec({ [UI_KEY]: 'cos' });
    expect(wybierzInterfejs('?ui=zielony', s)).toBe('stary');
    expect(wybierzInterfejs('?m=ETH', s)).toBe('stary');
    expect(s.dump()).toEqual({ [UI_KEY]: 'cos' });
  });

  it('niedostępna pamięć (tryb prywatny) nie psuje wyboru z parametru', () => {
    const zla = {
      getItem: () => {
        throw new Error('brak dostępu');
      },
      setItem: () => {
        throw new Error('brak dostępu');
      },
      removeItem: () => {
        throw new Error('brak dostępu');
      },
    };
    expect(wybierzInterfejs('?ui=nowy', zla)).toBe('nowy');
    expect(wybierzInterfejs('', zla)).toBe('stary');
  });
});

describe('adres bez parametru ui', () => {
  it('usuwa tylko ui, zostawia inne parametry i hash', () => {
    expect(bezParametruUi('https://hyperquant.tech/?ui=nowy#charts?m=ETH')).toBe('/#charts?m=ETH');
    expect(bezParametruUi('https://hyperquant.tech/?ref=x&ui=stary#before')).toBe('/?ref=x#before');
    expect(bezParametruUi('https://hyperquant.tech/#charts')).toBeNull();
  });
});
