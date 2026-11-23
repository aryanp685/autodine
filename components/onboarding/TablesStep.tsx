'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function TablesStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}