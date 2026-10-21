import { describe, expect, it } from 'vitest';
import { formatTaxRatePercent, MAX_TAX_RATE_BPS, parseTaxRatePercent } from './tax-settings';

describe('tax settings percentage conversion', () => {
  it.each([
    ['0', 0],
    ['5', 500],
    ['5.5', 550],
    ['5.25', 525],
    ['30.00', MAX_TAX_RATE_BPS],
  ])('parses %s percent into basis points', (value, expected) => {
    expect(parseTaxRatePercent(value)).toBe(expected);
  });

  it.each(['', '-1', '30.01', '100', '1.234', '1e2', 'NaN'])('rejects invalid rate %s', (value) => {
    expect(parseTaxRatePercent(value)).toBeNull();
  });

  it.each([[0, '0'], [500, '5'], [550, '5.5'], [525, '5.25']])(
    'formats %i basis points as %s percent',
    (bps, expected) => {
      expect(formatTaxRatePercent(bps)).toBe(expected);
    },
  );
});
