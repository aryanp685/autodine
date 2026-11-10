import { describe, expect, it, vi } from 'vitest';
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-forwarded-for':'203.0.113.7, 198.51.100.2'})}));
import { addressFromHeaders, hashAddress, ipHash } from './ip-hash';

describe('IP fingerprints (proxy hints, not authenticated identities)',()=>{
  it('uses the first forwarded hop according to the current proxy contract',()=>{
    const headers=new Headers({'x-forwarded-for':' 203.0.113.7 , 198.51.100.2','x-real-ip':'192.0.2.1'});
    expect(addressFromHeaders(name=>headers.get(name))).toBe('203.0.113.7');
  });
  it('falls back to real-ip and then an explicit unknown bucket',()=>{
    expect(addressFromHeaders(name=>name==='x-real-ip'?' 192.0.2.1 ':null)).toBe('192.0.2.1');
    expect(addressFromHeaders(()=>null)).toBe('unknown');
  });
  it('keeps hashes stable per salt without exposing the address in the fingerprint',()=>{
    const hash=hashAddress('203.0.113.7','card-one');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashAddress('203.0.113.7','card-one'));
    expect(hash).not.toBe(hashAddress('203.0.113.7','card-two'));
    expect(hash).not.toContain('203.0.113.7');
  });
  it('uses the same hash contract for a server-action request',async()=>{
    expect(await ipHash('card-one')).toBe(hashAddress('203.0.113.7','card-one'));
  });
});
