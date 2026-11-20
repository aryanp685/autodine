/** Synthetic principals for tests only. A valid checksum is not a registration. */
export function syntheticGstin(prefix: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (prefix.length !== 14 || [...prefix].some((c) => !chars.includes(c))) throw new Error('Need a 14-character GSTIN prefix');
  const sum = [...prefix].reduce((total, c, i) => {
    const digit = chars.indexOf(c) * (i % 2 === 0 ? 1 : 2);
    return total + Math.floor(digit / 36) + digit % 36;
  }, 0);
  return prefix + chars[(36 - sum % 36) % 36];
}

export const SYNTHETIC_BUYER = syntheticGstin('29ZZZZZ0000Z1Z');

export const SYNTHETIC_FSSAI = '01234567890123';
export const SYNTHETIC_SERVICE_SAC = '996331';
