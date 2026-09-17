'use client';

import { useEffect, useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';

import type { VersionInfo } from '@/types';

export default function UpdateBadge() {
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    // Deferred so the state is not set synchronously inside the effect.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = (await response.json()) as VersionInfo;
        if (payload?.update_available === true) setVersion(payload);
      } catch {
        // Offline or GitHub unreachable: stay quiet.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!version) return null;

  const title = `Update available: ${version.current} → ${version.latest ?? '?'}\nUpdate with:\n${version.instructions ?? 'git pull && docker compose up -d --build'}`;

  return (
    <a
      href={version.release_url ?? '#'}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="inline-flex items-center gap-2 rounded-lg border border-[#facc15]/60 bg-[#facc15]/10 px-3 py-2 text-sm font-medium text-[#facc15] transition-colors hover:bg-[#facc15]/20"
    >
      <ArrowUpCircle size={15} />
      Update {version.latest}
    </a>
  );
}
