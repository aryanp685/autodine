import { describe, expect, it } from 'vitest';
import { assetObjectPath, prepareAsset, ASSET_BUCKET_FOR } from './uploads';

function pngBytes(): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(80, 20);
  return bytes;
}

const pngFile = { size: 24, type: 'image/png', name: 'menu.png' };

describe('prepareAsset', () => {
  it('accepts a real PNG and measures it', () => {
    const result = prepareAsset(pngFile, pngBytes(), 'logo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.mime).toBe('image/png');
    expect(result.asset.width).toBe(100);
    expect(result.asset.height).toBe(80);
    expect(result.asset.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.asset.bucket).toBe('restaurant-assets');
    expect(result.asset.extension).toBe('png');
  });

  it('refuses bytes that do not match the claimed type', () => {
    const result = prepareAsset({ ...pngFile, type: 'image/jpeg' }, pngBytes(), 'logo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('do not match');
  });

  it('refuses HTML dressed as an image', () => {
    const html = Buffer.from('<html>hello</html>');
    const result = prepareAsset({ size: html.length, type: 'image/png', name: 'x.png' }, html, 'banner');
    expect(result.ok).toBe(false);
  });

  it('allows PDFs only as menu or reference material', () => {
    const pdf = Buffer.from('%PDF-1.4\n%stub');
    expect(prepareAsset({ size: pdf.length, type: 'application/pdf', name: 'm.pdf' }, pdf, 'menu-photo').ok).toBe(true);
    expect(prepareAsset({ size: pdf.length, type: 'application/pdf', name: 'm.pdf' }, pdf, 'reference').ok).toBe(true);
    const logo = prepareAsset({ size: pdf.length, type: 'application/pdf', name: 'm.pdf' }, pdf, 'logo');
    expect(logo.ok).toBe(false);
    if (!logo.ok) expect(logo.error).toContain('PDF');
  });

  it('enforces per-kind size ceilings and rejects empty files', () => {
    const big = Buffer.concat([pngBytes(), Buffer.alloc(3 * 1024 * 1024)]);
    const result = prepareAsset({ size: big.length, type: 'image/png', name: 'big.png' }, big, 'logo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('limit');
    expect(prepareAsset({ size: 0, type: 'image/png', name: '' }, Buffer.alloc(0), 'logo').ok).toBe(false);
  });

  it('keeps source material in the private bucket and guest assets public', () => {
    expect(ASSET_BUCKET_FOR.logo).toBe('restaurant-assets');
    expect(ASSET_BUCKET_FOR.banner).toBe('restaurant-assets');
    expect(ASSET_BUCKET_FOR.crop).toBe('restaurant-assets');
    expect(ASSET_BUCKET_FOR.reference).toBe('restaurant-brand-source');
    expect(ASSET_BUCKET_FOR['menu-photo']).toBe('restaurant-brand-source');
  });
});

describe('assetObjectPath', () => {
  it('is always under the tenant folder and never collides', () => {
    const a = assetObjectPath('11111111-2222-4333-8444-555555555555', 'logo', 'png');
    const b = assetObjectPath('11111111-2222-4333-8444-555555555555', 'logo', 'png');
    expect(a.startsWith('11111111-2222-4333-8444-555555555555/')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.endsWith('.png')).toBe(true);
    expect(a).toContain('logo-');
  });
});
