import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PeoplePanel } from './PeoplePanel';
import type { TeamScreenData } from '@/lib/db/team';

/**
 * The People card is where an owner decides who can open the till.
 *
 * These tests are about what the screen is willing to claim: a role menu that
 * offers a manager invitation to somebody who cannot create one, or a Remove
 * button on the last owner, would be a button whose only possible answer is a
 * database error.
 */

vi.mock('@/app/(staff)/dashboard/settings/team-actions', () => ({
  createInviteAction: async () => undefined,
  revokeInviteAction: async () => undefined,
  removeMemberAction: async () => undefined,
}));

vi.mock('@/components/owner/ConfirmSubmit', () => ({
  // It holds an armed state and needs a mounted client; the question it would
  // ask is not what these tests are about.
  ConfirmSubmit: ({ children }: { children?: React.ReactNode }) => <button type="submit">{children}</button>,
}));

function team(over: Partial<TeamScreenData> = {}): TeamScreenData {
  return {
    role: 'owner',
    canManage: true,
    isOwner: true,
    members: [
      {
        membershipId: 'm-1',
        userId: 'u-1',
        role: 'owner',
        name: 'Asha Rao',
        email: 'asha@example.test',
        joinedAt: '2026-10-01T09:00:00.000Z',
        isSelf: true,
      },
      {
        membershipId: 'm-2',
        userId: 'u-2',
        role: 'cashier',
        name: null,
        email: 'counter@example.test',
        joinedAt: '2026-10-02T09:00:00.000Z',
        isSelf: false,
      },
    ],
    invites: [
      {
        id: 'i-1',
        role: 'kitchen',
        createdAt: '2026-10-20T09:00:00.000Z',
        expiresAt: '2026-10-27T09:00:00.000Z',
        expired: false,
      },
    ],
    ...over,
  };
}

const render = (data: TeamScreenData | null, flash = null as Parameters<typeof PeoplePanel>[0]['flash']) =>
  renderToStaticMarkup(
    <PeoplePanel data={data} flash={flash} origin="https://autodine.test" timeZone="Asia/Kolkata" />,
  );

describe('Settings → People', () => {
  it('lists everyone, says who is you, and shows the role', () => {
    const html = render(team());

    expect(html).toContain('Asha Rao');
    expect(html).toContain('(you)');
    expect(html).toContain('Owner');
    expect(html).toContain('Cashier');
    // A member without a name is still shown by the email they signed up with.
    expect(html).toContain('counter@example.test');
  });

  it('will not draw a remove button on the last owner', () => {
    const html = render(team());

    expect(html).toContain('The last owner cannot be removed');
    // The other member is removable, so the control exists exactly once.
    expect(html.match(/value="m-2"/g)).toHaveLength(1);
    expect(html).not.toContain('value="m-1"');
  });

  it('offers the manager role to an owner', () => {
    const html = render(team());
    expect(html).toContain('value="manager"');
  });

  it('does not offer a role a manager cannot hand out', () => {
    // A manager may hire a cook or a cashier. Only the owner may create another
    // manager, and the database refuses the rest -- so the option is not drawn.
    const html = render(team({ role: 'manager', isOwner: false }));
    expect(html).not.toContain('value="manager"');
    expect(html).toContain('value="kitchen"');
    expect(html).toContain('value="cashier"');
  });

  it('shows no destructive control at all to anybody but the owner', () => {
    const html = render(team({ role: 'manager', isOwner: false }));
    expect(html).not.toContain('Remove');
  });

  it('explains itself instead of drawing a dead form for a kitchen login', () => {
    const html = render(team({ role: 'kitchen', isOwner: false, canManage: false, members: [], invites: [] }));

    expect(html).toMatch(/Only the owner or a manager manages the team/i);
    expect(html).not.toContain('Create invitation link');
  });

  it('shows the new link once, with the code for reading aloud', () => {
    const html = render(team(), {
      code: 'K7QM3XPD9RTW2HNJ',
      role: 'kitchen',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    expect(html).toContain('https://autodine.test/join/K7QM-3XPD-9RTW-2HNJ');
    expect(html).toContain('K7QM-3XPD-9RTW-2HNJ');
    // And it is honest about not being able to show it again.
    expect(html).toMatch(/cannot show it again/i);
  });

  it('never draws a link when none was just minted', () => {
    const html = render(team());
    expect(html).not.toContain('/join/');
    expect(html).toContain('Create invitation link');
  });

  it('shows an open invitation with its remaining time and a way to cancel it', () => {
    const html = render(team());
    expect(html).toContain('Cancel link');
    expect(html).toContain('value="i-1"');
  });

  it('says a read failed instead of implying the team is empty', () => {
    const html = render(team({ members: [], invites: [], unavailable: 'The team list could not be read.' }));
    expect(html).toContain('The team list could not be read.');
  });
});
