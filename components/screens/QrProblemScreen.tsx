import { GuestNote, GuestNoteActions, GuestNoteCta, GuestNoteText } from '@/components/GuestNote';

/**
 * Shown when a scanned code cannot be turned into a table.
 *
 * Every branch in the QR route ends here with a specific reason, because
 * "something went wrong" is no help to somebody standing at a table in a busy
 * room holding a phone. They need to know whether to scan again, ask staff,
 * or give up.
 *
 * The shell is the same one the code form and the bare-menu screen wear. This
 * page used to be the odd one out -- a centred badge, its own legacy classes,
 * a different type scale -- so a guest who scanned a dead card landed on
 * something that did not look like the restaurant's own product. Being told no
 * is a moment for the most familiar screen in the flow, not the least.
 */

export type QrProblemScreenProps = {
  /** Short, plain statement of what happened. */
  title: string;
  /** What the guest should do next. */
  detail: string;
  /** Staff-side hint, shown only when there is something useful to say. */
  staffHint?: string;
};

export function QrProblemScreen({ title, detail, staffHint }: QrProblemScreenProps) {
  return (
    <GuestNote
      eyebrow="Table access"
      title={title}
      steps="scan"
      foot={
        <>
          Ordering with staff always works. Behind the counter? The dashboard is at{' '}
          <a href="/dashboard/menus">Dashboard → Menus</a>.
        </>
      }
    >
      <GuestNoteText>{detail}</GuestNoteText>

      {staffHint ? (
        <p className="mt-3 max-w-[54ch] text-[12.5px] leading-[1.6] text-gink-46">{staffHint}</p>
      ) : null}

      <GuestNoteActions>
        <GuestNoteCta href="/">AutoDine home</GuestNoteCta>
      </GuestNoteActions>
    </GuestNote>
  );
}
