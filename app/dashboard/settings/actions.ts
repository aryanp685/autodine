'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireWorkspaceForAction } from '@/lib/db/workspace-access';
import { parseTaxRatePercent } from '@/lib/tax-settings';

export async function saveRestaurantTaxSettingsAction(formData: FormData) {
  const slugValue = formData.get('workspace');
  if (typeof slugValue !== 'string' || !slugValue.trim()) {
    throw new Error('Workspace is required.');
  }
  const slug = slugValue.trim();
  const access = await requireWorkspaceForAction(slug);
  if (access.workspace.role !== 'owner') {
    throw new Error('Only the restaurant owner can change tax settings.');
  }

  const taxEnabled = formData.get('taxEnabled') === 'on';
  const parsedRate = taxEnabled ? parseTaxRatePercent(formData.get('taxRatePercent')) : 0;
  if (parsedRate === null || (taxEnabled && parsedRate === 0)) {
    redirect(`/dashboard/settings?workspace=${encodeURIComponent(slug)}&status=invalid-rate`);
  }

  const { error } = await access.supabase.rpc('set_restaurant_tax_rate', {
    p_restaurant_id: access.workspace.id,
    p_tax_rate_bps: parsedRate,
  });
  if (error) {
    if (/inactive or read-only/i.test(error.message)) {
      redirect(`/dashboard/settings?workspace=${encodeURIComponent(slug)}&status=read-only`);
    }
    console.error('[autodine] failed to save restaurant tax settings:', error.message);
    redirect(`/dashboard/settings?workspace=${encodeURIComponent(slug)}&status=save-failed`);
  }

  revalidatePath('/dashboard/settings');
  revalidatePath('/menu');
  revalidatePath('/menu/cart');
  revalidatePath('/menu/checkout');
  redirect(`/dashboard/settings?workspace=${encodeURIComponent(slug)}&status=saved`);
}
