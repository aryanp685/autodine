import { DashboardBar } from '@/components/DashboardBar';
import { RouteSkeleton } from '@/components/RouteSkeleton';

/**
 * The counter's loading boundary carries the shell, for the same reason the
 * dashboard's does: the navigation must not blink out between two staff
 * screens. It is `rows` rather than `dashboard` because the counter is a queue
 * of tickets, not a set of stat cards.
 */
export default function Loading() {
  return (
    <div className="pg pg--dash" data-surface="owner">
      <DashboardBar active="counter" />
      <RouteSkeleton variant="rows" />
    </div>
  );
}
