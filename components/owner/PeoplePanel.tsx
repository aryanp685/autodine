/**
 * Settings → People: who works here, and how somebody new gets in.
 *
 * THE PROBLEM THIS SCREEN SOLVES
 *
 * Until now a restaurant had exactly one login. The kitchen tablet, the
 * counter's phone and the owner's laptop were all the same account, which
 * means the tax rate lived one tap away from the person plating a dish. The
 * roles existed in the database from the first migration and there was no way
 * to hand one to a second person.
 *
 * WHAT IT SHOWS
 *
 *   - who has access, with the role that decides what they can open;
 *   - one button to mint a link, for a role, for a fixed number of days;
 *   - the pending links, with how long each has left and a way to cancel one;
 *   - the link itself, once, right after it is created.
 *
 * WHAT IT REFUSES TO SHOW
 *
 *   - A link that has already been created. The database keeps a hash, not the
 *     code; the only copy is the one on screen for ten minutes after minting.
 *     Saying so is better than a "show link" button that cannot work.
 *   - An empty team when the read failed. `data.unavailable` is rendered as a
 *     sentence; an empty list would read as "all my staff were removed".
 *   - A remove button that the database will refuse. Only an owner sees it,
 *     never against themselves as owner, and never for the last owner.
 */

import type { ReactNode } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { ConfirmSubmit } from '@/components/owner/ConfirmSubmit';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { Notice, Panel, Tag, selectClass, TableWrap, tableClass, Th, Td, Tr } from '@/components/owner/chrome';
import { dateTimeInZone } from '@/lib/db/time';
import { INVITABLE_ROLES, roleLabel, type TeamScreenData } from '@/lib/db/team';
import { expiresInWords, formatInviteCode, joinPath, type InviteFlash } from '@/lib/team-invite';
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
} from '@/app/(staff)/dashboard/settings/team-actions';

const ROLE_TONE = {
  owner: 'ink',
  manager: 'work',
  cashier: 'live',
  kitchen: 'neutral',
} as const;

function Row({ children }: { children: ReactNode }) {
  return <div className="border-t border-[var(--p-line-soft)] py-3 first:border-t-0 first:pt-0">{children}</div>;
}

export function PeoplePanel({
  data,
  flash,
  origin,
  disabled = false,
  timeZone = 'Asia/Kolkata',
}: {
  data: TeamScreenData | null;
  /** Present for ten minutes after a link is minted, and never again. */
  flash: InviteFlash | null;
  /** Absolute site origin, so the copied link works when pasted into a chat. */
  origin: string;
  disabled?: boolean;
  timeZone?: string;
}) {
  if (!data) {
    return (
      <Notice tone="due" label="The database is not connected.">
        There is no team to show and nobody to invite until a restaurant is connected.
      </Notice>
    );
  }

  if (!data.canManage) {
    return (
      <Notice tone="plain" label={<Tag tone="neutral">{roleLabel(data.role)}</Tag>}>
        <strong className="font-semibold text-gink">Only the owner or a manager manages the team.</strong>{' '}
        You can work in the restaurant with your own login; adding or removing people is theirs to do.
      </Notice>
    );
  }

  const joinUrl = flash ? `${origin}${joinPath(flash.code)}` : '';
  const rolesForCaller = INVITABLE_ROLES.filter(
    (option) => option.role !== 'manager' || data.isOwner,
  );

  return (
    <div className="flex flex-col gap-4">
      {data.unavailable ? (
        <Notice tone="due" label="Some of this could not be read.">
          {data.unavailable}
        </Notice>
      ) : null}

      {/* ------------------------------------------------------------- members */}
      <Panel
        title="Who has access"
        meta={`${data.members.length} ${data.members.length === 1 ? 'person' : 'people'}`}
        bodyClassName="px-0 py-0"
      >
        <TableWrap className="rounded-none border-0 shadow-none">
          <table className={tableClass} data-team-members>
            <caption className="sr-only">
              Everyone who can sign in to this restaurant, with their role.
            </caption>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Role</Th>
                <Th className="hidden sm:table-cell">Since</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => {
                /* The last owner is protected in the database. Drawing a
                   button that the function would refuse is the failure this
                   screen exists to avoid, so it is not drawn. */
                const isLastOwner =
                  member.role === 'owner' &&
                  data.members.filter((other) => other.role === 'owner').length <= 1;
                const removable = data.isOwner && !isLastOwner;
                return (
                  <Tr key={member.membershipId}>
                    <Td>
                      <span className="block font-medium text-gink">
                        {member.name ?? member.email ?? 'Staff member'}
                        {member.isSelf ? (
                          <span className="ml-1.5 text-[11.5px] font-normal text-gink-46">(you)</span>
                        ) : null}
                      </span>
                      {member.name && member.email ? (
                        <span className="block text-[11.5px] text-gink-46">{member.email}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <Tag tone={ROLE_TONE[member.role]}>{roleLabel(member.role)}</Tag>
                    </Td>
                    <Td className="hidden text-[12.5px] text-gink-46 sm:table-cell">
                      {dateTimeInZone(timeZone, member.joinedAt)}
                    </Td>
                    <Td>
                      {removable ? (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="membershipId" value={member.membershipId} />
                          <ConfirmSubmit
                            question={`Remove ${member.name ?? member.email ?? 'this person'} from the team? They lose access immediately.`}
                            confirmLabel="Remove"
                            tone="quiet"
                          >
                            Remove
                          </ConfirmSubmit>
                        </form>
                      ) : isLastOwner ? (
                        <span className="text-[11.5px] text-gink-46">The last owner cannot be removed</span>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
              {data.members.length === 0 ? (
                <Tr>
                  <Td className="text-gink-46">No members could be read.</Td>
                  <Td> </Td>
                  <Td className="hidden sm:table-cell"> </Td>
                  <Td> </Td>
                </Tr>
              ) : null}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      {/* --------------------------------------------------------- the new link */}
      {flash ? (
        <Panel
          title="Send this link"
          meta={`Works once · ${expiresInWords(flash.expiresAt)}`}
          bodyClassName="px-5 py-5"
          className="border-[var(--p-accent)]"
        >
          <p className="text-[13px] leading-[1.55] text-gink-64">
            Send this to your {roleLabel(flash.role).toLowerCase()} on WhatsApp or by message. It works
            once, for one person, and it expires. We cannot show it again — the database keeps only a
            fingerprint of it.
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <code
              id="team-new-invite-link"
              className="min-w-0 flex-1 truncate rounded-[var(--p-r-control)] border border-hair bg-[var(--p-surface-2)] px-3 py-2.5 text-[12.5px] text-gink"
            >
              {joinUrl}
            </code>
            <CopyButton value={joinUrl} selectId="team-new-invite-link" label="Copy link" />
          </div>
          <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
            If the code is read aloud instead, it is{' '}
            <strong className="font-semibold tracking-[0.08em] text-gink">
              {formatInviteCode(flash.code)}
            </strong>
            . They open {origin}
            <span className="text-gink">/join</span> and paste it.
          </p>
        </Panel>
      ) : null}

      {/* ------------------------------------------------------- invite someone */}
      <Panel
        title="Invite someone"
        meta="One role, one link, one use"
        bodyClassName="px-5 py-5"
      >
        <form action={createInviteAction} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-gink">Which role?</span>
            <select name="role" className={selectClass} defaultValue="cashier" disabled={disabled}>
              {rolesForCaller.map((option) => (
                <option key={option.role} value={option.role}>
                  {option.label} — {option.blurb}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-gink">How long should the link work?</span>
            <select name="days" className={selectClass} defaultValue="7" disabled={disabled}>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Creating…">Create invitation link</SubmitButton>
            <span className="text-[11.5px] text-gink-46">
              No email is sent, and nothing is charged. You share the link yourself.
            </span>
          </div>
        </form>

        <div className="mt-4 border-t border-[var(--p-line-soft)] pt-3.5">
          <h4 className="text-[12.5px] font-semibold text-gink">What each role can open</h4>
          <ul className="mt-2 flex list-none flex-col gap-1.5 p-0 text-[12.5px] leading-[1.5] text-gink-64">
            {INVITABLE_ROLES.filter((option) => data.isOwner || option.role !== 'manager').map((option) => (
              <li key={option.role}>
                <strong className="font-semibold text-gink">{option.label}</strong> — {option.blurb}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* ------------------------------------------------------ waiting links */}
      <Panel
        title="Waiting to be used"
        meta={`${data.invites.length} open`}
        bodyClassName="px-5 py-4"
      >
        {data.invites.length === 0 ? (
          <p className="text-[13px] leading-[1.55] text-gink-64">
            No open invitations. A link you create above appears here until somebody uses it or it
            expires.
          </p>
        ) : (
          <div className="flex flex-col">
            {data.invites.map((invite) => (
              <Row key={invite.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Tag tone={ROLE_TONE[invite.role]}>{roleLabel(invite.role)}</Tag>
                      <span className="text-[12.5px] text-gink-46">
                        {invite.expired ? 'expired' : `expires ${expiresInWords(invite.expiresAt)}`}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11.5px] text-gink-46">
                      Created {dateTimeInZone(timeZone, invite.createdAt)} · the link itself is not stored
                    </span>
                  </div>
                  {!invite.expired ? (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <ConfirmSubmit
                        question={`Cancel this invitation for a ${roleLabel(invite.role).toLowerCase()}? The link stops working immediately.`}
                        confirmLabel="Cancel it"
                        tone="quiet"
                      >
                        Cancel link
                      </ConfirmSubmit>
                    </form>
                  ) : (
                    <span className="text-[11.5px] text-gink-46">No longer works</span>
                  )}
                </div>
              </Row>
            ))}
          </div>
        )}
      </Panel>

      <p className="px-1 text-[11.5px] leading-[1.6] text-gink-46">
        Every one of these roles signs in with their own email and password, so the kitchen tablet is
        not your owner account. Roles are enforced by the database, not just by which buttons this page
        draws: a kitchen login cannot change a price, see a bill, or record a payment.
      </p>
    </div>
  );
}

