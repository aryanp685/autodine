'use client';

/**
 * The description field with the writer behind it.
 *
 * The button fills the field; nothing else happens. The text sits here for
 * the owner to read and edit, and only the form's own Save writes it — the
 * same as every keystroke they would have typed. Replacing text that is
 * already there takes a second, confirming press: the AI never overwrites
 * an existing description on one click.
 */

import { useState, useTransition } from 'react';
import { textareaClass } from '@/components/owner/chrome';
import { generateDescriptionsAction } from '@/app/(staff)/dashboard/menus/actions';

export function AiDescriptionField({
  itemId,
  defaultValue,
  configured,
}: {
  itemId: string;
  defaultValue: string;
  /** False keeps the field plain: the writer is not switched on here. */
  configured: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [armed, setArmed] = useState(false);
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState('');

  if (!configured) {
    return <textarea className={textareaClass} name="description" rows={3} defaultValue={defaultValue} />;
  }

  const write = () => {
    if (value.trim() !== '' && !armed) {
      // Existing text (typed or saved) is never replaced on one click.
      setArmed(true);
      return;
    }
    setArmed(false);
    setProblem('');
    startTransition(async () => {
      const [result] = await generateDescriptionsAction([{ id: itemId }]);
      if (result && result.ok) {
        setValue(result.description);
      } else {
        setProblem(result ? result.reason : 'The writer could not be reached. Try again.');
      }
    });
  };

  return (
    <div>
      <textarea
        className={textareaClass}
        name="description"
        rows={3}
        maxLength={300}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setArmed(false);
        }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={write}
          disabled={busy}
          className="rounded-[var(--p-r-chip)] border border-hair px-2.5 py-1 text-[12.5px] text-gink transition-colors duration-150 hover:bg-gink-07 disabled:opacity-45"
        >
          {busy ? 'Writing…' : armed ? 'Replace current text?' : '✨ Write with AI'}
        </button>
        {problem !== '' && (
          <span className="text-[11.5px] text-gink-46" role="status">
            {problem}
          </span>
        )}
      </div>
    </div>
  );
}
