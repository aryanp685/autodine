import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/env',()=>({SUPABASE_URL:'https://project.supabase.co'}));
import { bucketPathFromUrl } from './assets';
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
