import { describe, expect, it } from 'vitest';

import { nextTableLabel } from './table-label';

describe('nextTableLabel', () => {
  it('chooses the first unused label and fills gaps before appending', () => {
    expect(nextTableLabel([])).toBe('T1');
    expect(nextTableLabel(['T1', 'T3'])).toBe('T2');
    expect(nextTableLabel(['T1', 'T2'])).toBe('T3');
  });

  it('continues with a stable numeric label beyond 999 tables', () => {
    const existing = Array.from({ length: 999 }, (_, index) => `T${index + 1}`);
    expect(nextTableLabel(existing)).toBe('T1000');
  });

  it('never collides even when existing labels are non-sequential', () => {
    const existing = ['T1', 'T2', 'T3', 'T1000', 'Patio'];
    expect(existing).not.toContain(nextTableLabel(existing));
  });
});
