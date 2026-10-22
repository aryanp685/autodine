import { DashboardBar } from '@/components/DashboardBar';
import { RouteSkeleton } from '@/components/RouteSkeleton';

/**
 * The bar is part of the skeleton on purpose: the nav is the one thing that
 * should never blink out between two dashboard screens, and without it here
 * the whole top of the page disappears for the length of the fetch.
 */
export default function Loading() {
  return (
    <div className="pg">
      <DashboardBar />
      <RouteSkeleton variant="dashboard" />
    </div>
  );
}
