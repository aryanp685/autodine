import { OwnerLoading } from '@/components/owner/chrome';

/** The floor skeleton keeps the rail and its highlight while the snapshot loads. */
export default function Loading() {
  return <OwnerLoading active="waiter" variant="board" />;
}
