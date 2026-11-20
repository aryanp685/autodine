'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, type InputHTMLAttributes } from 'react';
import { inputClass } from '@/components/owner/chrome';

type FieldType = 'text' | 'email' | 'tel' | 'password';

/**
 * A labelled account field with the two things the plain inputs lacked: a
 * password reveal and a sentence telling you what is wrong, in the same place
 * the hint sits.
 *
 * Validation is presentation only. The input keeps its native attributes and
 * the server action underneath is unchanged, so a client message can never be
 * the thing that decides whether an account is created.
 */
export function AuthField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  required = false,
  minLength,
  hint,
  requiredMessage,
  invalidMessage,
  showRequirements = false,  inputMode,
  className = '',
}: {
  id: string;
  name: string;
  label: string;
  type?: FieldType;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
  requiredMessage?: string;
  invalidMessage?: string;
  /** Password only: a live checklist for the rule the server also enforces. */
  showRequirements?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  className?: string;
}) {
  const reduce = useReducedMotion();
  const describedBy = `${id}-help`;
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  const messageFor = (input: HTMLInputElement): string | null => {
    const validity = input.validity;
    if (validity.valueMissing) return requiredMessage ?? `${label} is required.`;
    if (validity.typeMismatch) return invalidMessage ?? 'Enter a valid email address.';
    if (validity.tooShort) return `Use at least ${minLength} characters.`;
    return null;
  };

  const check = (input: HTMLInputElement) => setError(messageFor(input));

  const passwordRules = [
    { label: `At least ${minLength ?? 10} characters`, met: (minLength ? value.length >= minLength : true) },
    { label: 'An uppercase letter', met: /[A-Z]/.test(value) },
    { label: 'A lowercase letter', met: /[a-z]/.test(value) },
    { label: 'A number', met: /[0-9]/.test(value) },
    { label: 'A special character', met: /[^\p{L}\p{N}\s]/u.test(value) },
    { label: 'No spaces at the start or end', met: value.length > 0 && value === value.trim() },
  ];
  const showChecklist = showRequirements && (touched || value.length > 0);

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-gink-64">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={type === 'password' && revealed ? 'text' : type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputClass} ${type === 'password' ? 'pr-12!' : ''} ${
            error ? 'border-[var(--p-due)]! focus:border-[var(--p-due)]! focus:ring-[color-mix(in_oklab,var(--p-due)_18%,transparent)]!' : ''
          }`}
          onInput={(event) => {
            setValue(event.currentTarget.value);
            if (error && event.currentTarget.validity.valid) setError(null);
          }}
          onBlur={(event) => {
            setTouched(true);
            if (event.currentTarget.value.trim()) check(event.currentTarget);
          }}
          onInvalid={(event) => {
            event.preventDefault();
            check(event.currentTarget);
          }}
        />

        {type === 'password' ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-1.5 my-auto grid size-9 place-items-center rounded-full text-gink-46 transition-colors hover:bg-gink-07 hover:text-gink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {revealed ? (
                <>
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.4 0 9 5.2 9 7a12 12 0 0 1-2.4 3.4M6.6 6.7C4.3 8.2 3 10.2 3 12c0 1.8 3.6 7 9 7a9.7 9.7 0 0 0 4.2-1" />
                </>
              ) : (
                <>
                  <path d="M3 12c0-1.8 3.6-7 9-7s9 5.2 9 7-3.6 7-9 7-9-5.2-9-7Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </>
              )}
            </svg>
          </button>
        ) : null}
      </div>

      <div id={describedBy} aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          {error ? (
            <motion.p
              key="error"
              initial={reduce ? false : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="mt-1.5 text-[11.5px] leading-[1.45] text-[var(--p-due)]"
            >
              {error}
            </motion.p>
          ) : hint ? (
            <p key="hint" className="mt-1.5 text-[11.5px] leading-[1.5] text-gink-46">
              {hint}
            </p>
          ) : null}
        </AnimatePresence>
      </div>

      {showChecklist ? (
        <ul aria-label="Password requirements" className="mt-2.5 grid list-none grid-cols-1 gap-1 p-0 text-[11px] sm:grid-cols-2">
          {passwordRules.map((rule) => (
            <li key={rule.label} className={rule.met ? 'flex items-center gap-1.5 text-forest' : 'flex items-center gap-1.5 text-gink-46'}>
              <span aria-hidden="true" className={`grid size-3.5 shrink-0 place-items-center rounded-full text-[8px] ${rule.met ? 'bg-forest-soft' : 'bg-gink-07'}`}>
                {rule.met ? '✓' : '·'}
              </span>
              <span>
                {rule.label}
                <span className="sr-only">{rule.met ? ' — met' : ' — not met yet'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A short, honest confirmation that the form is working, not stuck. */
export function AuthSpinner() {
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block size-3.5 rounded-full border-2 border-white/35 border-t-white"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
    />
  );
}
