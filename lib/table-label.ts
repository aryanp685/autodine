/** Pick the first free conventional table label: T1, T2, ... */
export function nextTableLabel(existing: string[]): string {
  const used = new Set(existing);

  // With N existing labels, one of T1 through T(N+1) must be free. This
  // avoids a ceiling-based timestamp fallback that was unstable and could
  // create labels staff could not predict once a restaurant passed 999 tables.
  for (let index = 1; index <= existing.length + 1; index += 1) {
    const candidate = `T${index}`;
    if (!used.has(candidate)) return candidate;
  }

  // The pigeonhole bound above makes this unreachable for an ordinary array.
  throw new Error('Could not allocate a table label.');
}
