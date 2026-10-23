/**
 * What is on screen while the next page is being fetched.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Every screen in this app is server-rendered from the database, so a
 * navigation is a real round trip. Without a loading boundary Next.js has
 * nothing to show in the gap: the browser stays on the old page, frozen, until
 * the new one is ready. On a phone that reads as "the site is slow", and on a
 * link that never resolves it reads as broken.
 *
 * A `loading.tsx` changes two things at once:
 *
 *   1. The click is acknowledged in the same frame. The skeleton is already in
 *      the client bundle, so it paints before the request leaves.
 *   2. Next.js can prefetch up to that boundary. Its own documentation is
 *      explicit: for a dynamic route it prefetches "up to the nearest route
 *      segment with a loading.js file ... If there is no loading file, it will
 *      not fetch the full tree." Every route here is dynamic, so before this
 *      file existed nothing was prefetched and every click started from zero.
 *
 * The shapes are deliberately approximate -- a bar where a heading goes, three
 * cards where three cards go. A skeleton that claims to know the exact layout
 * is a skeleton that jumps when the real content lands.
 *
 * It is aria-hidden: a screen reader gets the page it navigated to, not a
 * description of a placeholder. The live region in the layout announces the
 * route change, which is the part that helps.
 */
const bar = 'rounded-[3px] bg-paper-deep animate-[skelpulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60';

export function RouteSkeleton({
  variant = 'page',
}: {
  variant?: 'page' | 'rows' | 'board' | 'dashboard';
}) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-[1180px] content-start gap-3.5 px-5 pt-8 pb-24 sm:px-7 sm:pt-16"
    >
      <div className={`${bar} h-2 w-[92px]`} />
      <div className={`${bar} mt-2.5 h-[30px] w-[min(46%,420px)] max-sm:w-[74%] max-sm:h-6`} />
      <div className={`${bar} h-3 w-[min(62%,560px)] max-sm:w-full`} />

      {variant === 'page' && (
        <>
          <div className={`${bar} h-3 w-[min(38%,340px)]`} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="h-[132px] rounded-[14px] border border-hair bg-card animate-[skelpulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none" />
            <div className="h-[132px] rounded-[14px] border border-hair bg-card animate-[skelpulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none" />
          </div>
        </>
      )}

      {variant === 'rows' && (
        <div className="mt-5 border-t border-hair">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-b border-hair py-4">
              <div className={`${bar} h-3 w-[min(70%,520px)]`} />
              <div className={`${bar} h-3 w-16`} />
            </div>
          ))}
        </div>
      )}

      {variant === 'board' && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((col) => (
            <div key={col} className="grid content-start gap-3.5">
              {[0, 1].map((card) => (
                <div key={card} className="grid min-h-[120px] gap-2.5 rounded-[14px] border border-hair bg-card p-4">
                  <div className={`${bar} h-4 w-[52%]`} />
                  <div className={`${bar} h-3 w-[62%]`} />
                  <div className={`${bar} h-3 w-[38%]`} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {variant === 'dashboard' && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-[14px] border border-hair bg-card animate-[skelpulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
              />
            ))}
          </div>
          <div className="mt-5 border-t border-hair">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 border-b border-hair py-4">
                <div className={`${bar} h-3 w-[min(70%,520px)]`} />
                <div className={`${bar} h-3 w-16`} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
