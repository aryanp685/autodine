import PreviewFrame from '@/components/PreviewFrame';
import { CartProvider } from '@/components/CartProvider';

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <PreviewFrame>{children}</PreviewFrame>
    </CartProvider>
  );
}
