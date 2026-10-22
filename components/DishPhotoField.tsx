'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DishPhoto } from '@/components/DishPhoto';
import { MAX_BYTES, validateImage } from '@/lib/storage/assets';
import { removeDishPhotoAction, uploadDishPhotoAction } from '@/app/dashboard/menus/actions';

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
    <button type="submit" className="pg__btn" disabled={pending} aria-busy={pending}>
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
    <div className="dishPhotoField">
      <div className="dishPhotoField__head">
        <h4 className="dishPhotoField__title">Photo</h4>
        <span className="pg__fine">
          {imageUrl ? 'Shown on the menu and the cart.' : 'Optional. Without one, guests see initials.'}
        </span>
      </div>

      <div className="dishPhotoField__body">
        <div className="dishPhotoField__preview">
          <DishPhoto src={picked ?? imageUrl} name={dishName} size={84} className="dishPhotoField__img" />
        </div>

        <div className="dishPhotoField__controls">
          <form action={uploadDishPhotoAction} className="dishPhotoField__form">
            <input type="hidden" name="itemId" value={itemId} />
            <label className="brand__picker">
              <input
                ref={inputRef}
                type="file"
                name="photo"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled}
                required
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
              <button type="submit" className="dishPhotoField__remove" disabled={disabled}>
                Remove photo
              </button>
            </form>
          )}
        </div>
      </div>

      {localError && (
        <p className="dishPhotoField__error" role="alert">
          {localError}
        </p>
      )}
      <p className="pg__fine">JPG, PNG or WebP · up to 4 MB</p>
    </div>
  );
}
