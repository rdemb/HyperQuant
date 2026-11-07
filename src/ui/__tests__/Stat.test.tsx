import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Stat } from '../Stat';
import { DASH } from '../format';

const LIVE = { tone: 'live' as const, label: 'LIVE', title: 'Hyperliquid' };

describe('kafel liczby: „—” bez plakietki źródła', () => {
  it('wartość „—” (tekst): bez LIVE', () => {
    const html = renderToStaticMarkup(<Stat label="Funding" value={DASH} source={LIVE} />);
    expect(html).toContain('>—<');
    expect(html).not.toMatch(/>LIVE</);
  });

  it('„—” w JSX z jawnym `missing`: bez MODEL; bez `missing` liczba w JSX ma plakietkę', () => {
    const model = { tone: 'model' as const, label: 'MODEL' };
    const dash = renderToStaticMarkup(<Stat label="VWAP" value={<span className="text-base">{DASH}</span>} source={model} missing />);
    expect(dash).not.toMatch(/>MODEL</);
    const num = renderToStaticMarkup(<Stat label="VWAP" value={<span className="text-base">+1,2σ</span>} source={model} />);
    expect(num).toMatch(/>MODEL</);
  });

  it('liczba: plakietka źródła zostaje; `missing={false}` przy „—” tylko na wyraźne życzenie', () => {
    expect(renderToStaticMarkup(<Stat label="OI" value="$3,1B" source={LIVE} />)).toMatch(/>LIVE</);
    expect(renderToStaticMarkup(<Stat label="OI" value={DASH} source={LIVE} missing={false} />)).toMatch(/>LIVE</);
  });

  it('stan danych zamiast źródła (BRAK, STALE, < 24 h) zostaje przy „—” jako powód', () => {
    const none = renderToStaticMarkup(<Stat label="RRP" value={DASH} source={{ tone: 'neutral', label: 'BRAK' }} />);
    expect(none).toMatch(/>BRAK</);
    const stale = renderToStaticMarkup(<Stat label="RRP" value={DASH} source={{ tone: 'stale', label: 'STALE' }} />);
    expect(stale).toMatch(/>STALE</);
  });

  it('kafle, w których „—” jest w JSX, przekazują `missing` (pas kontekstu Przed sesją, funding, Kyle)', () => {
    const rail = readFileSync('src/views/desk/DeskRail.tsx', 'utf8');
    expect(rail).toMatch(/missing=\{!mc\}/);
    expect(rail).toMatch(/missing=\{vwapZ === null\}/);
    expect(readFileSync('src/views/market/FundingStrip.tsx', 'utf8')).toMatch(/missing=\{!hl\}/);
    expect(readFileSync('src/components/QuantSignalDesk.tsx', 'utf8')).toMatch(/missing=\{quant\.kyleLambdaPer1M === null\}/);
  });
});
