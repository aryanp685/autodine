import type { HTMLAttributes } from 'react';

/** Local shadcn-style card pieces, kept token-driven for AutoDine's palette. */
function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        'rounded-[24px] border border-ink-line bg-ink-card text-cream shadow-[0_18px_48px_-34px_rgba(43,32,21,0.28)]',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

function CardHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['flex flex-col gap-1.5 p-6', className].filter(Boolean).join(' ')} {...props} />;
}

function CardTitle({ className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={['text-[16px] leading-none font-semibold tracking-[-0.025em]', className].filter(Boolean).join(' ')} {...props} />;
}

function CardDescription({ className = '', ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={['text-[13px] leading-relaxed text-mute', className].filter(Boolean).join(' ')} {...props} />;
}

function CardContent({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['px-6 pb-6', className].filter(Boolean).join(' ')} {...props} />;
}

function CardFooter({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['flex items-center gap-3 px-6 pb-6', className].filter(Boolean).join(' ')} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
