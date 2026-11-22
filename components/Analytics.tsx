'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track, type AnalyticsEventName } from '@/lib/analytics';

export function useAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    track({ name: 'page_viewed', properties: { path: pathname } });
  }, [pathname]);
  return {
    track: (name: AnalyticsEventName, properties?: Record<string, unknown>) => {
      track({ name, properties });
    },
  };
}

export function Analytics() {
  useAnalytics();
  return null;
}
