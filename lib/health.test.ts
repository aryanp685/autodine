/**
 * The health probe, without a database.
 *
 * What is worth testing here is not that a query works -- that is the
 * database's job. It is the MAPPING: a missing function must read as "missing",
 * a permission problem must NOT read as "missing" (they need different fixes),
 * and nothing from the database may be echoed back to the caller.
 */
import { describe, expect, it } from 'vitest';
import { probeHealth, type ProbeClient } from './health';

type Failure = { message: string; code?: string } | null;

/** A client that answers every probe with the same result. */
function client(result: Failure): ProbeClient {
  return {
    from: () => ({
      select: () => ({ limit: () => Promise.resolve({ error: result }) }),
    }),
    rpc: () => Promise.resolve({ data: [], error: result }),
  };
}

/** A client with per-column and per-function answers. */
function picky(answers: { columns?: Record<string, Failure>; functions?: Record<string, Failure> }): ProbeClient {
  return {
    from: () => {
      // The column name is passed through select(), so the fake has to read it.
      const chain = {
        select: (column: string) => ({
          limit: () => Promise.resolve({ error: answers.columns?.[column] ?? null }),
        }),
      };
      return chain as unknown as ReturnType<ProbeClient['from']>;
    },
    rpc: (fn: string) => Promise.resolve({ data: [], error: answers.functions?.[fn] ?? null }),
  };
}

const base = {
  configured: true,
  serverKey: true,
  gatewayKeys: false,
  trialDays: 7,
};

describe('probeHealth', () => {
  it('reports everything applied on a fully migrated database', async () => {
    const health = await probeHealth({
      ...base,
      primary: picky({}),
      publicClient: picky({}),
    });

    expect(health.reachable).toBe(true);
    expect(health.schema).toEqual({
      trialAndWriteGate: 'applied',
      planEntitlements: 'applied',
      restaurantUpi: 'applied',
    });
    expect(health.trialDays).toBe(7);
  });

  it('reports a missing column as missing, not as an error', async () => {
    const health = await probeHealth({
      ...base,
      primary: picky({
        columns: { trial_started_at: { message: 'column restaurants.trial_started_at does not exist', code: '42703' } },
      }),
      publicClient: picky({}),
    });

    expect(health.schema.trialAndWriteGate).toBe('missing');
  });

  it('reports a missing function as missing', async () => {
    const health = await probeHealth({
      ...base,
      primary: picky({}),
      publicClient: picky({
        functions: {
          plan_features: {
            message: "Could not find the function public.plan_features(p_plan) in the schema cache",
            code: 'PGRST202',
          },
        },
      }),
    });

    expect(health.schema.planEntitlements).toBe('missing');
  });

  it('does not call a permission error a missing migration', async () => {
    // 42501 is PostgreSQL "insufficient privilege": the migration WAS applied,
    // the caller just cannot see it. Calling that "missing" would send somebody
    // to re-run a migration that is already there.
    const health = await probeHealth({
      ...base,
      primary: picky({ columns: { upi_id: { message: 'permission denied for table restaurants', code: '42501' } } }),
      publicClient: picky({}),
    });

    expect(health.schema.restaurantUpi).toBe('unknown');
  });

  it('says nothing when Supabase is not configured at all', async () => {
    const health = await probeHealth({
      configured: false,
      serverKey: false,
      gatewayKeys: false,
      trialDays: 7,
      primary: null,
      publicClient: null,
    });

    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.schema.trialAndWriteGate).toBe('unknown');
  });

  it('treats an unreachable database as unreachable, not as missing tables', async () => {
    const throwing: ProbeClient = {
      from: () => {
        throw new Error('fetch failed');
      },
      rpc: () => {
        throw new Error('fetch failed');
      },
    };

    const health = await probeHealth({ ...base, primary: throwing, publicClient: throwing });

    expect(health.reachable).toBe(false);
    expect(health.schema.trialAndWriteGate).toBe('unreachable');
    expect(health.schema.restaurantUpi).toBe('unreachable');
  });

  it('never carries a key or an error message in the response', async () => {
    const health = await probeHealth({
      ...base,
      primary: client({ message: 'password authentication failed for user "postgres"' }),
      publicClient: client({ message: 'password authentication failed' }),
    });

    const serialised = JSON.stringify(health);
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('postgres');
    expect(serialised).not.toContain('sb_secret');
  });
});

describe('health reports a rejected credential', () => {
  it('names a rolled secret key as unauthorized, not as a missing migration', async () => {
    // A revoked key answers 401. Saying "missing" sends somebody to re-run a
    // migration that is already applied; saying "unknown" is what the endpoint
    // said while every privileged path on the deployment was dead.
    const health = await probeHealth({
      ...base,
      primary: picky({
        columns: {
          trial_started_at: { message: 'Invalid API key', code: 'PGRST301' },
          plan: { message: 'Invalid API key', code: 'PGRST301' },
          upi_id: { message: 'Invalid API key', code: 'PGRST301' },
        },
      }),
      publicClient: picky({}),
    });

    expect(health.credentials).toBe('rejected');
    expect(health.schema.trialAndWriteGate).toBe('unauthorized');
    // The database is up; it is the credential that is wrong.
    expect(health.reachable).toBe(false);
  });

  it('says the credential was accepted when the probes can read', async () => {
    const health = await probeHealth({ ...base, primary: picky({}), publicClient: picky({}) });
    expect(health.credentials).toBe('accepted');
  });
});
