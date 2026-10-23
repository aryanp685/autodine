/**
 * Is this deployment actually wired to a database, and which migrations are on
 * it?
 *
 * WHY THIS EXISTS
 *
 * Every owner and guest screen degrades quietly when Supabase is not
 * configured: it renders sample data instead. That is right for a preview and
 * terrible for a demo, because "configured but half-migrated" looks identical
 * to "not configured" from the outside. The three migrations that make the
 * trial real, add plan entitlements and add the restaurant's UPI QR were
 * written after the deployment's database was built, so the realistic failure
 * on demo day is: keys present, columns missing, and a screen that says
 * "Payment is not available right now" with no explanation.
 *
 * This module answers the question in one request, in booleans. It is used by
 * GET /api/health, which is public on purpose -- it returns no rows, no ids,
 * no keys and no counts, only "this piece is there / is not there".
 *
 * WHAT IT MUST NEVER DO
 *
 * Return a key, a URL, an email, a restaurant name or an error message straight
 * from the database. A health endpoint that echoes a Postgres error is a small
 * schema oracle. Everything here is mapped to a fixed vocabulary before it
 * leaves: 'applied' | 'missing' | 'unknown' | 'unreachable'.
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
   * The five-character class of the first failure on a privileged read, or
   * null when there was none.
   *
   * `/api/health` could say "unknown" for a year without anybody learning why:
   * a 401, a permission denial, a timeout and a connection reset all collapsed
   * into one word. This is the same class the guest's order screen prints, so a
   * deployment that cannot read its own data can finally say which kind of
   * refusal it is. It is a SQLSTATE or a PostgREST code -- five characters, no
   * schema, no message, no rows.
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
  payments: {
    /** A gateway key pair exists on this deployment. */
    gatewayKeys: boolean;
    /**
     * Can a guest ever see a pay-online button? Both the deployment key and the
     * restaurant's own switch are required; this is the deployment half.
     */
    onlinePossible: boolean;
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
  note?: (code: string) => void
): Promise<Probe> {
  try {
    const { error } = await client.from(table).select(column).limit(0);
    if (!error) return 'applied';
    note?.(error.code || 'none');
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
  args: Record<string, unknown>,
  note?: (code: string) => void
): Promise<Probe> {
  try {
    const { error } = await client.rpc(fn, args);
    if (!error) return 'applied';
    note?.(error.code || 'none');
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
  gatewayKeys: boolean;
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
    payments: {
      gatewayKeys: input.gatewayKeys,
      onlinePossible: input.gatewayKeys,
    },
    trialDays: input.trialDays,
  };

  if (!input.configured || !input.primary) return empty;

  let credentialProbe: string | null = null;
  const note = (code: string) => {
    if (!credentialProbe) credentialProbe = code;
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
