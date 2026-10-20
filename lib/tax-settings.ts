/** Tax settings are stored as integer basis points: 500 = 5.00%. */
export const MAX_TAX_RATE_BPS = 3000;

/** Parse a plain percentage input without accepting exponent/float ambiguity. */
export function parseTaxRatePercent(value: FormDataEntryValue | string | null): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const bps = whole * 100 + fraction;
  return bps <= MAX_TAX_RATE_BPS ? bps : null;
}

export function formatTaxRatePercent(taxRateBps: number): string {
  return (taxRateBps / 100).toFixed(2).replace(/\.?0+$/, '');
}
