'use client';

import { useState, type ReactNode } from 'react';

type PreviewActionProps = {
  children: ReactNode;
  className: string;
  message: string;
  print?: boolean;
};

/** A demo-safe control: it responds visibly without pretending to write live data. */
export function PreviewAction({ children, className, message, print = false }: PreviewActionProps) {
  const [notice, setNotice] = useState('');

  function activate() {
    if (print) {
      window.print();
      return;
    }
    setNotice(message);
  }

  return (
    <span className="preview-action">
      <button type="button" className={`${className} preview-action__button`} onClick={activate}>
        {children}
      </button>
      {notice && <span className="preview-action__notice" role="status">{notice}</span>}
    </span>
  );
}
