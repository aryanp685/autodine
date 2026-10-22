'use client';

/**
 * "Which plan fits?" — a segmented control that rings the matching plan.
 *
 * WHY THIS EXISTS
 *
 * Three plans with the same shape are hard to choose between, and the usual
 * fix — a dense comparison table — reads as a spreadsheet. This is the honest
 * version of a recommendation: the visitor says what their operation looks
 * like, and the card that matches gets a ring. Nothing is hidden, nothing is
 * disabled, every card keeps its own button, and if the visitor never touches
 * the control no card is highlighted at all.
 *
 * It is deliberately not a "recommended for you" badge computed from nothing.
 *
 * HOW THE RING REACHES THE CARDS
 *
 * The cards are Server Components rendered elsewhere in the tree, so this
 * component publishes the current match as an attribute on <html> and CSS does
 * the rest:
 *
 *     html[data-plan-match='professional'] .plan[data-plan-id='professional']
 *
 * One attribute, cleared to an empty string when deselected. The alternative —
 * moving three plan cards into the client bundle so a class name could be
 * passed down — is a lot of JavaScript for a border.
 */

import { useEffect, useId, useState } from 'react';

export type PlanMatchOption = {
  /** The plan this option points at, by id. Must match the card's data-plan-id. */
  planId: string;
  label: string;
  /** Shown under the control once selected, so the choice explains itself. */
  hint: string;
};

export function PlanMatcher({ options }: { options: ReadonlyArray<PlanMatchOption> }) {
  const [selected, setSelected] = useState<PlanMatchOption | null>(null);
  const labelId = useId();
  const hintId = useId();

  // Written to the document rather than passed down: the cards are rendered
  // outside this component. Auto-cleans on unmount so a navigation away cannot
  // leave a stale ring on the next page.
  useEffect(() => {
    const root = document.documentElement;
    if (selected) root.setAttribute('data-plan-match', selected.planId);
    else root.removeAttribute('data-plan-match');

    return () => root.removeAttribute('data-plan-match');
  }, [selected]);

  return (
    <div>
      <div className="matcher" role="group" aria-labelledby={labelId} aria-describedby={hintId}>
        <span id={labelId} className="sr-only">
          Which plan fits your restaurant
        </span>
        {options.map((option) => {
          const pressed = selected?.planId === option.planId;
          return (
            <button
              key={option.planId}
              type="button"
              className="matcher__opt"
              aria-pressed={pressed}
              onClick={() => setSelected(pressed ? null : option)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="matcher__hint" id={hintId} aria-live="polite">
        {selected ? selected.hint : 'Pick the closest description — every plan stays visible.'}
      </p>
    </div>
  );
}
