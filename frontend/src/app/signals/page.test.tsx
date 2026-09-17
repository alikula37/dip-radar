import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SignalsPage from './page';

const watch = {
  id: 3,
  name: 'Hedge',
  active: true,
  start: '2022-01-01',
  end: null,
  rebalance: 'weekly',
  score_model: 'rule',
  start_equity: 7.41,
  last_equity: 7.41,
  paper_return: 0.12,
  last_anchor: '2026-09-14T00:00:00',
  last_refreshed_at: '2026-09-16T09:30:00',
};

const live = {
  as_of: '2026-09-16T00:00:00',
  anchor: '2026-09-14T00:00:00',
  next_anchor: '2026-09-21T00:00:00',
  rebalance: 'weekly',
  start: '2022-01-01T00:00:00',
  score_model: 'rule',
  state: {
    equity: 7.41,
    long_notional: 0,
    short_notional: 0,
    in_btc: 'ic',
    tracked: ['ADABTC'],
    risk_on: false,
    ic_risk_on: false,
    rolling_ic: 0.0148,
    equity_brake: false,
  },
  positions: [],
  candidates: [{ symbol: 'BCHBTC', score: 100, direction: 'long' }],
  message: 'The book sits in BTC at the 2026-09-14 anchor (ic).',
};

const history = [
  {
    id: 1,
    date: '2026-09-14T00:00:00',
    action: 'STAY_IN_BTC',
    symbol: '',
    reason: 'ic',
    weight: null,
    score: null,
    price: null,
    equity: 7.41,
    message: null,
    return_since: 0.0,
  },
  {
    id: 2,
    date: '2026-09-07T00:00:00',
    action: 'BUY',
    symbol: 'BCHBTC',
    reason: null,
    weight: 0.2,
    score: 100,
    price: 0.002,
    equity: 7.0,
    message: null,
    return_since: 0.0586,
  },
];

function mockFetch() {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/live')) return new Response(JSON.stringify(live), { status: 200 });
    if (url.includes('/signals')) return new Response(JSON.stringify(history), { status: 200 });
    if (url.includes('/refresh')) return new Response(JSON.stringify({ watch, anchors: live.state, inserted: [] }), { status: 200 });
    return new Response(JSON.stringify([watch]), { status: 200 });
  });
  return spy;
}

describe('SignalsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the watch list, live book and signal history with follow-through', async () => {
    mockFetch();

    render(<SignalsPage />);

    expect(await screen.findByRole('heading', { name: 'Hedge' })).toBeTruthy();
    expect(screen.getByText(/In BTC · Factor IC weak/)).toBeTruthy();
    expect(screen.getByText(/BCH 100/)).toBeTruthy();
    expect(screen.getByText('Move to BTC')).toBeTruthy();
    expect(screen.getByText('Buy')).toBeTruthy();
    expect(screen.getAllByText('Factor IC weak').length).toBeGreaterThan(0);
    expect(screen.getByText('+5.86%')).toBeTruthy();
    expect(screen.getByText('+12.00%')).toBeTruthy();
  });

  it('refreshes a watch through the API', async () => {
    const spy = mockFetch();

    render(<SignalsPage />);
    await screen.findByRole('heading', { name: 'Hedge' });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/api/strategy/watches/3/refresh'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows an empty state without watches', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));

    render(<SignalsPage />);

    expect(await screen.findByText('No watched strategies yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /open strategy lab/i })).toBeTruthy();
  });
});
