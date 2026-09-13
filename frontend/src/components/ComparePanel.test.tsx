import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ComparePanel from './ComparePanel';

const histories: Record<string, object[]> = {
  JUPUSDT: [
    { timestamp: '2025-01-01T00:00:00', open: 0.5, high: 0.5, low: 0.5, close: 0.5, volume: 1 },
    { timestamp: '2025-01-02T00:00:00', open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ],
  DASHBTC: [
    { timestamp: '2025-01-01T00:00:00', open: 100, high: 100, low: 100, close: 100, volume: 1 },
    { timestamp: '2025-01-02T00:00:00', open: 50, high: 50, low: 50, close: 50, volume: 1 },
  ],
};

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const symbol = url.includes('JUP') ? 'JUPUSDT' : 'DASHBTC';
    return new Response(JSON.stringify(histories[symbol]), { status: 200 });
  });
}

describe('ComparePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one line per symbol', async () => {
    mockFetch();
    const { container } = render(
      <ComparePanel symbols={['JUPUSDT', 'DASHBTC']} onRemove={vi.fn()} onClear={vi.fn()} />,
    );

    await screen.findByRole('img', { name: /Coin comparison chart/i });
    const seriesPaths = Array.from(container.querySelectorAll('path')).filter((path) =>
      ['#ffd87f', '#54d7ee'].includes(path.getAttribute('stroke') ?? ''),
    );
    expect(seriesPaths).toHaveLength(2);
  });

  it('shows proportional multiples and percentage change on hover', async () => {
    mockFetch();
    render(<ComparePanel symbols={['JUPUSDT', 'DASHBTC']} onRemove={vi.fn()} onClear={vi.fn()} />);

    const chart = await screen.findByRole('img', { name: /Coin comparison chart/i });
    fireEvent.mouseMove(chart, { clientX: 800 });

    const tooltip = await screen.findByTestId('compare-tooltip');
    expect(tooltip.textContent).toContain('JUPUSDT');
    expect(tooltip.textContent).toContain('2.00x');
    expect(tooltip.textContent).toContain('DASHBTC');
    expect(tooltip.textContent).toContain('0.50x');
    expect(tooltip.textContent).toContain('(+100.0%)');
  });
});
