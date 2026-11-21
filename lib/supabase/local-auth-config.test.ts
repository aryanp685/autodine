import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const emailSection = config.split(/^\[auth\.email\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';

describe('local Supabase Auth configuration', () => {
  it('keeps signup email confirmation enabled rather than auto-confirming local accounts', () => {
    expect(emailSection).toMatch(/^\s*enable_confirmations\s*=\s*true\s*$/m);
    expect(emailSection).not.toMatch(/^\s*enable_confirmations\s*=\s*false\s*$/m);
  });
});
