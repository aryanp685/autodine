import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { Field, inputClass } from '@/components/owner/chrome';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { roleLabel } from '@/lib/db/team';
import {
  formatInviteCode,
  inviteStatusCopy,
  isWellFormedInviteCode,
  normaliseInviteCode,
  type InviteStatus,
} from '@/lib/team-invite';
import { acceptInviteAction, joinSignUpAction } from '@/app/join/actions';

export const metadata: Metadata = {
  title: 'Join your team · AutoDine',
  // A link to a restaurant's staff area must never be indexed.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const NOTE_STYLE =
  'mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-gink-64';
const ERROR_STYLE =
  'mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]';

function Shell({
  title,
  lede,
  children,
  action,
}: {
  title: string;
  lede: React.ReactNode;
  children: React.ReactNode;
  action?: { prompt: string; label: string; href: string };
}) {
  return (
    <AuthShell
      eyebrow="Team invitation"
      title={title}
      lede={lede}
      action={action}
      notes={[
        <>
          <strong>One link, one person.</strong> It stops working after it is used, or when it expires.
        </>,
        <>
          <strong>Your own login.</strong> The kitchen, the counter and the office do not share a
          password: each person signs in with their own.
        </>,
      ]}
      notesTitle="How this works"
    >
      {children}
    </AuthShell>
  );
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { code: rawCode } = await params;
  const { error, status } = await searchParams;

  const code = normaliseInviteCode(rawCode);
  const next = `/join/${encodeURIComponent(formatInviteCode(code))}`;

  if (!isWellFormedInviteCode(code)) {
    return (
      <Shell title="That link is incomplete" lede="An invitation link has a code in it. This one does not look like one.">
        <p className="text-[13px] leading-[1.55] text-gink-64">
          Copy the whole link the owner sent you — it ends in four groups of four characters, like{' '}
          <span className="font-medium text-gink">K7QM-3XPD-9RTW-2HNJ</span>.
        </p>
        <p className="mt-3 text-[13px] leading-[1.55] text-gink-64">
          You can also{' '}
          <Link href="/join" className="font-medium text-gink underline decoration-hair-strong underline-offset-2">
            paste the code
          </Link>{' '}
          instead.
        </p>
      </Shell>
    );
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <Shell
        title="Invitations are not available here"
        lede="This deployment has no database connected, so there is no team to join."
      >
        <p className="text-[13px] leading-[1.55] text-gink-64">
          Nothing was created and nothing was changed. Ask the owner to send the link again once the
          restaurant is connected.
        </p>
      </Shell>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out: do not reveal anything about the link. The preview function
  // refuses without a session, which is the point -- a guessed code learns
  // only that the page exists.
  if (!user) {
    return (
      <Shell
        title="You have been invited"
        lede="This link adds you to a restaurant's team on AutoDine. Sign in, or create an account in a few seconds, and the invitation is applied."
        action={{ prompt: 'Already work here?', label: 'Sign in', href: `/login?next=${encodeURIComponent(next)}` }}
      >
        {error ? <div className={ERROR_STYLE} role="alert">{error}</div> : null}

        <p className="text-[13px] leading-[1.55] text-gink-64">
          Already have an AutoDine account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
          >
            Sign in to accept
          </Link>
          .
        </p>

        <form action={joinSignUpAction} className="mt-5 flex flex-col gap-3.5">
          <input type="hidden" name="code" value={code} />
          <p className="text-[11.5px] font-semibold tracking-[0.09em] text-gink-46 uppercase">
            New here
          </p>
          <Field label="Your name" htmlFor="join-name">
            <input id="join-name" className={inputClass} name="fullName" autoComplete="name" required maxLength={80} />
          </Field>
          <Field label="Email" htmlFor="join-email">
            <input
              id="join-email"
              className={inputClass}
              name="email"
              type="email"
              autoComplete="email"
              required
              inputMode="email"
            />
          </Field>
          <Field label="Password" htmlFor="join-password" hint="At least 8 characters.">
            <input
              id="join-password"
              className={inputClass}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>
          <button
            type="submit"
            className="mt-1 inline-flex h-11 items-center justify-center rounded-full bg-[var(--p-accent)] px-5 text-[13px] font-semibold text-[var(--p-on-accent)] transition-colors hover:bg-[var(--p-accent-strong)]"
          >
            Create account and join
          </button>
          <p className="text-[11.5px] leading-[1.5] text-gink-46">
            This creates a staff account only — it does not create a restaurant of your own.
          </p>
        </form>
      </Shell>
    );
  }

  // Signed in: ask the database what this link is. The function consumes
  // nothing, so a preview followed by Accept is one use, not two.
  const { data, error: previewError } = await supabase.rpc('preview_staff_invite', { p_code: code });
  const preview = data?.[0];

  if (previewError) {
    return (
      <Shell
        title="This invitation cannot be read"
        lede="The link is well formed, but the team system did not answer."
      >
        <div className={ERROR_STYLE} role="alert">
          {previewError.message}
        </div>
        <p className="text-[13px] leading-[1.55] text-gink-64">
          If this deployment was just updated, the team migration may not have been applied yet. Ask
          the owner to check, then open the link again.
        </p>
      </Shell>
    );
  }

  const inviteStatus = (preview?.status ?? 'not_found') as InviteStatus;
  const copy = inviteStatusCopy(inviteStatus);
  const restaurantName = preview?.restaurant_name ?? null;
  const role = preview?.role ?? null;

  // Every non-actionable state gets the same treatment: the sentence the
  // person needs, and what to do about it. No buttons that would fail.
  if (inviteStatus !== 'ok') {
    return (
      <Shell
        title={copy.title}
        lede={
          restaurantName
            ? `This invitation is for ${restaurantName}.`
            : 'Nothing was changed, and no access was granted.'
        }
      >
        <div className={status || error ? (error ? ERROR_STYLE : NOTE_STYLE) : NOTE_STYLE} role={error ? 'alert' : 'status'}>
          {error ?? copy.body}
        </div>
        {inviteStatus === 'already_member' ? (
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-full bg-[var(--p-accent)] px-5 text-[13px] font-semibold text-[var(--p-on-accent)]"
          >
            Open your dashboard
          </Link>
        ) : null}
        {copy.askForNewLink ? (
          <p className="text-[13px] leading-[1.55] text-gink-64">
            Nothing here needs a password. The owner can create a new link from{' '}
            <span className="font-medium text-gink">Settings → People</span> in a few seconds.
          </p>
        ) : null}
        <p className="mt-3 text-[12.5px] leading-[1.5] text-gink-46">
          Signed in as <span className="font-medium text-gink">{user.email}</span>.
        </p>
      </Shell>
    );
  }

  const expires = preview?.expires_at
    ? new Date(preview.expires_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <Shell
      title={`Join ${restaurantName ?? 'this restaurant'}`}
      lede={
        role ? (
          <>
            You have been invited as a <strong className="font-semibold text-gink">{roleLabel(role)}</strong>.
            Accepting adds this restaurant to your account — it does not change any other restaurant you
            work in.
          </>
        ) : (
          'Accepting adds this restaurant to your account.'
        )
      }
    >
      {error ? <div className={ERROR_STYLE} role="alert">{error}</div> : null}

      <dl className="mb-5 flex flex-col gap-2 text-[13px]">
        <div className="flex items-baseline justify-between border-b border-[var(--p-line-soft)] pb-2">
          <dt className="text-gink-46">Role</dt>
          <dd className="font-medium text-gink">{role ? roleLabel(role) : '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-gink-46">Link works until</dt>
          <dd className="font-medium text-gink">{expires ?? '—'}</dd>
        </div>
      </dl>

      <form action={acceptInviteAction}>
        <input type="hidden" name="code" value={code} />
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--p-accent)] px-5 text-[13px] font-semibold text-[var(--p-on-accent)] transition-colors hover:bg-[var(--p-accent-strong)]"
        >
          Accept invitation
        </button>
      </form>

      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
        Signed in as <span className="font-medium text-gink">{user.email}</span>. The wrong person?{' '}
        <Link href="/login" className="underline decoration-hair-strong underline-offset-2">
          Sign in as somebody else
        </Link>
        .
      </p>
    </Shell>
  );
}
