import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/env',()=>({SUPABASE_URL:'https://project.supabase.co'}));
import { bucketPathFromUrl, contentMatchesImageType } from './assets';
describe('storage object URL handling', () => {
  const root='https://project.supabase.co/storage/v1/object/public/restaurant-assets/';
  it('rejects malformed encoding instead of crashing a removal action',()=>{
    expect(bucketPathFromUrl(root+'tenant/%broken')).toBeNull();
  });
  it('rejects encoded parent traversal',()=>{
    expect(bucketPathFromUrl(root+'tenant/%2E%2E/secret')).toBeNull();
  });
  it('keeps valid tenant object paths',()=>{
    expect(bucketPathFromUrl(root+'tenant/item.jpg')).toBe('tenant/item.jpg');
  });
});

describe('uploaded bytes against the claimed type', () => {
  // A real 1x1 PNG header: signature, IHDR, width 1, height 1.
  const png = new Uint8Array([
    0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
    0,0,0,13, 0x49,0x48,0x44,0x52,
    0,0,0,1, 0,0,0,1,
  ]);
  const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46]);
  const webp = new Uint8Array([0x52,0x49,0x46,0x46,0x24,0,0,0,0x57,0x45,0x42,0x50]);
  const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

  it('accepts each real image header',()=>{
    expect(contentMatchesImageType(png,'image/png')).toBe(true);
    expect(contentMatchesImageType(jpeg,'image/jpeg')).toBe(true);
    expect(contentMatchesImageType(webp,'image/webp')).toBe(true);
  });

  it('refuses an HTML page renamed as a PNG',()=>{
    expect(contentMatchesImageType(html,'image/png')).toBe(false);
  });

  it('refuses a real image whose type contradicts its name',()=>{
    expect(contentMatchesImageType(png,'image/jpeg')).toBe(false);
  });

  it('refuses an empty or truncated file',()=>{
    expect(contentMatchesImageType(new Uint8Array(),'image/png')).toBe(false);
    expect(contentMatchesImageType(new Uint8Array([0x89,0x50]),'image/png')).toBe(false);
  });
});
