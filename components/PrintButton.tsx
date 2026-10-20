'use client';

/**
 * Prints the current page.
 *
 * A client component because window.print() only exists in the browser.
 * What actually gets printed is controlled by the @media print block in
 * styles/design-system.css, which hides the app chrome and leaves only the
 * print sheet -- without that block this would print the whole dashboard
 * navigation around every card.
 */
export function PrintButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}
