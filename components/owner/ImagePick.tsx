'use client';

import { useRef, useState } from 'react';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { checkSize, validateImage, type AssetKind } from '@/lib/storage/assets';

/**
 * Choose a file, see what you chose, then upload it.
 *
 * WHY THIS EXISTS
 *
 * The branding screen used to be a label wrapping a hidden file input and a
 * separate "Upload" button. After picking a 5 MB photo the screen looked
 * exactly as it had before -- the picker closed, nothing was named, and the
 * only way to find out the file was too big was to press Upload and wait for
 * the server to say so. On a phone, at a restaurant, that is two round trips
 * and a guess.
 *
 * So the file is checked here first, with the same `validateImage` /
 * `checkSize` the server action uses -- same functions, so the message cannot
 * disagree with the write. The name and size are printed next to the control,
 * because "nothing happened" and "I picked the wrong photo" look identical
 * otherwise.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not upload by itself. Choosing a file is one decision; sending it is
 * another, and auto-submitting on change turns a mis-tap in the phone's gallery
 * into a live change to the guest menu. Upload stays a separate press.
 *
 * Without JavaScript this is still the plain form it was: the input posts, the
 * button submits, and the server validates -- the preview and the early
 * rejection are the only things that need the bundle.
 */
export function ImagePick({
  kind,
  name,
  action,
  label,
  replaceLabel,
  hint,
  disabled = false,
  current,
  uploadLabel = 'Upload',
}: {
  /** `logo` or `banner`: decides the size limit and the wording. */
  kind: Extract<AssetKind, 'logo' | 'banner'>;
  /** FormData field name the server action reads. */
  name: string;
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  replaceLabel: string;
  /** The limit, in the words the owner reads under the control. */
  hint: string;
  disabled?: boolean;
  /** Whether one is already set -- changes the label, not the behaviour. */
  current?: boolean;
  /**
   * The word on the submit button. Two of these render on one screen, and two
   * buttons called "Upload" are two identical names for two different writes
   * to a screen reader, to voice control, and to anybody skimming.
   */
  uploadLabel?: string;
}) {
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | null) => {
    if (!file) {
      setPicked(null);
      setProblem(null);
      return;
    }

    const type = validateImage(file);
    if (!type.ok) {
      setPicked(null);
      setProblem(type.message);
      // Clearing the input matters: without it the browser keeps the rejected
      // file and the next submit sends it anyway.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const size = checkSize(kind, file.size, type.extension);
    if (!size.ok) {
      setPicked(null);
      setProblem(size.message);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setPicked({ name: file.name, size: file.size });
    setProblem(null);
  };

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {/*
       * The picker wears the kit's button geometry, not a pill.
       *
       * It was `rounded-full h-8` -- a status shape at a height no other
       * control uses -- sitting next to a 36px rectangular Upload button on
       * the same line, so the row read as a chip beside a button. Pills on this
       * surface mean "a state", and this is a control. 10px radius, 36px, the
       * copper focus ring: the same object as every other action.
       */}
      <label
        className={[
          'relative inline-flex h-9 cursor-pointer items-center rounded-[var(--p-r-control)] border border-hair-strong bg-card px-3',
          'text-[12.5px] font-medium text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] transition-colors',
          'hover:border-gink-28 hover:bg-[color-mix(in_oklab,var(--p-accent-wash)_45%,var(--p-card))]',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--p-accent)]',
          disabled ? 'pointer-events-none opacity-45' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          required
          data-image-pick={kind}
          onChange={(event) => pick(event.currentTarget.files?.[0] ?? null)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span>{current ? replaceLabel : label}</span>
      </label>

      {/*
       * Not disabled just because nothing is picked yet: the check above runs
       * on the client, and with the bundle blocked there is no check -- so a
       * disabled button here would leave the form un-submittable for anyone
       * whose JavaScript did not arrive. `required` on the input already stops
       * an empty submit in the browser, and the server validates regardless.
       */}
      <SubmitButton pendingLabel="Uploading…" disabled={disabled || Boolean(problem)}>
        {uploadLabel}
      </SubmitButton>

      {problem ? (
        <p role="alert" className="basis-full text-[11.5px] leading-[1.45] text-[var(--p-due)]">
          {problem}
        </p>
      ) : picked ? (
        <p data-picked className="basis-full text-[11.5px] leading-[1.45] text-gink-64">
          {picked.name} · {(picked.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      ) : (
        <p className="basis-full text-[11.5px] leading-[1.45] text-gink-46">{hint}</p>
      )}
    </form>
  );
}
