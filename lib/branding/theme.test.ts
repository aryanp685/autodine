import { describe, expect, it } from 'vitest';
import {
  labelOn,
  mix,
  parseHex,
  parseTheme,
  shade,
  softWash,
  themeAccentOverrides,
  themeContrastWarnings,
  themeFontLimitation,
  themeStyle,
} from './theme';
import { contrast } from './palette';

const VALID = {
  colors: { primary: '#7a1f2b', secondary: '#d9a441', background: '#faf3e6', surface: '#ffffff' },
  typography: { character: 'serif', exactFont: 'Didot' },
  layout: {
    header: 'banner-overlay',
    card: { radius: 'soft', border: 'hairline', elevation: 'flat' },
    spacing: 'airy',
    motifs: ['rule-double', 'bogus-motif'],
  },
};

describe('parseHex', () => {
  it('accepts exactly #rrggbb and normalises case', () => {
    expect(parseHex('#7A1F2B')).toBe('#7a1f2b');
    expect(parseHex(' #123abc ')).toBe('#123abc');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('#12345678')).toBeNull();
    expect(parseHex('rgb(1,2,3)')).toBeNull();
    expect(parseHex(42)).toBeNull();
    expect(parseHex('javascript:alert(1)')).toBeNull();
  });
});

describe('parseTheme', () => {
  it('parses a valid theme and drops unknown motif keys', () => {
    const theme = parseTheme(VALID);
    expect(theme).not.toBeNull();
    expect(theme!.colors.primary).toBe('#7a1f2b');
    expect(theme!.layout.motifs).toEqual(['rule-double']);
    expect(theme!.typography.character).toBe('serif');
  });

  it('refuses a theme without a usable primary colour', () => {
    expect(parseTheme({ colors: { primary: 'red' } })).toBeNull();
    expect(parseTheme({ colors: {} })).toBeNull();
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme('{"colors":{}}')).toBeNull();
  });

  it('falls back to safe defaults for missing style fields', () => {
    const theme = parseTheme({ colors: { primary: '#112233' } });
    expect(theme!.typography.character).toBe('sans');
    expect(theme!.layout.header).toBe('plain');
    expect(theme!.layout.card).toEqual({ radius: 'soft', border: 'hairline', elevation: 'flat' });
  });

  it('maps unknown enum values to defaults instead of passing them through', () => {
    const theme = parseTheme({
      colors: { primary: '#112233' },
      typography: { character: 'Comic Sans MS, script-tag', exactFont: '<script>x</script>' },
      layout: { header: 'javascript:alert(1)', motifs: ['none', 'corner-ornament'] },
    });
    expect(theme!.typography.character).toBe('sans');
    // The exact font name is data, capped, never markup of consequence.
    expect(theme!.typography.exactFont).toBe('<script>x</script>'.slice(0, 60));
    expect(theme!.layout.header).toBe('plain');
    expect(theme!.layout.motifs).toEqual(['corner-ornament']);
  });
});

describe('contrast contract', () => {
  it('labelOn picks a label that passes AA on the fill', () => {
    const dark = labelOn('#7a1f2b');
    const light = labelOn('#f4d977');
    expect(contrast(dark, '#7a1f2b')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light, '#f4d977')).toBeGreaterThanOrEqual(4.5);
  });

  it('themeContrastWarnings names fills that cannot carry readable text', () => {
    const muddy = parseTheme({ colors: { primary: '#8a7a66' } })!;
    const warnings = themeContrastWarnings(muddy);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('#8a7a66');
  });

  it('a well-chosen theme produces no warnings', () => {
    const good = parseTheme(VALID)!;
    expect(themeContrastWarnings(good)).toEqual([]);
  });
});

describe('css mapping', () => {
  it('emits custom properties only — never raw style text', () => {
    const style = themeStyle(parseTheme(VALID)!);
    for (const key of Object.keys(style)) {
      expect(key.startsWith('--')).toBe(true);
    }
    expect(style['--brand-primary']).toBe('#7a1f2b');
    expect(style['--brand-font']).toContain('Georgia');
    expect(style['--brand-radius']).toBe('10px');
  });

  it('themeAccentOverrides re-colours the existing guest properties', () => {
    const overrides = themeAccentOverrides(parseTheme(VALID)!);
    expect(overrides['--p-accent']).toBe('#7a1f2b');
    expect(overrides['--p-accent-soft']).toMatch(/^#[0-9a-f]{6}$/);
    // The wash keeps the accent visible but never as a full-strength field.
    expect(overrides['--p-accent-wash']).toMatch(/^rgba\(/);
  });

  it('colour maths is deterministic and clamped', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(softWash('#7a1f2b')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('font limitation note', () => {
  it('says plainly when the printed font is not a supported one', () => {
    const theme = parseTheme(VALID)!;
    const note = themeFontLimitation(theme);
    expect(note).toContain('Didot');
    expect(note).toContain('Elegant serif');
  });

  it('stays silent when no exact font was claimed', () => {
    const theme = parseTheme({ colors: { primary: '#112233' } })!;
    expect(themeFontLimitation(theme)).toBeNull();
  });
});
