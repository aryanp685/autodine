import type { Metadata } from 'next';
import { SignupScreen } from '@/components/screens/SignupScreen';

export const metadata: Metadata = { title: 'Create your restaurant account · AutoDine' };

export default function SignupPage() {
  return <SignupScreen />;
}
