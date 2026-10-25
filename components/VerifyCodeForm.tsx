'use client';

/**
 * The six-digit form on a table's card page.
 *
 * A client component for one reason: the sixth digit is the answer. Typing it
 * and then reaching for a button is two actions where one will do, and this is
 * done standing up, one-handed, in a loud room, with the code changing every
 * ten minutes. The form submits itself the moment the sixth digit lands.
 *
 * WHAT STOPS IT MISBEHAVING
 *
 *   - The submit is guarded by a ref, not by state: `requestSubmit()` twice in
 *     the same tick would otherwise post twice, and the second attempt would
 *     be recorded as a wrong code against the same guest.
 *   - Only digits are kept. A phone keyboard can produce spaces, dashes or a
 *     pasted "482 931", and the pattern attribute alone would not strip them.
 *   - A paste of six digits submits on the same tick it is pasted.
 *   - While the action runs the field and button are disabled, so the form
 *     cannot be re-posted by an impatient thumb.
 *
 * The token is a hidden field rather than part of the action URL, so it is
 * posted in the body and not written into logs and history twice.
 */

import { useEffect, useRef, useState } from 'react';
import { verifyTableCodeAction } from '@/app/t/[token]/actions';

export function VerifyCodeForm({
  token,
  windowMinutes,
  next,
  cta,
}: {
  token: string;
  windowMinutes: number;
  /** Path to return to after the code is accepted; narrowed server-side. */
  next?: string;
  /** Label for the submit button, so it says what the code unlocks. */
  cta?: string;
}) {
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const complete = code.length === 6;

  const send = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSending(true);
    formRef.current?.requestSubmit();
  };

  // A wrong code re-renders this page with ?e=wrong and a fresh form. The
  // submitted flag lives in the component that is unmounted on navigation, so
  // it does not need clearing -- but the field does, so the guest can retype
  // without selecting six digits first.
  useEffect(() => {
    if (code.length === 6) send();
  }, [code]);

  return (
    <form ref={formRef} className="mt-6 max-w-[380px]" action={verifyTableCodeAction}>
      <input type="hidden" name="token" value={token} />
      {/* Posted in the body, like the token: it is a path this app knows, and
          the action narrows it again before redirecting. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="block">
        <span className="mb-2 block text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">
          Six-digit code
        </span>
        <input
          ref={inputRef}
          /* Six monospaced cells' worth of space, so the digits sit where
             the eye expects them and the field does not jump as they arrive. */
          className="tnum w-full rounded-[16px] border border-white/70 bg-white/70 px-4 py-3.5 text-center text-[27px] font-semibold tracking-[0.42em] text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:tracking-[0.34em] placeholder:text-gink-46 focus:border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] focus:bg-white focus:outline-none"
          name="code"
          // inputMode brings up the keypad on a phone; one-time-code lets iOS
          // and Android offer the code from the message that delivered it.
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          aria-describedby="code-hint"
          required
          autoFocus
          value={code}
          disabled={sending}
          onChange={(event) => {
            // Stripping here, not in validation: what is on screen must be
            // what will be sent.
            const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
            submittedRef.current = false;
            setCode(digits);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (pasted.length === 6) {
              event.preventDefault();
              submittedRef.current = false;
              setCode(pasted);
            }
          }}
        />
      </label>

      <button
        type="submit"
        disabled={sending || !complete}
        className="mt-3 h-11 w-full rounded-full bg-[var(--p-accent)] text-[13.5px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-40"
      >
        {sending ? 'Checking…' : (cta ?? 'Open the menu')}
      </button>

      <p className="mt-2.5 text-[11.5px] leading-[1.6] text-gink-46" id="code-hint">
        {complete && !sending
          ? 'Checking that code…'
          /* The order of these two sentences is the product decision: a guest
             reads the code off the screen at the counter, and a person is the
             fallback rather than the instruction. The old line ("ask a member
             of staff") made the human the first answer, which is the workflow
             this product exists to remove -- and it contradicted the
             WhereToFindCode list, which puts the screen first. */
          : `The code is on the screen at the counter or till, and it changes every ${windowMinutes === 1 ? 'minute' : `${windowMinutes} minutes`}. If you cannot see that screen, anyone on the floor can read the current digits to you. Too many tries from one phone pause this for fifteen minutes, so please check the digits first.`}
      </p>
    </form>
  );
}
