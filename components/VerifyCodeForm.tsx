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
}: {
  token: string;
  windowMinutes: number;
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
    <form ref={formRef} className="gnote__form" action={verifyTableCodeAction}>
      <input type="hidden" name="token" value={token} />

      <label className="gnote__label">
        <span className="gnote__labelText">Six-digit code</span>
        <input
          ref={inputRef}
          className="gnote__code"
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

      <button className="gnote__submit" type="submit" disabled={sending || !complete}>
        {sending ? 'Checking…' : 'Open the menu'}
      </button>

      <p className="gnote__hintText" id="code-hint">
        {complete && !sending
          ? 'Checking that code…'
          : `The code changes every ${windowMinutes === 1 ? 'minute' : `${windowMinutes} minutes`}. If you cannot see it, ask a member of staff — they can read it out for you.`}
      </p>
    </form>
  );
}
