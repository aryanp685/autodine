import { describe, expect, it } from 'vitest';
import { getOnboardingSteps, isOnboardingComplete, stepById } from './onboarding';

const writableAccess = {
  canWrite: true,
  readOnly: false,
  features: [],
  plan: 'trial',
  status: 'trialing',
  trialEndsAt: null,
  daysRemaining: 21,
};

describe('onboarding', () => {
  it('returns six steps in order, finish last', () => {
    const steps = getOnboardingSteps();
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.id)).toEqual(['welcome', 'outlet', 'menu', 'tables', 'staff', 'finish']);
    expect(steps[steps.length - 1].id).toBe('finish');
    expect(steps[0].id).toBe('welcome');
  });

  it('has unique step ids', () => {
    const ids = getOnboardingSteps().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks every step with a title and component', () => {
    for (const step of getOnboardingSteps()) {
      expect(typeof step.title).toBe('string');
      expect(step.title.length).toBeGreaterThan(0);
      expect(typeof step.component).toBe('string');
      expect(typeof step.required).toBe('boolean');
      expect(typeof step.canSkip).toBe('boolean');
    }
  });

  it('only staff is skippable and finish is last', () => {
    const steps = getOnboardingSteps();
    expect(steps.find((s) => s.id === 'staff')?.canSkip).toBe(true);
    expect(steps.find((s) => s.canSkip)?.id).toBe('staff');
    expect(stepById('finish')?.required).toBe(true);
  });

  it('treats missing access as incomplete', () => {
    expect(isOnboardingComplete(null)).toBe(false);
    expect(isOnboardingComplete(undefined)).toBe(false);
  });

  it('treats a read-only restaurant as incomplete', () => {
    expect(isOnboardingComplete({ ...writableAccess, readOnly: true })).toBe(false);
  });

  it('treats a non-writable restaurant as incomplete', () => {
    expect(isOnboardingComplete({ ...writableAccess, canWrite: false })).toBe(false);
  });

  it('treats a writable restaurant as complete', () => {
    expect(isOnboardingComplete(writableAccess)).toBe(true);
  });
});
