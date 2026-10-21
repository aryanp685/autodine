'use client';

import { useState } from 'react';
import { toDevanagari, unknownWords } from '@/lib/hindi';

/**
 * How a dish is said out loud.
 *
 * The kitchen board speaks Hindi, so a menu written in Latin has to be turned
 * into Devanagari before any voice can read it. lib/hindi.ts does that with a
 * menu dictionary plus rules, and never leaves a Latin letter in front of the
 * voice -- but "never wrong" is not the same as "always right", and the one
 * person who knows how their dish is pronounced is the owner.
 *
 * So this field exists. Empty is the normal state and means "say the name";
 * the preview underneath always shows the exact Devanagari the kitchen will
 * hear, so a correction can be judged by reading it rather than by pressing
 * save and going to listen on a tablet.
 *
 * Words that had to be guessed are named. That is the honest part: the board
 * is not pretending to know, it is showing which syllable is a guess.
 */
export function PronunciationField({
  name,
  spoken,
  disabled,
}: {
  /** The menu name, as the guest reads it. */
  name: string;
  /** The saved override, or '' when the name is enough. */
  spoken: string;
  disabled?: boolean;
}) {
  const [override, setOverride] = useState(spoken);

  const effective = override.trim() || name;
  const preview = toDevanagari(effective);
  const guessed = unknownWords(effective);

  return (
    <div className="ui-field pg__pron">
      <label className="ui-label" htmlFor="spokenName">
        Spoken name <span className="pg__fine">— how the kitchen hears it</span>
      </label>
      <input
        id="spokenName"
        className="ui-input"
        name="spokenName"
        value={override}
        disabled={disabled}
        placeholder={toDevanagari(name)}
        maxLength={120}
        onChange={(event) => setOverride(event.target.value)}
      />

      <p className="pg__pronPreview">
        <span className="pg__fine">Board says</span> {preview}
      </p>

      {guessed.length > 0 ? (
        <p className="pg__fine">
          Guessed, not known: <strong>{guessed.join(', ')}</strong>. Type the pronunciation above if
          it is wrong — the menu name stays as it is.
        </p>
      ) : (
        <p className="pg__fine">Every word is known. Nothing to check.</p>
      )}
    </div>
  );
}
