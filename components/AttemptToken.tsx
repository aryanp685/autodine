'use client';

/**
 * One checkout attempt, one key.
 *
 * WHY
 *
 * A "Place order" tap can reach the server more than once: an impatient second
 * tap before the button goes busy, a phone that re-sends the POST after the
 * connection drops, a guest with the same cart open in two tabs. Each of those
 * calls place_public_order, and without an identifier that belongs to the
 * attempt rather than to the request, each one writes a separate order -- which
 * is a double charge at the till and a double ticket in the kitchen.
 *
 * The key is generated once per page, on the client, and posted with the form.
 * place_public_order returns the existing order code when it sees a key it has
 * already written (see migration 20261027000900), so a replay lands on the
 * same confirmation instead of a second order.
 *
 * WHY NOT ON THE SERVER
 *
 * A key generated in the action is different on every call, so it identifies
 * nothing. It has to survive the retry, and the only thing that survives a
 * retry is something the browser keeps.
 *
 * WHY NOT IN RENDER
 *
 * `crypto.randomUUID()` during server render would produce one value on the
 * server and another in the browser, which is a hydration mismatch on a hidden
 * input. The field starts empty and is filled on mount; a form submitted before
 * that (there has to have been a tap, so there has been) falls back to the
 * server's own key.
 */
import { useEffect, useRef } from 'react';

export function AttemptToken({ name = 'attempt' }: { name?: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mint = () => {
      if (!ref.current) return;
      // A browser without randomUUID is old but still allowed to order -- it
      // just loses the replay protection, not the order.
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        ref.current.value = crypto.randomUUID();
      }
    };

    mint();

    /**
     * Back from a placed order.
     *
     * The browser restores this page from its back-forward cache with the key
     * that has already produced an order. Re-posting that key would return the
     * OLD order -- a guest who came back to order a second round would be told
     * their first one was placed again. So a restored page mints a new key: the
     * same form, a new attempt.
     */
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) mint();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return <input ref={ref} type="hidden" name={name} defaultValue="" />;
}
