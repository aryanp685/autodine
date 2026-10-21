'use client';

import { useState } from 'react';

type PasswordInputProps = {
  id: string;
  name: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
};

export function PasswordInput({
  id,
  name,
  autoComplete,
  placeholder,
  minLength,
  maxLength = 128,
  required = true,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="auth__passwordWrap">
      <input
        className="ui-input auth__passwordInput"
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={maxLength}
        required={required}
      />
      <button
        className="auth__passwordToggle"
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}
