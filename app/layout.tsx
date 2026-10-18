import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoDine — Phase 1 design prototypes',
  description:
    'Three visual UI/UX directions for AutoDine. Prototype only: demo data, no backend, no payments.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
