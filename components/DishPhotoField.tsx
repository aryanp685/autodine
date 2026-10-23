'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DishPhoto } from '@/components/DishPhoto';
import { MAX_BYTES, validateImage } from '@/lib/storage/assets';
import { removeDishPhotoAction, uploadDishPhotoAction } from '@/app/dashboard/menus/actions';
import { btn } from '@/components/owner/chrome';

/**
 * The dish photo control.
 *
 * FOUR STATES, ALL DRAWN
 *
 *   has a photo   -> the photo, with Replace and Remove
 *   no photo      -> the initials tile DishPhoto already draws, with Add photo
 *   uploading     -> the browser form is pending; the button says so and is
 *                    disabled so a double tap cannot start two uploads
 *   invalid file  -> checked HERE before anything is sent, because a 9 MB
 *                    video's rejection should not cost a round trip and an
 *                    opaque server error
 *
 * WHY A CLIENT COMPONENT AT ALL
 *
 * The rest of this screen is server actions and plain forms, and that is the
 * right default. This one control needs to know what the browser is doing
 * (`useFormStatus`) and to look at the picked file before sending it. Both are
 * browser-only facts, so the client boundary is exactly here and nowhere
 * higher.
 *
 * The server re-validates everything: `validateImage` is the same function on
 * both sides, and the Storage bucket enforces mime and size again.
 */

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={btn('solid', 'sm')} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function DishPhotoField({
  itemId,
  dishName,
  imageUrl,
  disabled,
}: {
  itemId: string;
  dishName: string;
  imageUrl?: string | null;
  disabled?: boolean;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A file picked for the previous dish must not follow you to the next one:
  // the input is uncontrolled and would otherwise still hold it.
  useEffect(() => {
    setPicked(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [itemId]);

  return (
    <div data-dish-photo-field>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-[12px] font-medium text-gink">Photo</h4>
        <span className="text-[11px] leading-[1.4] text-gink-46">
          {imageUrl ? 'Shown on the menu and the cart.' : 'Optional. Without one, guests see initials.'}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-3">
        {/* The photo is the control's own preview, at the size it is drawn in
            the editor, so a replacement can be judged without saving it. */}
        <DishPhoto src={picked ?? imageUrl} name={dishName} size={84} />

        <div className="flex min-w-0 flex-col gap-1.5">
          <form action={uploadDishPhotoAction} className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="itemId" value={itemId} />
            {/* A label wrapping a file input: one target, and the browser's
                own picker. The input itself is 1px and invisible rather than
                `display:none`, which some browsers refuse to open. */}
            <label
              className={[
                'relative inline-flex h-8 cursor-pointer items-center rounded-full border border-hair-strong px-3',
                'text-[12px] font-medium text-gink transition-colors hover:border-gink-28 hover:bg-gink-07',
                'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gink',
                disabled ? 'pointer-events-none opacity-45' : '',
              ].join(' ')}
            >
              <input
                ref={inputRef}
                type="file"
                name="photo"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled}
                required
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    setPicked(null);
                    setLocalError(null);
                    return;
                  }
                  const checked = validateImage(file);
                  if (!checked.ok) {
                    setLocalError(checked.message);
                    setPicked(null);
                    return;
                  }
                  if (file.size > MAX_BYTES.dish) {
                    setLocalError(
                      `That photo is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 4 MB.`
                    );
                    setPicked(null);
                    return;
                  }
                  setLocalError(null);
                  setPicked(URL.createObjectURL(file));
                }}
              />
              <span>{imageUrl ? 'Choose another' : 'Choose a photo'}</span>
            </label>
            <Submit label={imageUrl ? 'Replace' : 'Upload'} pendingLabel="Uploading…" />
          </form>

          {imageUrl && (
            <form action={removeDishPhotoAction}>
              <input type="hidden" name="itemId" value={itemId} />
              <button
                type="submit"
                data-remove-photo
                className="h-7 rounded-full px-2 text-[11.5px] font-medium text-gink-46 transition-colors hover:bg-[var(--alert)]/8 hover:text-[var(--alert)] disabled:opacity-45"
                disabled={disabled}
              >
                Remove photo
              </button>
            </form>
          )}
        </div>
      </div>

      {localError && (
        <p role="alert" className="mt-2 text-[11.5px] leading-[1.45] text-[var(--alert)]">
          {localError}
        </p>
      )}
      <p className="mt-1.5 text-[11px] leading-[1.45] text-gink-46">JPG, PNG or WebP · up to 4 MB</p>
    </div>
  );
}
