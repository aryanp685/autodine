import { Client } from 'pg';

function disposableDbUrl(): string {
  const value = process.env.DB_URL;
  if (!value) throw new Error('DB_URL is required for disposable database assertions.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.port !== '54322') {
    throw new Error('Refusing database assertions outside the disposable local Supabase stack.');
  }
  return value;
}

export async function queryDisposable<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: disposableDbUrl(), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const result = await client.query<T>(sql, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function orderSessionForGuestToken(token: string): Promise<{
  id: string;
  order_session_id: string;
  session_status: 'open' | 'closed';
} | null> {
  const rows = await queryDisposable<{
    id: string;
    order_session_id: string | null;
    session_status: 'open' | 'closed';
  }>(
    `select o.id, o.order_session_id, s.status as session_status
       from public.orders o
       join public.order_sessions s on s.id = o.order_session_id
      where o.guest_token = $1::uuid`,
    [token],
  );
  const row = rows[0];
  return row?.order_session_id
    ? { id: row.id, order_session_id: row.order_session_id, session_status: row.session_status }
    : null;
}

export async function orderCountForGuestToken(token: string): Promise<number> {
  const rows = await queryDisposable<{ count: string }>(
    'select count(*)::text as count from public.orders where guest_token = $1::uuid',
    [token],
  );
  return Number(rows[0]?.count ?? 0);
}
