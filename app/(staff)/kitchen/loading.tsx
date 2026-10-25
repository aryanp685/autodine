import { OwnerLoading } from '@/components/owner/chrome';

/**
 * The board's skeleton carries the rail.
 *
 * It used to render a bare board, so a refresh of Kitchen dropped the whole
 * navigation for the length of the fetch and put it back a moment later --
 * exactly the blink the shell exists to avoid. `active` is set because here we
 * do know where we are.
 */
export default function Loading() {
  return <OwnerLoading active="kitchen" variant="board" />;
}
