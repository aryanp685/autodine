import { describe, expect, it } from 'vitest';
import { getSingleSearchParam } from './query-params';

describe('query parameter normalization', () => {
  it('accepts one value or a missing optional value', () => {
    expect(getSingleSearchParam('venue-one')).toEqual({ valid: true, value: 'venue-one' });
    expect(getSingleSearchParam(undefined)).toEqual({ valid: true, value: undefined });
  });

  it('rejects repeated values rather than choosing one silently', () => {
    expect(getSingleSearchParam(['venue-one', 'venue-two'])).toEqual({ valid: false, value: undefined });
  });
});
