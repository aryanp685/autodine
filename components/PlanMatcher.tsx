import Link from 'next/link';

/* ============================================================================
   "Which plan fits your restaurant."

   Three ways to describe a restaurant, each of which jumps to the plan that
   fits it and rings that card. It is honest by construction: the control does
   exactly what an anchor does, because that is what it is. No selection is
   stored, nothing is filtered out, and the back button behaves.

   It used to be a client component that published an attribute on <html> from
   an effect. That is a lot of machinery to move a ring, and a segmented
   control that cannot be "applied" reads as a choice that was not saved.
   ========================================================================== */

export type MatcherOption = { planId: string; label: string; hint: string };

export function PlanMatcher({ options }: { options: MatcherOption[] }) {
  return (
    <nav className="matcherBlock" aria-label="Which plan fits">
      <p className="matcherBlock__label">Which plan fits your restaurant</p>

      <div className="matcher">
        {options.map((option) => (
          <Link
            key={option.planId}
            href={`#plan-${option.planId}`}
            className="matcher__opt"
            title={option.hint}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <p className="matcherBlock__hint">
        Pick the closest description. Every plan stays visible, and none of them can be bought
        yet.
      </p>
    </nav>
  );
}
