import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { miniDom } from '../../ui/__tests__/miniDom';

// Wczytanie modelu odrzucone (wyjątek w budowie modelu albo w łańcuchu pobrań)
vi.mock('../../utils/marketDataFeed', () => ({
  afterFirstSync: () => Promise.resolve(),
  loadVolModel: () => Promise.reject(new Error('zły ładunek')),
}));

const { useVolModel } = await import('../useVolModel');

let dom: ReturnType<typeof miniDom>;
beforeEach(() => {
  dom = miniDom();
  Object.assign(dom.document, { visibilityState: 'visible' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(() => vi.unstubAllGlobals());

describe('model zmienności: stan „loading” zawsze się kończy', () => {
  it('odrzucone wczytanie — status error (budżet liczy wtedy Parkinson z nazwą metody), nie wieczne „czekam na model”', async () => {
    const seen: string[] = [];
    const Probe: React.FC = () => {
      seen.push(useVolModel(true).status);
      return null;
    };
    const root = createRoot(dom.container as unknown as HTMLElement);
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen[0]).toBe('loading');
    expect(seen.at(-1)).toBe('error');
    act(() => root.unmount());
  });
});
