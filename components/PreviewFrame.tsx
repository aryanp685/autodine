'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { directionList, screens, type DirectionId } from '@/lib/directions';

type Device = 'desktop' | 'tablet' | 'mobile';

export default function PreviewFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [device, setDevice] = useState<Device>('desktop');

  const parts = pathname.split('/').filter(Boolean);
  const dir = (parts[1] ?? '') as DirectionId | '';
  const screen = parts[2] ?? '';
  const onHub = parts.length < 3;

  return (
    <div className="proto-shell">
      <div className="proto-bar">
        <div className="proto-bar__brand">
          AutoDine <span>Design prototypes · Phase 1</span>
        </div>

        {!onHub && (
          <>
            <div className="proto-bar__group" role="group" aria-label="Design direction">
              {directionList.map((d) => (
                <Link
                  key={d.id}
                  href={`/design/${d.id}/${screen}`}
                  className="proto-bar__btn"
                  aria-pressed={dir === d.id}
                  title={`${d.code} — ${d.name}`}
                >
                  {d.id.toUpperCase()} · {d.name}
                </Link>
              ))}
            </div>

            <select
              className="proto-bar__btn proto-bar__select"
              value={screen}
              onChange={(e) => router.push(`/design/${dir}/${e.target.value}`)}
              aria-label="Jump to screen"
            >
              {screens.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.group} — {s.title}
                </option>
              ))}
            </select>
          </>
        )}

        <Link href="/design" className="proto-bar__btn">
          ← All directions
        </Link>

        <div className="proto-bar__spacer" />

        <div className="proto-bar__group" role="group" aria-label="Preview width">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              className="proto-bar__btn"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
            >
              {d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>

        <div className="proto-bar__note">
          <i className="proto-bar__dot" /> Demo data · no live payments
        </div>
      </div>

      <div className="proto-frame" data-device={device} data-dir={dir || 'hub'}>
        <div className="proto-frame__inner">{children}</div>
      </div>

      <div className="proto-foot">
        AutoDine prototype — fabricated sample content, static screens, no backend and no payment provider connected.
      </div>
    </div>
  );
}
