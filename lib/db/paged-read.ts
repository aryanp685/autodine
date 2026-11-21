/** PostgREST applies max_rows even when the caller omits limit(). Financial
 * and kitchen reads must page explicitly rather than silently losing rows. */
type QueryError = { message: string; code?: string; details?: string; hint?: string };
export async function readAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError | null }>, pageSize = 500) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('Invalid page size');
  const data: T[] = [];
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const result = await page(offset, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    data.push(...rows);
    if (rows.length < pageSize) return { data, error: null };
  }
  throw new Error('This view exceeds its safe read size. Narrow the reporting period or contact support.');
}

/** Avoid oversized PostgREST .in() URLs and still read every dish/payment. */
export async function readRowsForIds<K, T>(ids: K[], page: (ids: K[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError | null }>) {
  const data: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const result = await readAllRows((from, to) => page(batch, from, to));
    if (result.error) return { data: null, error: result.error };
    data.push(...result.data!);
  }
  return { data, error: null };
}
