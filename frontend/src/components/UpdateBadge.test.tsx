import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UpdateBadge from './UpdateBadge';

describe('UpdateBadge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links to the release when a newer version exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            current: '1.1.0',
            latest: 'v1.2.0',
            update_available: true,
            release_url: 'https://github.com/alikula37/dip-radar/releases/tag/v1.2.0',
            instructions: 'docker compose pull && docker compose up -d --build',
          }),
          { status: 200 },
        ),
    );

    render(<UpdateBadge />);

    const link = await screen.findByRole('link', { name: /update v1\.2\.0/i });
    expect(link.getAttribute('href')).toContain('/releases/tag/v1.2.0');
    expect(link.getAttribute('title')).toContain('docker compose pull');
  });

  it('stays quiet when the app is current or offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            current: '1.1.0',
            latest: 'v1.1.0',
            update_available: false,
            release_url: null,
            instructions: null,
          }),
          { status: 200 },
        ),
    );

    render(<UpdateBadge />);

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
