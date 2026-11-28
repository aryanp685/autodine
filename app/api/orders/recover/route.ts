import { NextResponse, type NextRequest } from 'next/server';
import { readJsonObject, JsonInputError } from '@/lib/http-json';
import { recoverGuestOrderAttempt } from '@/lib/db/order-recovery';
import { isOrderToken } from '@/lib/db/order-status';
import { consumeGuestRecoverBudget } from '@/lib/server/guest-recover-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const;

export async function POST(request: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, reason: 'bad_request' },
      { status: error instanceof JsonInputError ? error.status : 400, headers: NO_STORE },
    );
  }

  const body = (parsed ?? {}) as Record<string, unknown>;
  const slug = typeof body.s === 'string' ? body.s.trim() : '';
  const attempt = typeof body.attempt === 'string' ? body.attempt.trim() : '';

  if (!slug || !isOrderToken(attempt)) {
    return NextResponse.json(
      { ok: false, reason: 'bad_request' },
      { status: 400, headers: NO_STORE },
    );
  }

  const budget = await consumeGuestRecoverBudget((name) => request.headers.get(name));
  if (budget.state === 'limited') {
    return NextResponse.json(
      { ok: false, reason: 'too_many' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(budget.retryAfterSeconds) } },
    );
  }

  const result = await recoverGuestOrderAttempt({ slug, attemptToken: attempt });

  if (result.kind === 'unavailable') {
    return NextResponse.json(
      { ok: false, reason: 'unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }

  if (result.kind === 'not_found') {
    return NextResponse.json(
      { ok: true, found: false },
      { headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      found: true,
      orderId: result.orderId,
      code: result.code,
      placedAt: result.placedAt,
      prepStatus: result.prepStatus,
      awaitingConfirmation: result.awaitingConfirmation,
      tableLabel: result.tableLabel,
    },
    { headers: NO_STORE },
  );
}

export function GET() {
  return NextResponse.json(
    { ok: false, reason: 'method_not_allowed' },
    { status: 405, headers: { ...NO_STORE, allow: 'POST' } },
  );
}
