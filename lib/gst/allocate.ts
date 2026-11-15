/**
 * Largest-remainder allocation of an integer paise amount across weighted
 * buckets. Deterministic: identical inputs always produce identical outputs,
 * the parts always sum exactly to the total, and ties on the fractional part
 * are broken by bucket order (earlier line wins).
 *
 * Fallback: when every weight is zero (e.g. a fully complimentary document —
 * not possible through the GST issue path, but not impossible in principle),
 * the amount is spread across buckets equally, remainder to the first lines.
 *
 * This exists so the e-Invoice payload can decompose the immutable
 * document-level GST snapshot over its lines without ever inventing a paisa:
 * the line values are *allocated* from the snapshot, largest remainder wins.
 */
export function allocateIntegerPaise(weights: readonly number[], totalPaise: number): number[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError(`allocateIntegerPaise: total must be a non-negative safe integer, got ${totalPaise}`);
  }
  const count = weights.length;
  if (count === 0) return totalPaise === 0 ? [] : (() => { throw new RangeError('allocateIntegerPaise: no buckets for a non-zero total'); })();

  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let effective = safe;
  let weightSum = effective.reduce((acc, w) => acc + w, 0);
  if (weightSum === 0) {
    effective = new Array<number>(count).fill(1);
    weightSum = count;
  }

  const exact = effective.map((w) => (w * totalPaise) / weightSum);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = totalPaise - floors.reduce((acc, value) => acc + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}
