/**
 * The translator screen — the owner-side half of R3 part 2.
 *
 * Side-by-side review: the original the owner wrote (never editable here —
 * it is edited in the editor) beside the translated text, per row, for
 * हिन्दी and मराठी. Generation fills only what is missing or outdated;
 * saving is the approval guests see. The print view is linked from here.
 */

import Link from 'next/link';
import { OwnerPage, PageHead, btn } from '@/components/owner/chrome';
import type { OutletBar } from '@/lib/outlets';
import { TranslationPanel, type TranslateRowModel } from '@/components/TranslationPanel';
import type { TranslateData } from '@/lib/db/translate';

export function MenuTranslateScreen({
  data,
  outlet,
  configured,
}: {
  data: TranslateData | null;
  outlet?: OutletBar | null;
  /** The translator is switched on for this deployment. */
  configured: boolean;
}) {
  const rows: TranslateRowModel[] = data
    ? [
        ...data.categories.map((category) => ({
          kind: 'category' as const,
          id: category.id,
          name: category.name,
          description: '',
          translations: category.translations,
        })),
        ...data.items.map((item) => ({
          kind: 'item' as const,
          id: item.id,
          name: item.name,
          description: item.description,
          translations: item.translations,
        })),
      ]
    : [];

  return (
    <OwnerPage active="menus" outlet={outlet}>
      <PageHead
        kicker="AI Menu Studio"
        title="Translate your menu"
        meta="Original on the left, translated on the right. Nothing saves until you accept it — guests see only saved translations, and always the original when one is missing."
        actions={
          <Link href="/dashboard/menus" className={btn('ghost', 'sm')}>
            Back to the menu editor
          </Link>
        }
      />

      {!data || rows.length === 0 ? (
        <p className="m-0 rounded-[var(--p-r-block)] border border-hair bg-card p-4 text-[13px] text-gink-46">
          {data
            ? 'Add dishes to the menu first — a translation needs something to translate.'
            : 'Connect the database to translate the menu.'}
        </p>
      ) : (
        <>
          {configured ? (
            <TranslationPanel rows={rows} />
          ) : (
            <p className="m-0 rounded-[var(--p-r-block)] border border-hair bg-card p-4 text-[13px] text-gink-46">
              Translation is not switched on for this deployment. Saved translations still show to guests — only
              generation is off.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-gink-46">Print the translated menu:</span>
            <Link href="/dashboard/menus/translate/print?lang=hi" className={btn('ghost', 'sm')}>
              हिन्दी
            </Link>
            <Link href="/dashboard/menus/translate/print?lang=mr" className={btn('ghost', 'sm')}>
              मराठी
            </Link>
          </div>
        </>
      )}
    </OwnerPage>
  );
}
