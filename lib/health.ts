/**
 * Is this deployment actually wired to a database, and which migrations are on
 * it?
 *
 * WHY THIS EXISTS
 *
 * Explicit local demo mode can render sample data, but production now fails
 * closed when public Supabase configuration is absent. This endpoint answers a
 * different question: whether a configured deployment has the expected schema
 * for the trial, plan entitlements, and restaurant UPI QR. The realistic
 * failure is a configured deployment with an unapplied migration, which can
 * otherwise look like a generic unavailable screen.
 *
 * This module answers the question in one request, in booleans. It is used by
 * GET /api/health, which is public on purpose -- it returns no rows, no ids,
 * no keys and no counts, only "this piece is there / is not there".
 *
 * WHAT IT MUST NEVER DO
 *
 * Return a key, a URL, an email, a restaurant name, an error message, or an
 * unvalidated error field straight from the database. Probe outcomes use a
 * fixed vocabulary; the optional diagnostic code is allowlisted to standard
 * SQLSTATE or PostgREST code formats and never includes a database message.
 *
 * Logic lives here rather than in the route so it can be tested without a
 * network, a database or an environment.
 */

export type Probe = 'applied' | 'missing' | 'unknown' | 'unreachable' | 'unauthorized';

export type Health = {
  /** Everything the app needs to run live is present. */
  configured: boolean;
  /** The server key is present, so writes that need it will work. */
  serverKey: boolean;
  /** The database answered a query at all. */
  reachable: boolean;
  /**
   * A validated PostgREST or SQLSTATE code from the first failed privileged
   * column probe; diagnostic only, not itself a credential verdict.
   */
  credentialProbe: string | null;
  /**
   * Did the database accept the credentials this deployment is holding?
   *
   * 'rejected' is the one answer that is nobody's guess: the key is wrong, the
   * key was rolled, or the project it belongs to is different. Every
   * privileged path -- payments, staff sign-in, the health probe itself -- is
   * dead, and without this word the endpoint reported `serverKey: true` while
   * all of them failed, which is the least useful thing a health check can say.
   */
  credentials: 'accepted' | 'rejected' | 'unknown';
  schema: {
    /** trial_started_at / plan columns + restaurant_can_write(). Migration 01100. */
    trialAndWriteGate: Probe;
    /** plan_features() / restaurant_access(). Migration 01200. */
    planEntitlements: Probe;
    /** restaurants.upi_id. Migration 01300. */
    restaurantUpi: Probe;
  };
  trialDays: number;
};

/** The minimum of a Supabase client this module needs, so a test can fake it. */
export type ProbeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (n: number) => PromiseLike<{ error: { message: string; code?: string } | null }>;
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data?: unknown; error: { message: string; code?: string } | null }>;
};

/**
 * A missing function or column, as PostgREST reports it.
 *
 * PGRST202 is the current code ("Could not find the function ... in the schema
 * cache"); 42703 is Postgres for an unknown column. The message match is the
 * fallback, because a project on an older PostgREST returns a plain 404 with no
 * code at all.
 */
/**
 * Is this the database saying "I do not know that key"?
 *
 * A rolled or mistyped secret key comes back as 401 with PGRST301 (or a plain
 * "Invalid API key"). It is not a missing migration and it is not a database
 * outage, and treating it as either sends somebody to re-run a migration or to
 * restart a project that is running perfectly well.
 */
function isUnauthorized(error: { message: string; code?: string }): boolean {
  if (error.code === 'PGRST301' || error.code === '401' || error.code === 'PGRST302') return true;
  return /invalid api key|invalid jwt|jwt expired|unauthorized|no api key/i.test(error.message);
}

function isMissing(error: { message: string; code?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42703' || error.code === 'PGRST204') return true;
  return /could not find the function|column .* does not exist|schema cache/i.test(error.message);
}

/**
 * Keep the public diagnostic to standard error identifiers only. PostgreSQL
 * SQLSTATE values are five uppercase alphanumerics; PostgREST uses PGRST plus
 * three digits. Do not expose arbitrary client error codes or messages.
 */
function safeProbeCode(code: string | undefined): string | null {
  if (!code) return null;
  return /^[A-Z0-9]{5}$/.test(code) || /^PGRST\d{3}$/.test(code) ? code : null;
}

/**
 * Does this column exist?
 *
 * `limit(0)` costs one round trip and returns no rows: the column is named in
 * the select list, so PostgREST either resolves it or refuses. No row of a real
 * restaurant is read, which matters because this runs unauthenticated.
 */
async function columnExists(
  client: ProbeClient,
  table: string,
  column: string,
  note?: (code: string | undefined) => void
): Promise<Probe> {
  try {
    const { error } = await client.from(table).select(column).limit(0);
    if (!error) return 'applied';
    note?.(error.code);
    if (isUnauthorized(error)) return 'unauthorized';
    return isMissing(error) ? 'missing' : 'unknown';
  } catch {
    return 'unreachable';
  }
}

/** Does this RPC exist and answer? */
async function functionExists(
  client: ProbeClient,
  fn: string,
  args: Record<string, unknown>
): Promise<Probe> {
  try {
    const { error } = await client.rpc(fn, args);
    if (!error) return 'applied';
    if (isUnauthorized(error)) return 'unauthorized';
    return isMissing(error) ? 'missing' : 'unknown';
  } catch {
    return 'unreachable';
  }
}

/**
 * Run every probe.
 *
 * `primary` is the client to read columns with (the admin client when a server
 * key exists, the browser-safe client otherwise). `publicClient` is only used
 * for plan_features(), which anon is explicitly granted.
 */
export async function probeHealth(input: {
  configured: boolean;
  serverKey: boolean;
  trialDays: number;
  primary: ProbeClient | null;
  publicClient: ProbeClient | null;
}): Promise<Health> {
  const empty: Health = {
    configured: input.configured,
    serverKey: input.serverKey,
    reachable: false,
    credentialProbe: null,
    credentials: 'unknown',
    schema: {
      trialAndWriteGate: 'unknown',
      planEntitlements: 'unknown',
      restaurantUpi: 'unknown',
    },
    trialDays: input.trialDays,
  };

  if (!input.configured || !input.primary) return empty;

  let credentialProbe: string | null = null;
  const note = (code: string | undefined) => {
    if (!credentialProbe) credentialProbe = safeProbeCode(code);
  };

  const [trialColumn, planColumn, upiColumn, planFeatures] = await Promise.all([
    columnExists(input.primary, 'restaurants', 'trial_started_at', note),
    columnExists(input.primary, 'restaurants', 'plan', note),
    columnExists(input.primary, 'restaurants', 'upi_id', note),
    input.publicClient
      ? functionExists(input.publicClient, 'plan_features', { p_plan: 'starter' })
      : input.primary
        ? functionExists(input.primary, 'plan_features', { p_plan: 'starter' })
        : Promise.resolve('unknown' as Probe),
  ]);

  // One migration is reported as one answer: a half-applied file is not a state
  // this product has, and "column yes, function no" would be a sentence nobody
  // can act on.
  const trialAndWriteGate: Probe =
    trialColumn === 'applied' && planColumn === 'applied'
      ? 'applied'
      : trialColumn === 'unauthorized' || planColumn === 'unauthorized'
        ? 'unauthorized'
        : trialColumn === 'unreachable' || planColumn === 'unreachable'
          ? 'unreachable'
          : trialColumn === 'missing' || planColumn === 'missing'
            ? 'missing'
            : 'unknown';

  const probes = [trialColumn, planColumn, upiColumn, planFeatures];
  const credentials: Health['credentials'] = probes.includes('unauthorized')
    ? 'rejected'
    : !input.serverKey
      ? 'unknown'
      : trialColumn === 'applied' && planColumn === 'applied' && upiColumn === 'applied'
        ? 'accepted'
        : 'unknown';

  return {
    ...empty,
    reachable: trialColumn !== 'unreachable' && trialColumn !== 'unauthorized',
    credentialProbe,
    credentials,
    schema: {
      trialAndWriteGate,
      planEntitlements: planFeatures,
      restaurantUpi: upiColumn,
    },
  };
}
