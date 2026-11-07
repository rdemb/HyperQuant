import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LayoutHeader } from '../chart/LayoutHeader';
import type { ProStore } from '../store/proStore';
import { STATIONS } from '../chart/stations';

// Pierwszy render nagłówka: liczby bez wejść (wszystkie „—”), zanim dojdą dane
const header = (id: (typeof STATIONS)[number]['id'], coin: string, narrow: boolean) =>
  renderToStaticMarkup(
    <LayoutHeader
      id={id}
      question="Pytanie układu"
      store={{ coin } as ProStore}
      model={null}
      volStatus="loading"
      liq={{ status: 'loading' } as never}
      whales={null}
      whalesConfigured={false}
      blogMaps={{ status: 'loading', maps: [] }}
      blogMap={null}
      narrow={narrow}
    />
  );

describe('nagłówek układu: „—” bez plakietki źródła', () => {
  it('przy braku danych żadna liczba nie stoi obok LIVE ani MODEL (komputer i telefon, każdy układ)', () => {
    for (const st of STATIONS) {
      for (const narrow of [false, true]) {
        const html = header(st.id, 'BTC', narrow);
        expect(html.match(/<button/g)?.length, st.id).toBe(3);
        expect(html, `${st.id} narrow=${narrow}`).toContain('>—<');
        expect(html, `${st.id} narrow=${narrow}`).not.toMatch(/>(LIVE|MODEL)</);
      }
    }
  });

  it('powód zamiast plakietki zostaje („tylko BTC” przy innym rynku)', () => {
    const html = header('fuel', 'ETH', false);
    expect(html).toContain('>tylko BTC<');
    expect(html).not.toMatch(/>(LIVE|MODEL)</);
  });
});
