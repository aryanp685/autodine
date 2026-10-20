import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Handles Supabase PKCE redirects (email confirmation and password recovery).
 * Only the reset-password destination is accepted here; callback URLs can
 * never be turned into open redirects by manipulating the `next` parameter.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const supabase = await createSupabaseServerClient();

  if (!code || !supabase) {
    return NextResponse.redirect(new URL('/forgot-password?error=expired', url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/forgot-password?error=expired', url.origin));
  }

  const next = url.searchParams.get('next') === '/reset-password'
    ? '/reset-password'
    : '/login?notice=email-confirmed';
  return NextResponse.redirect(new URL(next, url.origin));
}
