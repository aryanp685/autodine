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

  const safe = weights.map((w) => Number.isSafeInteger(w) && w > 0 ? BigInt(w) : 0n);
  let effective = safe;
  let weightSum = effective.reduce((acc, w) => acc + w, 0n);
  if (weightSum === 0n) {
    effective = new Array<bigint>(count).fill(1n);
    weightSum = BigInt(count);
  }

  const scaled = effective.map((w) => w * BigInt(totalPaise));
  const floors = scaled.map((value) => Number(value / weightSum));
  let remainder = totalPaise - floors.reduce((acc, value) => acc + value, 0);
  const order = scaled.map((value, index) => ({ index, remainder: value % weightSum }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const { index } of order) {
    if (remainder === 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}
