import Link from 'next/link';

export function OrderMoreLink({ href }: { href: string }) {
  return (
    <Link href={href} data-order-more-ready="true" className="g-primary flex h-12 w-full items-center justify-center rounded-full text-[14px] font-semibold transition-transform duration-150 active:scale-[0.97]">
      Order something else
    </Link>
  );
}
