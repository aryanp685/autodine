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
      <head>
        {/*
          Marks the document as "animation is safe to prepare for" before the
          first paint.

          The CSS only hides [data-anim] elements when <html> has .motion, and
          only this script adds that class. So if JavaScript is disabled or
          fails to run, the class is never added, nothing is ever hidden, and
          the page renders complete and readable. Equally, if the visitor has
          asked their OS for reduced motion, the class is withheld and no
          element is hidden or animated.

          It has to be inline and blocking: if it ran after paint, the browser
          would show the content first and then hide it to animate it back in,
          which is a visible flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: no-preference)').matches){document.documentElement.classList.add('motion')}`,
          }}
        />
      </head>
      <body>
        {/* [data-app] scopes every rule in styles/design-system.css to the product. */}
        <div data-app>
          <CartProvider>{children}</CartProvider>
        </div>
      </body>
    </html>
  );
}
