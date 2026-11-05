/**
 * The translated menu, ready for paper.
 *
 * A plain server-rendered page: categories and dishes in the chosen
 * language, using the same fallback rule as the guest screen (original when
 * a translation is missing or outdated), prices always as written. The
 * browser's own print makes the copy; nothing here writes to the database.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslateData } from '@/lib/db/translate';
import {
  LANGUAGE_LABELS,
  translatedDescription,
  translatedName,
  type GuestLanguage,
  type TranslationMap,
} from '@/lib/i18n/translations';
import { PrintButton } from '@/components/PrintButton';
import { btn } from '@/components/owner/chrome';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Print translated menu · AutoDine',
  robots: { index: false, follow: false },
};

export default async function PrintTranslatePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language: GuestLanguage = lang === 'mr' ? 'mr' : lang === 'hi' ? 'hi' : 'en';
  const data = await getTranslateData();

  const tName = (name: string, description: string, translations?: TranslationMap) =>
    translatedName(translations, language, name, description);
  const tDesc = (name: string, description: string, translations?: TranslationMap) =>
    translatedDescription(translations, language, name, description);

  return (
    <main className="mx-auto max-w-[680px] px-5 py-8 text-gink">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/dashboard/menus/translate" className="text-[12.5px] text-gink-46 underline-offset-2 hover:underline">
          ← Back to the translator
        </Link>
        <div className="flex items-center gap-2">
          {(['en', 'hi', 'mr'] as GuestLanguage[]).map((code) => (
            <Link
              key={code}
              href={`/dashboard/menus/translate/print?lang=${code}`}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                code === language ? 'border-[var(--p-accent)] text-gink' : 'border-hair text-gink-46 hover:text-gink'
              }`}
            >
              {LANGUAGE_LABELS[code]}
            </Link>
          ))}
          <PrintButton className={btn('ghost', 'sm')}>Print</PrintButton>
        </div>
      </div>

      <header className="border-b border-hair pb-4">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">{data?.restaurantName ?? 'Menu'}</h1>
        <p className="m-0 mt-1 text-[13px] text-gink-46">
          {data?.menuName ?? ''}
          {language !== 'en' && ` · ${LANGUAGE_LABELS[language]}`}
        </p>
      </header>

      {!data || (data.items.length === 0 && data.categories.length === 0) ? (
        <p className="mt-5 text-[13px] text-gink-46">There is nothing on this menu to print yet.</p>
      ) : (
        <div className="mt-5">
          {[
            ...data.categories.map((category) => ({ ...category, kind: 'category' as const })),
            // Dishes with no category belong to no section — they print last,
            // under no heading, exactly as the guest menu shows them.
            { id: '', name: '', translations: {}, kind: 'uncategorised' as const },
          ].map((group) => {
            const groupItems = data.items.filter((item) =>
              group.kind === 'uncategorised' ? item.categoryId === '' : item.categoryId === group.id
            );
            if (group.kind === 'category' && groupItems.length === 0) return null;
            if (groupItems.length === 0) return null;
            return (
              <section key={group.id || 'uncategorised'} className="mb-6">
                {group.kind === 'category' && (
                  <h2 className="m-0 mb-2 text-[17px] font-semibold tracking-[-0.012em]">
                    {tName(group.name, '', group.translations)}
                  </h2>
                )}
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {groupItems.map((item) => (
                    <li key={item.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13.5px] font-medium">
                          {tName(item.name, item.description, item.translations)}
                        </span>
                        <span className="text-[13px] tabular-nums text-gink-64">
                          {inr(paiseToRupees(item.pricePaise))}
                        </span>
                      </div>
                      {tDesc(item.name, item.description, item.translations) !== '' && (
                        <p className="m-0 mt-0.5 text-[12.5px] text-gink-64">
                          {tDesc(item.name, item.description, item.translations)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
