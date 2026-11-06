import { describe, expect, it } from 'vitest';
import { LIQ_RAMP, PRO } from '../chart/theme';

describe('paleta Głębia', () => {
  it('ma jedną paletę Głębia', () => {
    expect(PRO.bg).toBe('#05101E');
    expect(PRO.buy).toBe('#3280DD');
    expect(PRO.sell).toBe('#CA3829');
    expect(PRO.pocFrame).toBe('#F1C45E');
    expect(PRO.fpBidRamp).toEqual(['#1E2A3A', '#253E5F', '#2A5387', '#2F69B1', '#3280DD']);
    // Środowisko testów to Node (bez DOM); w przeglądarce nic nie ustawia atrybutu palety
    if (typeof document !== 'undefined') expect(document.documentElement.dataset.chartPalette).toBeUndefined();
  });

  it('kupno lazur, sprzedaż żar we wszystkich rolach', () => {
    expect([PRO.buyWick, PRO.domBid]).toEqual(['#3280DD', '#3280DD']);
    expect([PRO.sellWick, PRO.domAsk]).toEqual(['#CA3829', '#CA3829']);
    expect([PRO.buyInk, PRO.sellInk]).toEqual(['#82BCFC', '#F68771']);
    expect([PRO.imbBuy, PRO.imbSell]).toEqual(['#A2CFFF', '#FFA28A']);
    expect(PRO.fpAskRamp).toEqual(['#1E2A3A', '#4A333B', '#733939', '#9E3B34', '#CA3829']);
    expect(PRO.fpDeltaPosRamp).toEqual(PRO.fpBidRamp);
    expect(PRO.fpDeltaNegRamp).toEqual(PRO.fpAskRamp);
    expect(PRO.bubbleBuy).toEqual(['#3280DD', '#82BCFC', '#A2CFFF']);
    expect(PRO.bubbleSell).toEqual(['#CA3829', '#F68771', '#FFA28A']);
    expect([PRO.venueHl, PRO.venueBinance, PRO.venueBybit]).toEqual(['#059583', '#B18E15', '#A878DB']);
  });

  it('mapa ciepła: 9 stopni jak w Desku, od szarego do bieli', () => {
    expect(LIQ_RAMP.map((s) => s.t)).toEqual([0, 0.12, 0.28, 0.42, 0.55, 0.68, 0.8, 0.9, 1]);
    expect(LIQ_RAMP[0]).toEqual({ t: 0, color: '#424E5E', alpha: 0 });
    expect(LIQ_RAMP[8].color).toBe('#EFF6FD');
  });
});
