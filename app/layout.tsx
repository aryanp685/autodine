import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '@/components/CartProvider';

export const metadata: Metadata = {
  title: 'AutoDine',
  description:
    'AutoDine — QR ordering and restaurant management for Indian restaurants. Frontend prototype: demo data only, no backend, no live payments.',
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
