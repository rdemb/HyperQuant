import { describe, expect, it } from 'vitest';
import { shiftIntoView } from '../chart/LayoutHeader';

describe('okno opisu liczb układu w granicach ekranu', () => {
  it('mieści się: bez przesunięcia', () => {
    expect(shiftIntoView(100, 500, 720)).toBe(0);
  });
  it('przy 720 px kotwica z prawej wypycha okno 576 px w lewo poza ekran: przesunięcie w prawo do marginesu', () => {
    // grupa liczb kończy się na 400 px, okno 36rem = 576 px → lewa krawędź −176
    expect(shiftIntoView(-176, 400, 720)).toBe(184);
  });
  it('za prawą krawędzią: w lewo', () => {
    expect(shiftIntoView(300, 760, 720)).toBe(-48);
  });
  it('szersze niż ekran: lewy margines wygrywa', () => {
    expect(shiftIntoView(-50, 800, 720)).toBe(58);
  });
});
