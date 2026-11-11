import { describe, expect, it } from 'vitest';
import { fitPanel } from '../menuKeys';

/** Panel listy rozwijanej mieści się w oknie: przesunięty w bok, gdy wychodzi za krawędź, i niższy, gdy brak miejsca w dół. */
describe('położenie panelu listy rozwijanej', () => {
  const view = { w: 390, bottom: 787 };

  it('panel od lewej krawędzi przycisku wychodzący za prawą krawędź okna przesuwa się w lewo (8 px marginesu)', () => {
    // Przycisk „Warstwy” przy prawej krawędzi telefonu, panel 288 px
    const f = fitPanel({ left: 260, right: 330, bottom: 60 }, { w: 288 }, 'left', view);
    expect(f.dx).toBe(390 - 8 - (260 + 288));
    expect(260 + f.dx + 288).toBe(382);
  });

  it('panel od prawej krawędzi przycisku wychodzący za lewą krawędź przesuwa się w prawo', () => {
    const f = fitPanel({ left: 20, right: 100, bottom: 60 }, { w: 288 }, 'right', view);
    expect(100 - 288 + f.dx).toBe(8);
  });

  it('mieszczący się panel zostaje na miejscu', () => {
    expect(fitPanel({ left: 20, right: 100, bottom: 60 }, { w: 200 }, 'left', view).dx).toBe(0);
  });

  it('wysokość z miejsca pod przyciskiem do dolnej granicy (dolne menu), najwyżej 560 px i nie mniej niż 120 px', () => {
    expect(fitPanel({ left: 0, right: 50, bottom: 600 }, { w: 100 }, 'left', view).maxH).toBe(787 - 600 - 4 - 8);
    expect(fitPanel({ left: 0, right: 50, bottom: 40 }, { w: 100 }, 'left', { w: 1440, bottom: 900 }).maxH).toBe(560);
    expect(fitPanel({ left: 0, right: 50, bottom: 760 }, { w: 100 }, 'left', view).maxH).toBe(120);
  });
});
