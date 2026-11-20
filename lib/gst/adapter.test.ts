import { describe, expect, it } from 'vitest';
import { getIrpPreflightGate, isHermeticIrpRehearsal, isLocalIrpSimulation } from './adapter';

const LOOPBACK = 'http://127.0.0.1:54321';
const HERMETIC = {
  GITHUB_ACTIONS: 'true', CI: 'true', AUTODINE_TEST_DEMO_BUILD: 'true', VERCEL_ENV: 'test',
  NODE_ENV: 'production', AUTODINE_IRP_PROVIDER: 'sandbox', AUTODINE_IRP_SIMULATION: 'true',
  NEXT_PUBLIC_SUPABASE_URL: LOOPBACK,
} as NodeJS.ProcessEnv;

describe('IRP environment gate', () => {
  it('keeps a production deployment closed even with a sandbox name and the simulation flag', () => {
    expect(getIrpPreflightGate({ NODE_ENV: 'production', AUTODINE_IRP_PROVIDER: 'sandbox',
      AUTODINE_IRP_SIMULATION: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }).ok).toBe(false);
    expect(getIrpPreflightGate({ ...HERMETIC, VERCEL_ENV: 'production' }).ok).toBe(false);
    expect(getIrpPreflightGate({ ...HERMETIC, AUTODINE_IRP_PROVIDER: 'real' }).ok).toBe(false);
    expect(getIrpPreflightGate({ ...HERMETIC, AUTODINE_IRP_SIMULATION: 'false' }).ok).toBe(false);
  });

  it('opens only for the hermetic loopback rehearsal, and never for a remote origin', () => {
    expect(isHermeticIrpRehearsal(HERMETIC)).toBe(true);
    expect(isHermeticIrpRehearsal({ ...HERMETIC, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' })).toBe(false);
    expect(isHermeticIrpRehearsal({ ...HERMETIC, CI: 'false' })).toBe(false);
    expect(getIrpPreflightGate(HERMETIC).ok).toBe(true);
    expect(isLocalIrpSimulation(HERMETIC)).toBe(true);
    expect(isLocalIrpSimulation({ ...HERMETIC, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' })).toBe(false);
  });
});
