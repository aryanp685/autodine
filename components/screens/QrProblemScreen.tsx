/**
 * Shown when a scanned code cannot be turned into a table.
 *
 * Every branch in the QR route ends here with a specific reason, because
 * "something went wrong" is no help to somebody standing at a table in a busy
 * room holding a phone. They need to know whether to scan again, ask staff,
 * or give up.
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
    <main className="pg">
      <div className="pg__qrProblem">
        <div className="pg__qrBadge" aria-hidden="true">
          ?
        </div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {staffHint ? <p className="pg__qrHint">{staffHint}</p> : null}
        <a className="pg__btn" href="/">
          AutoDine home
        </a>
      </div>
    </main>
  );
}
