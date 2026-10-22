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
export function RouteSkeleton({
  variant = 'page',
}: {
  variant?: 'page' | 'rows' | 'board' | 'dashboard';
}) {
  return (
    <div className="skel" aria-hidden="true">
      <div className="skel__bar skel__bar--kicker" />
      <div className="skel__bar skel__bar--title" />
      <div className="skel__bar skel__bar--lede" />

      {variant === 'page' && (
        <>
          <div className="skel__bar skel__bar--lede skel__bar--short" />
          <div className="skel__cards">
            <div className="skel__card" />
            <div className="skel__card" />
          </div>
        </>
      )}

      {variant === 'rows' && (
        <div className="skel__rows">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skel__row">
              <div className="skel__bar skel__bar--row" />
              <div className="skel__bar skel__bar--num" />
            </div>
          ))}
        </div>
      )}

      {variant === 'board' && (
        <div className="skel__cols">
          {[0, 1, 2].map((col) => (
            <div key={col} className="skel__col">
              {[0, 1].map((card) => (
                <div key={card} className="skel__ticket">
                  <div className="skel__bar skel__bar--ticketHead" />
                  <div className="skel__bar skel__bar--lede" />
                  <div className="skel__bar skel__bar--short" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {variant === 'dashboard' && (
        <>
          <div className="skel__stats">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel__stat" />
            ))}
          </div>
          <div className="skel__rows">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skel__row">
                <div className="skel__bar skel__bar--row" />
                <div className="skel__bar skel__bar--num" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
