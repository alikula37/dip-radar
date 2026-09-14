import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RadarLoader } from './ui';

describe('RadarLoader', () => {
  it('announces a status with the provided label', () => {
    render(<RadarLoader label="Syncing market data…" />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Syncing market data…')).toBeTruthy();
  });

  it('falls back to a screen-reader-only text and hides the svg', () => {
    render(<RadarLoader />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    const svg = screen.getByRole('status').querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('scales to the requested size', () => {
    const { container } = render(<RadarLoader size="lg" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('168');

    const small = render(<RadarLoader size="sm" />);
    expect(small.container.querySelector('svg')?.getAttribute('width')).toBe('20');
  });
});
