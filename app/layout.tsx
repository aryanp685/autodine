import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '@/components/CartProvider';

export const metadata: Metadata = {
  title: 'AutoDine',
  description:
    'AutoDine — QR ordering and restaurant management for Indian restaurants. A prototype with clearly labeled demos and an early Supabase-backed cashier path; not production-ready and no online payments are connected.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* [data-app] scopes every rule in styles/design-system.css to the product. */}
        <div data-app>
          <CartProvider>{children}</CartProvider>
        </div>
      </body>
    </html>
  );
}
