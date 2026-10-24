/**
 * Where the six digits are, said once, in the same words everywhere.
 *
 * WHY IT IS A LIST OF PLACES AND NOT A SENTENCE
 *
 * The old copy said "there is a code showing on a screen inside the
 * restaurant". That is true and it is useless to somebody who has just sat
 * down facing a wall: it does not tell them where to LOOK. The three places
 * below are the three ways this product actually shows a code -- the owner's
 * Tables screen, the full-screen board (Dashboard → Guest code display), and
 * whatever the restaurant prints and puts on the table. Naming them turns a
 * puzzle into a glance.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY
 *
 * No "contact support", no ticket, no phone number. A guest standing in the
 * restaurant can always solve this by asking a person who is ten feet away,
 * and that person can read the digits off a screen they already have open.
 *
 * It also never suggests the guest guess. Six digits is a million
 * possibilities and five wrong tries closes the door for fifteen minutes, so
 * "try the obvious ones" is advice that actively hurts.
 */

export function WhereToFindCode({
  windowMinutes,
  variant = 'inline',
}: {
  /** How often the code rolls, for the sentence about screenshots. */
  windowMinutes: number;
  /** `inline` inside a card, `panel` as the block on the full verify screen. */
  variant?: 'inline' | 'panel';
}) {
  const every = windowMinutes === 1 ? 'minute' : `${windowMinutes} minutes`;

  const places = [
    {
      where: 'The counter or till',
      detail: 'A screen or tablet there shows today’s six digits in large type.',
    },
    {
      where: 'Your table',
      detail: 'Some restaurants print the display and stand it on the table.',
    },
    {
      where: 'Any member of staff',
      detail: 'They can read the current code out to you — it is on their screen.',
    },
  ];

  return (
    <div
      className={
        variant === 'panel'
          ? 'mt-4 rounded-[16px] border border-hair bg-white/50 px-4 py-4'
          : 'rounded-[14px] border border-hair bg-white/45 px-4 py-4'
      }
    >
      <p className="m-0 text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">
        Where to find the code
      </p>
      <ul className="mt-2.5 m-0 flex list-none flex-col gap-2.5 p-0">
        {places.map((place) => (
          <li key={place.where} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--p-accent)]"
            />
            <span className="min-w-0 text-[12.5px] leading-[1.55] text-gink-64">
              <strong className="font-semibold text-gink">{place.where}.</strong> {place.detail}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 mb-0 text-[11.5px] leading-[1.55] text-gink-46">
        The digits change every {every}. A screenshot older than that will not work — that is on
        purpose, so a code photographed at one table cannot be used at another.
      </p>
    </div>
  );
}
