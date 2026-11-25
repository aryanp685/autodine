import Image from 'next/image';
import { BrandMark } from '@/components/BrandMark';

/** A clearly-labelled sample of the restaurant workspace, not live account data. */
export function AuthProductPreview() {
  return (
    <div className="auth-product-preview relative mx-auto w-full max-w-[500px] px-3 pt-7 sm:px-5 sm:pt-8">
      <div
        aria-hidden="true"
        className="absolute top-4 right-8 h-28 w-40 rotate-6 rounded-[26px] border border-white/20 bg-white/10"
      />
      <section
        aria-label="AutoDine sample workspace preview"
        className="relative overflow-hidden rounded-[24px] border border-[#eee5d8] bg-[#fffdf8] text-[#26382e] shadow-[0_24px_60px_-32px_rgba(0,0,0,0.5)] sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#eee7dc] px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#1f3d2e]">
              <BrandMark size={19} ink="#fffdf8" dot="#f08a55" tone="auth-preview" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold tracking-[-0.03em] sm:text-[13px]">The Urban Table</span>
              <span className="block text-[9px] text-[#7a8179] sm:text-[10px]">Restaurant workspace</span>
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#f4eee4] px-2.5 py-1.5 text-[9px] font-medium text-[#667168] sm:text-[10px]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#e97937]" />
            SAMPLE PREVIEW
          </span>
        </header>

        <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_150px] sm:gap-4 sm:p-4">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold tracking-[0.13em] text-[#8a8d83] uppercase sm:text-[10px]">Service overview</p>
                <p className="mt-1 text-[17px] leading-tight font-semibold tracking-[-0.04em] sm:text-[19px]">Good evening</p>
              </div>
              <span className="rounded-full bg-[#eaf1e9] px-2 py-1 text-[9px] font-medium text-[#315b43] sm:text-[10px]">Demo data</span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ['Orders', '08'],
                ['Tables', '12'],
                ['Ready', '03'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[13px] border border-[#eee7dc] bg-[#faf7f1] px-2.5 py-2 sm:rounded-[15px] sm:px-3 sm:py-2.5">
                  <p className="text-[8px] text-[#85877e] sm:text-[9px]">{label}</p>
                  <p className="mt-0.5 text-[14px] font-semibold tabular-nums tracking-[-0.03em] text-[#26382e] sm:text-[16px]">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2.5 rounded-[15px] border border-[#eee7dc] bg-white p-2.5 sm:mt-3.5 sm:gap-3 sm:rounded-[17px] sm:p-3">
              <div className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-[#f4eee4] sm:size-11">
                <Image src="/img/dishes/butter-chicken.jpg" alt="" fill sizes="44px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-[#303a32] sm:text-[11px]">Butter Chicken · Table 05</p>
                <p className="mt-0.5 text-[9px] text-[#83877e] sm:text-[10px]">Kitchen is preparing</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#fff0e5] px-2 py-1 text-[8px] font-semibold text-[#a95120] sm:text-[9px]">2 min</span>
            </div>
          </div>

          <aside className="hidden rounded-[18px] bg-[#1f3d2e] p-3.5 text-white sm:flex sm:flex-col sm:justify-between">
            <div>
              <p className="text-[9px] font-medium tracking-[0.13em] text-white/65 uppercase">Order flow</p>
              <p className="mt-1 text-[12px] font-semibold">One smooth service</p>
            </div>
            <ol className="mt-3 space-y-2.5">
              {['Guest scans QR', 'Order reaches kitchen', 'Pay at the counter'].map((step, index) => (
                <li key={step} className="flex items-center gap-2 text-[9px] leading-snug text-white/85">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-[8px] font-semibold text-[#ffc18d]">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-3 border-t border-white/15 pt-2.5 text-[8px] leading-relaxed text-white/65">Illustrative sample · not live restaurant data</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
