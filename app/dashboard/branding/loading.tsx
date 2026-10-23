import { DashboardBar } from '@/components/DashboardBar';
import { RouteSkeleton } from '@/components/RouteSkeleton';

/** Branding had no boundary of its own, so the newest screen was the one that
 *  fell back to the parent's dashboard skeleton. */
export default function Loading() {
  return (
    <div className="pg pg--dash">
      <DashboardBar active="branding" />
      <RouteSkeleton variant="dashboard" />
    </div>
  );
}
