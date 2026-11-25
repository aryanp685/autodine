import { BrandMark } from '@/components/BrandMark';

/** AutoDine's own mark becomes the pending indicator inside account actions. */
export function AuthBrandLoader() {
  return (
    <span className="auth-brand-loader" aria-hidden="true">
      <span className="auth-brand-loader__orbit" />
      <BrandMark size={15} ink="#1f3d2e" dot="#fff8ed" tone="auth-submit-loader" />
    </span>
  );
}
