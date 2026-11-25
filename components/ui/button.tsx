import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

/** Small, local shadcn-style button primitive for public marketing pages. */
export type ButtonVariant = 'default' | 'outline' | 'ghost';
export type ButtonSize = 'default' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-brass px-6 text-cream shadow-[0_14px_30px_-18px_rgba(191,84,28,0.75)] hover:-translate-y-0.5 hover:bg-brass-strong hover:text-ink',
  outline: 'border border-forest/25 bg-white/80 px-6 text-forest hover:-translate-y-0.5 hover:border-forest/40 hover:bg-white',
  ghost: 'px-4 text-forest hover:bg-forest-soft',
};

const SIZES: Record<ButtonSize, string> = {
  default: 'min-h-11 text-[13px]',
  lg: 'min-h-12 text-[14px]',
};

export function buttonClassName({
  variant = 'default',
  size = 'default',
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ');
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClassName({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  href,
  children,
  variant,
  size,
  className,
  prefetch,
  ...props
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  prefetch?: boolean;
} & Omit<ComponentProps<typeof Link>, 'href' | 'children' | 'className' | 'prefetch'>) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClassName({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
